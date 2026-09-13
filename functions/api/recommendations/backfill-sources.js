// functions/api/recommendations/backfill-sources.js
// POST /api/recommendations/backfill-sources[?dryRun=1]
// Authorization: Bearer <AGENT_INGEST_SECRET>
//
// Maintenance pass over the PENDING recommendations that brings each draft up to
// full both-campaign signatory coverage — the same rule new drafts get at ingest
// (see lib/signatory-status.js). For every pending draft it will:
//   • ADD a missing ControlAI / PauseAI "signed / not signed" bullet + its list
//     source, so a campaign the draft never mentioned is no longer ambiguous, and
//   • CORRECT a draft's own clear claim that contradicts the authoritative roster.
// It never removes substantive content, never rewrites an entangled bullet (those
// come back under `flagged`), reports anything that won't fit the ≤5-bullet /
// ≤6-source caps under `capped`, and is idempotent — a draft that already states
// both campaigns correctly is left untouched. It only ever touches pending rows,
// so nothing is published; the drafts stay for human review at /goldenpath.html.
//
// (Route name kept for stability; it now backfills bullets as well as sources.)
// Pass ?dryRun=1 (or { "dryRun": true }) to preview without writing.

import { makeSupabase, agentSecretOk, json } from '../../../lib/admin-auth.js';
import { sanitizeBullets, sanitizeSources } from '../../../lib/ratings.js';
import { enforceCoverage } from '../../../lib/signatory-status.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!agentSecretOk(context)) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  // dryRun via query string or JSON body.
  const url = new URL(context.request.url);
  let dryRun = /^(1|true|yes)$/i.test(url.searchParams.get('dryRun') || '');
  try {
    const body = await context.request.json();
    if (body && typeof body.dryRun === 'boolean') dryRun = body.dryRun;
  } catch { /* no/invalid body is fine */ }

  const { data: recs, error } = await supabase
    .from('mp_recommendations')
    .select('id, constituency, mp_name, bullets, sources')
    .eq('status', 'pending');

  if (error) {
    console.error('backfill-sources load error:', error.message || error);
    return json({ error: 'Failed to load pending recommendations' }, 500);
  }

  const changes = [];   // drafts we (would) update
  const flagged = [];    // entangled bullets left for a human
  const capped  = [];    // needed a bullet/source but no room under the caps
  let updated = 0;
  let failed = 0;

  for (const rec of recs || []) {
    const res = enforceCoverage(rec.constituency, rec.bullets, rec.sources);
    if (res.flagged.length) flagged.push({ constituency: rec.constituency, mp_name: rec.mp_name, flagged: res.flagged });
    if (res.capped.length)  capped.push({ constituency: rec.constituency, mp_name: rec.mp_name, capped: res.capped });
    if (!res.changed) continue;

    const entry = {
      constituency: rec.constituency,
      mp_name: rec.mp_name,
      added: res.added.map(a => `${a.campaign}/${a.kind}`),
      corrected: res.corrected.map(c => ({ campaign: c.campaign, from: c.from, to: c.to })),
    };
    changes.push(entry);

    if (!dryRun) {
      const { error: upErr } = await supabase
        .from('mp_recommendations')
        .update({ bullets: sanitizeBullets(res.bullets), sources: sanitizeSources(res.sources) })
        .eq('id', rec.id)
        .eq('status', 'pending');   // guard: never revive a reviewed row
      if (upErr) {
        console.error(`backfill-sources update ${rec.constituency}:`, upErr.message || upErr);
        entry.error = 'update failed';
        failed++;
      } else {
        updated++;
      }
    }
  }

  return json({
    success: true,
    dryRun,
    scanned: (recs || []).length,
    to_change: changes.length,
    updated: dryRun ? 0 : updated,
    failed,
    corrections: changes.filter(c => c.corrected.length).length,
    flagged_count: flagged.length,
    capped_count: capped.length,
    changes,   // per-seat: what was added / corrected
    flagged,   // per-seat: entangled bullets left for manual review
    capped,    // per-seat: needed a bullet/source but the cap was full
  });
}
