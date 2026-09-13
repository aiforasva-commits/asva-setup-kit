// functions/api/member-submissions/index.js
// GET /api/member-submissions[?status=pending]
// Lists member-submitted MP-rating edits for the Golden Path "Member
// Submissions" tab. Requires a valid admin session. Defaults to pending;
// pass ?status=confirmed|rejected|all to see others. Includes the base_*
// snapshot alongside the proposed_* fields so the review card can render an
// inline current-vs-proposed diff without a second request.

import { requireAdmin, makeSupabase, json } from '../../../lib/admin-auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const session = await requireAdmin(context);
  if (!session) return json({ error: 'Not authenticated' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  const url    = new URL(context.request.url);
  const status = (url.searchParams.get('status') || 'pending').trim();

  let query = supabase
    .from('member_submissions')
    .select(`
      id, constituency, mp_name, member_name, member_email,
      proposed_grade, bullets, sources, note,
      base_grade, base_bullets, base_sources,
      status, confirmed_grade, amended, reject_reason,
      created_at, reviewed_at
    `)
    .order('created_at', { ascending: true });

  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    console.error('list member submissions error:', error.message || error);
    return json({ error: 'Failed to load member submissions' }, 500);
  }

  return json({ submissions: data || [] });
}
