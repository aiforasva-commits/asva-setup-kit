// functions/api/recommendations/reject.js
// POST /api/recommendations/reject
// Body: { id }
// Discards a pending recommendation without touching the live rating. Marking it
// rejected (rather than deleting) keeps a history and lets the research skill
// re-queue the seat later. Requires a valid admin session.

import { requireAdmin, makeSupabase, json } from '../../../lib/admin-auth.js';

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

  const { data, error } = await supabase
    .from('mp_recommendations')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')   // only a pending rec can be rejected
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('reject error:', error.message || error);
    return json({ error: 'Failed to reject recommendation' }, 500);
  }
  if (!data) return json({ error: 'Recommendation not found or not pending' }, 404);

  return json({ success: true });
}
