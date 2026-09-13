// functions/api/ratings/add-sources.js
// POST /api/ratings/add-sources[?dryRun=1&limit=N]
// Authorization: Bearer <AGENT_INGEST_SECRET>
// Body: { additions: [ { constituency, source: { title, url } } , ... ] }
//
// Appends a single provided source to a LIVE confirmed rating (mp_ratings) — used
// to give every card a baseline record link (e.g. the MP's parliament.uk profile)
// so a reader can always click through to their record, even on a "?" card that
// otherwise carries only the campaign signatory-list links.
//
// Deliberately conservative:
//   • only touches rows graded '?' (never changes an A–F card),
//   • only ADDS the source when its host isn't already cited (idempotent),
//   • respects the ≤6-source cap (reports, never drops),
//   • never changes the grade, bullets, or any existing source.
// Rows it changes get updated_at bumped (updated_by left as-is is not possible via
// upsert-of-subset, so we set it to 'record-source'). Pass ?dryRun=1 to preview;
// ?limit=N caps how many rows are written per call (loop past the ~50-subrequest
// platform limit). The additions list is idempotent, so re-running finishes the rest.

import { makeSupabase, agentSecretOk, json } from '../../../lib/admin-auth.js';
import { sanitizeSources } from '../../../lib/ratings.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!agentSecretOk(context)) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  const url = new URL(context.request.url);
  let dryRun = /^(1|true|yes)$/i.test(url.searchParams.get('dryRun') || '');
  let limit  = parseInt(url.searchParams.get('limit') || '0', 10) || 0;

  let body;
  try { body = await context.request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (body && typeof body.dryRun === 'boolean') dryRun = body.dryRun;
  if (body && Number.isInteger(body.limit)) limit = body.limit;

  const additions = Array.isArray(body.additions) ? body.additions : null;
  if (!additions || !additions.length) return json({ error: 'No additions provided' }, 400);

  // One read of the whole table, then targeted updates (keeps subrequests down).
  const { data: rows, error } = await supabase
    .from('mp_ratings')
    .select('constituency, grade, sources');
  if (error) {
    console.error('add-sources load error:', error.message || error);
    return json({ error: 'Failed to load ratings' }, 500);
  }
  const byCons = new Map((rows || []).map(r => [r.constituency, r]));

  const hostOf = (u) => { try { return new URL(String(u)).hostname; } catch { return ''; } };
  const changes = [], skipped = [], capped = [];
  let updated = 0, failed = 0;

  for (const a of additions) {
    const cons = String(a?.constituency ?? '').trim();
    const src  = a?.source || {};
    const surl = String(src.url ?? '').trim();
    const row  = byCons.get(cons);
    if (!cons || !surl || !row) { skipped.push({ constituency: cons || '(missing)', reason: 'no matching rating' }); continue; }
    if (row.grade !== '?') { skipped.push({ constituency: cons, reason: `grade ${row.grade}, not ?` }); continue; }

    const existing = Array.isArray(row.sources) ? row.sources : [];
    if (existing.some(s => hostOf(s?.url) === hostOf(surl))) { skipped.push({ constituency: cons, reason: 'host already cited' }); continue; }
    if (existing.length >= 6) { capped.push({ constituency: cons }); continue; }

    // Record source goes first, so it reads as the card's "who/what" anchor.
    const nextSources = sanitizeSources([{ title: src.title, url: surl }, ...existing]);
    changes.push({ constituency: cons, added: surl });
    if (dryRun) continue;
    if (limit > 0 && updated >= limit) continue;

    const { error: upErr } = await supabase
      .from('mp_ratings')
      .update({ sources: nextSources, updated_by: 'record-source', updated_at: new Date().toISOString() })
      .eq('constituency', cons)
      .eq('grade', '?');   // guard: never edit a row that changed grade meanwhile
    if (upErr) { console.error(`add-sources ${cons}:`, upErr.message || upErr); failed++; }
    else updated++;
  }

  return json({
    success: true, dryRun, limit: limit || null,
    to_change: changes.length, updated: dryRun ? 0 : updated, failed,
    capped_count: capped.length, skipped_count: skipped.length,
    changes, capped, skipped,
  });
}
