// functions/api/research/queue.js
// GET /api/research/queue?limit=N
// Authorization: Bearer <AGENT_INGEST_SECRET>
//
// Returns the next batch of current MPs to research, so the research skill can
// work through the ~650 seats a batch at a time.
//
// Ordering & priority:
//   • Seats are ordered MOST-MARGINAL FIRST (smallest majority → largest;
//     unknown majorities last). Marginal seats are where a scorecard rating
//     matters most electorally, so they get researched first.
//   • Two phases. Phase "unscored" returns seats that have NO real grade yet
//     (grade '?' / blank and no live rating). Only once every unscored seat has
//     been worked through does phase "refresh" begin, re-checking already-scored
//     seats (again most-marginal first) so ratings can be kept current.
//   • Seats with a PENDING draft awaiting review are always skipped (in progress).
//
// A seat counts as already scored when data.json shows a real grade (A–F or DNR,
// from the sheet or a previously-confirmed rating) or it has a live mp_ratings
// row (covers ratings confirmed since the last build). No seeding step required.
//
// The full MP list comes from the built /data.json (the same file the site
// serves), so this needs no separate copy of the constituency roster.

import { makeSupabase, agentSecretOk, json } from '../../../lib/admin-auth.js';

// Grades that count as "already assessed". Mirrors REAL_GRADES in
// scripts/import-ratings.js.
const SCORED_GRADES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'DNR']);

// Most-marginal first: ascending majority, with unknown (null) majorities last.
function byMarginality(a, b) {
  const am = a.majority == null ? Infinity : a.majority;
  const bm = b.majority == null ? Infinity : b.majority;
  return am - bm;
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (!agentSecretOk(context)) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  const url   = new URL(context.request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 1), 100);

  // Pull the current-MP roster from the deployed data.json.
  let hexMap;
  try {
    const res = await fetch(`${url.origin}/data.json`);
    if (!res.ok) throw new Error(`data.json ${res.status}`);
    ({ hexMap } = await res.json());
  } catch (e) {
    console.error('research queue: could not load data.json:', e.message || e);
    return json({ error: 'Could not load MP list' }, 502);
  }

  const currentMps = (hexMap || [])
    .filter(h => h && h.mpName && h.name)
    .map(h => ({
      constituency: h.name,
      mp_name:      h.mpName,
      party:        h.party || null,
      majority:     typeof h.majority === 'number' ? h.majority : null,
      sheetScored:  SCORED_GRADES.has(String(h.asvaGrade || '').trim().toUpperCase()),
    }));

  // Supabase state: pending drafts (in progress) and live ratings (scored).
  const [pendingRes, ratingsRes] = await Promise.all([
    supabase.from('mp_recommendations').select('constituency').eq('status', 'pending'),
    supabase.from('mp_ratings').select('constituency'),
  ]);
  if (pendingRes.error || ratingsRes.error) {
    console.error('research queue state error:', (pendingRes.error || ratingsRes.error)?.message);
    return json({ error: 'Failed to read review state' }, 500);
  }
  const pendingSet = new Set((pendingRes.data || []).map(r => r.constituency));
  const ratingSet  = new Set((ratingsRes.data || []).map(r => r.constituency));

  const isScored = m => m.sheetScored || ratingSet.has(m.constituency);

  // Pending-draft seats are always excluded; everything else splits into the two
  // phases, each ordered most-marginal first.
  const available = currentMps.filter(m => !pendingSet.has(m.constituency));
  const unscored  = available.filter(m => !isScored(m)).sort(byMarginality);
  const refresh   = available.filter(m =>  isScored(m)).sort(byMarginality);

  // Refresh scored seats only once no unscored seats remain.
  const phase = unscored.length ? 'unscored' : 'refresh';
  const pool  = unscored.length ? unscored : refresh;
  const batch = pool.slice(0, limit).map(m => ({
    constituency: m.constituency, mp_name: m.mp_name, party: m.party, majority: m.majority,
  }));

  return json({
    total_mps:          currentMps.length,
    phase,                                 // 'unscored' (initial sweep) or 'refresh'
    unscored_remaining: unscored.length,
    refresh_remaining:  refresh.length,
    pending_review:     pendingSet.size,   // awaiting Confirm/Reject, not re-queued
    remaining:          pool.length,       // remaining in the current phase
    returned:           batch.length,
    mps:                batch,             // in order, most-marginal first, with majority
  });
}
