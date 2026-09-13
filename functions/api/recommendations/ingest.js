// functions/api/recommendations/ingest.js
// POST /api/recommendations/ingest
// Authorization: Bearer <AGENT_INGEST_SECRET>
// Body: { recommendations: [ { constituency, mp_name, party?, recommended_grade,
//         rationale?, bullets?, sources?, model? }, ... ] }
//
// Called by the research skill (.claude/skills/research-mps) to drop a batch of
// DRAFT ratings into mp_recommendations as 'pending'. These are never shown on
// the site — they wait for review at /goldenpath.html. Re-ingesting a constituency
// replaces its existing pending draft (there is one pending row per seat), so
// re-running the skill refreshes rather than duplicates.

import { normalizeGrade, sanitizeBullets, sanitizeSources } from '../../../lib/ratings.js';
import { enforceCoverage } from '../../../lib/signatory-status.js';
import { makeSupabase, agentSecretOk, json } from '../../../lib/admin-auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!agentSecretOk(context)) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  let body;
  try { body = await context.request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const incoming = Array.isArray(body.recommendations) ? body.recommendations : null;
  if (!incoming || !incoming.length) return json({ error: 'No recommendations provided' }, 400);
  if (incoming.length > 100) return json({ error: 'Batch too large (max 100)' }, 400);

  const rows = [];
  const skipped = [];
  for (const r of incoming) {
    const constituency = String(r?.constituency ?? '').trim();
    const mpName       = String(r?.mp_name ?? '').trim();
    const grade        = normalizeGrade(r?.recommended_grade);
    if (!constituency || !mpName || !grade) {
      skipped.push({ constituency: constituency || '(missing)', reason: !grade ? 'invalid grade' : 'missing name/constituency' });
      continue;
    }
    // Make BOTH campaigns explicit on every draft: add a missing ControlAI/PauseAI
    // "signed / not signed" bullet + its list source, and correct any draft claim
    // that contradicts the authoritative rosters, so the card is never ambiguous
    // about a campaign it simply didn't mention. See lib/signatory-status.js.
    const cov     = enforceCoverage(constituency, sanitizeBullets(r.bullets), sanitizeSources(r.sources));
    const bullets = sanitizeBullets(cov.bullets);
    const sources = sanitizeSources(cov.sources);
    rows.push({
      constituency,
      mp_name:           mpName,
      party:             r.party ? String(r.party).trim() : null,
      recommended_grade: grade,
      rationale:         r.rationale ? String(r.rationale).trim().slice(0, 500) : null,
      bullets,
      sources,
      status:            'pending',
      model:             r.model ? String(r.model).trim().slice(0, 100) : null,
    });
  }

  if (!rows.length) return json({ error: 'No valid recommendations', skipped }, 400);

  // Replace any existing pending draft for these seats, then insert the fresh
  // batch. (There is a partial unique index allowing one pending row per seat.)
  const seats = [...new Set(rows.map(r => r.constituency))];
  const { error: delError } = await supabase
    .from('mp_recommendations')
    .delete()
    .in('constituency', seats)
    .eq('status', 'pending');
  if (delError) {
    console.error('ingest clear-pending error:', delError.message || delError);
    return json({ error: 'Failed to clear existing drafts' }, 500);
  }

  const { error: insError } = await supabase.from('mp_recommendations').insert(rows);
  if (insError) {
    console.error('ingest insert error:', insError.message || insError);
    return json({ error: 'Failed to save recommendations' }, 500);
  }

  return json({ success: true, ingested: rows.length, skipped });
}
