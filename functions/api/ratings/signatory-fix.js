// functions/api/ratings/signatory-fix.js
// POST /api/ratings/signatory-fix[?dryRun=1][&limit=N]
// Authorization: Bearer <AGENT_INGEST_SECRET>
//
// Maintenance pass over the LIVE, confirmed ratings (mp_ratings). It makes every
// card state BOTH campaigns explicitly — whether the MP signed the ControlAI
// statement AND whether they signed a PauseAI open letter — so the silence on a
// campaign a card never mentioned can no longer be misread as "not signed" (or as
// "signed"). Status comes from the authoritative snapshot in lib/signatory-snapshot.js
// (constituency lookup, no fuzzy matching); the merge rules live in
// lib/signatory-status.js.
//
// It ADDS a missing campaign bullet + its list source, and CORRECTS a card's own
// clear "signed / not signed" claim that contradicts the roster. It never removes
// substantive bullets/sources, never rewrites an entangled bullet (those are
// reported under `flagged` for a human), and reports anything that won't fit the
// ≤5-bullet / ≤6-source caps under `capped` rather than dropping it. Rows it edits
// are stamped signatory_fixed_at + updated_by='signatory-fix' so /goldenpath.html
// can filter to them. A row that needs no change is left completely untouched.
//
// Unlike confirm/ratings-update (which need an admin session), this is guarded by
// the agent secret so the batch pass can run unattended — but it only ever adjusts
// signatory coverage; it cannot change a grade. Pass ?dryRun=1 to preview.

import { makeSupabase, agentSecretOk, json } from '../../../lib/admin-auth.js';
import { sanitizeBullets, sanitizeSources } from '../../../lib/ratings.js';
import { enforceCoverage } from '../../../lib/signatory-status.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!agentSecretOk(context)) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  const url = new URL(context.request.url);
  let dryRun = /^(1|true|yes)$/i.test(url.searchParams.get('dryRun') || '');
  let limit  = parseInt(url.searchParams.get('limit') || '0', 10) || 0;   // 0 = all
  try {
    const body = await context.request.json();
    if (body && typeof body.dryRun === 'boolean') dryRun = body.dryRun;
    if (body && Number.isInteger(body.limit)) limit = body.limit;
  } catch { /* no/invalid body is fine */ }

  const { data: rows, error } = await supabase
    .from('mp_ratings')
    .select('constituency, mp_name, grade, bullets, sources')
    .order('constituency', { ascending: true });

  if (error) {
    console.error('signatory-fix load error:', error.message || error);
    return json({ error: 'Failed to load ratings' }, 500);
  }

  const changes = [];   // per-seat summary of what changed
  const flagged = [];    // entangled bullets a human should look at
  const capped  = [];    // needed a bullet/source but no room under the caps
  let updated = 0, failed = 0, scanned = 0;

  for (const row of rows || []) {
    scanned++;
    const res = enforceCoverage(row.constituency, row.bullets, row.sources);
    if (res.flagged.length) flagged.push({ constituency: row.constituency, mp_name: row.mp_name, flagged: res.flagged });
    if (res.capped.length)  capped.push({ constituency: row.constituency, mp_name: row.mp_name, capped: res.capped });
    if (!res.changed) continue;

    const entry = {
      constituency: row.constituency,
      mp_name: row.mp_name,
      grade: row.grade,
      controlai: res.status.controlai.signed ? 'signed' : 'not',
      pauseai:   res.status.pauseai.signed ? `signed:${res.status.pauseai.letter}` : 'not',
      added:     res.added.map(a => `${a.campaign}/${a.kind}`),
      corrected: res.corrected.map(c => ({ campaign: c.campaign, from: c.from, to: c.to })),
    };
    changes.push(entry);

    if (dryRun) continue;
    // `limit` caps how many rows this run actually WRITES (handy for a first small
    // live run); the scan and `changes`/`flagged`/`capped` summaries still cover
    // every seat, so the response shows the full scope either way.
    if (limit > 0 && updated >= limit) continue;

    const { error: upErr } = await supabase
      .from('mp_ratings')
      .update({
        bullets: sanitizeBullets(res.bullets),
        sources: sanitizeSources(res.sources),
        updated_by: 'signatory-fix',
        updated_at: new Date().toISOString(),
        signatory_fixed_at: new Date().toISOString(),
      })
      .eq('constituency', row.constituency);
    if (upErr) {
      console.error(`signatory-fix update ${row.constituency}:`, upErr.message || upErr);
      entry.error = 'update failed';
      failed++;
    } else {
      updated++;
    }
  }

  return json({
    success: true,
    dryRun,
    limit: limit || null,
    scanned,
    to_change: changes.length,
    updated: dryRun ? 0 : updated,
    failed,
    corrections: changes.filter(c => c.corrected.length).length,
    flagged_count: flagged.length,
    capped_count: capped.length,
    changes,   // per-seat: campaign status + what was added/corrected
    flagged,   // per-seat: entangled bullets left for manual review
    capped,    // per-seat: needed a bullet/source but the cap was full
  });
}
