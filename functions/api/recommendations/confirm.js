// functions/api/recommendations/confirm.js
// POST /api/recommendations/confirm
// Body: { id, grade?, bullets?, sources? }
// Approves a pending recommendation. The optional fields let you edit the grade,
// bullets, or sources at the moment of confirming; anything omitted falls back
// to what the recommendation proposed. Writes the result into mp_ratings (the
// live table the site reads) and marks the recommendation confirmed.
//
// This is the ONLY path (besides editing mp_ratings by hand) that puts a rating
// live — nothing the research skill produces is shown publicly until it comes
// through here. Requires a valid admin session.

import { requireAdmin, makeSupabase, json } from '../../../lib/admin-auth.js';
import { normalizeGrade, sanitizeBullets, sanitizeSources } from '../../../lib/ratings.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const session = await requireAdmin(context);
  if (!session) return json({ error: 'Not authenticated' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  let body;
  try { body = await context.request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const id = String(body.id ?? '').trim();
  if (!id) return json({ error: 'Missing recommendation id' }, 400);

  // Load the pending recommendation.
  const { data: rec, error: recError } = await supabase
    .from('mp_recommendations')
    .select('id, constituency, mp_name, party, recommended_grade, rationale, bullets, sources, status, model')
    .eq('id', id)
    .maybeSingle();

  if (recError) {
    console.error('confirm load error:', recError.message || recError);
    return json({ error: 'Failed to load recommendation' }, 500);
  }
  if (!rec) return json({ error: 'Recommendation not found' }, 404);
  if (rec.status !== 'pending') return json({ error: `Already ${rec.status}` }, 409);

  // Apply any edits made in the review UI, else keep what was recommended.
  const grade = normalizeGrade(body.grade ?? rec.recommended_grade);
  if (!grade) return json({ error: 'Invalid grade' }, 400);

  const bullets = body.bullets !== undefined ? sanitizeBullets(body.bullets) : sanitizeBullets(rec.bullets);
  const sources = body.sources !== undefined ? sanitizeSources(body.sources) : sanitizeSources(rec.sources);
  const now     = new Date().toISOString();

  // Upsert the live rating (one row per constituency). Confirming from the review
  // page IS a human review, so stamp human_reviewed_at — the rating goes straight
  // into "Live Human Reviewed", not the Claude queue. Carry the draft's rationale/
  // party/model across so that context is preserved on the live card.
  const { error: upsertError } = await supabase
    .from('mp_ratings')
    .upsert({
      constituency:      rec.constituency,
      mp_name:           rec.mp_name,
      grade,
      bullets,
      sources,
      rationale:         rec.rationale || null,
      party:             rec.party || null,
      model:             rec.model || null,
      updated_by:        'agent-confirmed',
      updated_at:        now,
      human_reviewed_at: now,
    }, { onConflict: 'constituency' });

  if (upsertError) {
    console.error('confirm upsert error:', upsertError.message || upsertError);
    return json({ error: 'Failed to save rating' }, 500);
  }

  // Mark the recommendation confirmed (record what was actually saved).
  const { error: markError } = await supabase
    .from('mp_recommendations')
    .update({ status: 'confirmed', confirmed_grade: grade, reviewed_at: now })
    .eq('id', id);

  if (markError) {
    // The rating is already live; log but don't fail the request.
    console.error('confirm mark error:', markError.message || markError);
  }

  return json({ success: true, constituency: rec.constituency, grade });
}
