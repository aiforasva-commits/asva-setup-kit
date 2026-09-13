// functions/api/current-ratings.js
// GET /api/current-ratings
// Public, read-only. Returns the confirmed ASVA ratings from Supabase mp_ratings,
// keyed by constituency, so the scorecard and hex map can overlay them at runtime
// without a rebuild. Grades are public information, so no auth is required.
//
// This is the runtime counterpart to the (optional) build-time overlay in
// scripts/fetch-data.js — it exists because Cloudflare does not expose the
// Supabase secrets to the build, and it has the nice side effect that a confirmed
// rating appears on the site immediately.

import { makeSupabase, json } from '../../lib/admin-auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const supabase = makeSupabase(context.env);
  // No Supabase configured → empty overlay, so the site falls back to data.json.
  if (!supabase) return json({ ratings: {} }, 200, { 'Cache-Control': 'no-store' });

  const { data, error } = await supabase
    .from('mp_ratings')
    .select('constituency, mp_name, grade, bullets, sources, updated_at, signatory_fixed_at');

  if (error) {
    console.error('current-ratings error:', error.message || error);
    // Fail soft: an empty overlay just shows the built-in (sheet) grades.
    return json({ ratings: {} }, 200, { 'Cache-Control': 'no-store' });
  }

  const ratings = {};
  for (const r of data || []) {
    ratings[r.constituency] = {
      mp_name:    r.mp_name,
      grade:      r.grade,
      bullets:    Array.isArray(r.bullets) ? r.bullets : [],
      sources:    Array.isArray(r.sources) ? r.sources : [],
      updated_at: r.updated_at || null,
      // Marker so the review page can filter to cards touched by the both-campaign
      // signatory-coverage pass. NULL/absent for every other rating.
      signatory_fixed_at: r.signatory_fixed_at || null,
    };
  }

  // No caching: a confirmed or amended rating must surface immediately. The
  // payload is small and this site's traffic is modest, so a live read per page
  // load is fine.
  return json({ ratings }, 200, { 'Cache-Control': 'no-store' });
}
