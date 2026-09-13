// functions/api/recommendations/index.js
// GET /api/recommendations[?status=pending]
// Lists recommendations for the review page. Requires a valid admin session
// cookie. Defaults to pending; pass ?status=confirmed|rejected|all to see others.

import { requireAdmin, makeSupabase, json } from '../../../lib/admin-auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const session = await requireAdmin(context);
  if (!session) return json({ error: 'Not authenticated' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  const url    = new URL(context.request.url);
  const status = (url.searchParams.get('status') || 'pending').trim();

  let query = supabase
    .from('mp_recommendations')
    .select('id, constituency, mp_name, party, recommended_grade, rationale, bullets, sources, status, model, created_at')
    .order('constituency', { ascending: true });

  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    console.error('list recommendations error:', error.message || error);
    return json({ error: 'Failed to load recommendations' }, 500);
  }

  return json({ recommendations: data || [] });
}
