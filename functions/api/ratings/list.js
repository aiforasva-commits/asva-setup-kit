// functions/api/ratings/list.js
// GET /api/ratings/list
// Admin-only. Returns EVERY live rating (mp_ratings) with the full set of fields
// the review page needs — including human_reviewed_at and the preserved draft
// context (rationale/party/model) — so /goldenpath.html can split them into the
// "Live Claude Ratings" and "Live Human Reviewed" tabs.
//
// This is the admin counterpart to the public /api/current-ratings, which the
// scorecard/map read: that endpoint stays limited to public fields (grade,
// bullets, sources) so the internal rationale/model never reach the public site.

import { requireAdmin, makeSupabase, json } from '../../../lib/admin-auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const session = await requireAdmin(context);
  if (!session) return json({ error: 'Not authenticated' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  const { data, error } = await supabase
    .from('mp_ratings')
    .select('constituency, mp_name, grade, bullets, sources, updated_at, signatory_fixed_at, human_reviewed_at, rationale, party, model');

  if (error) {
    console.error('ratings list error:', error.message || error);
    return json({ error: 'Failed to load ratings' }, 500);
  }

  const ratings = {};
  for (const r of data || []) {
    ratings[r.constituency] = {
      mp_name:            r.mp_name,
      grade:              r.grade,
      bullets:            Array.isArray(r.bullets) ? r.bullets : [],
      sources:            Array.isArray(r.sources) ? r.sources : [],
      updated_at:         r.updated_at || null,
      signatory_fixed_at: r.signatory_fixed_at || null,
      // NULL → Live Claude rating (unreviewed); a timestamp → Live Human reviewed.
      human_reviewed_at:  r.human_reviewed_at || null,
      // Context carried over from the draft, so the Claude card keeps it.
      rationale:          r.rationale || null,
      party:              r.party || null,
      model:              r.model || null,
    };
  }

  return json({ ratings }, 200, { 'Cache-Control': 'no-store' });
}
