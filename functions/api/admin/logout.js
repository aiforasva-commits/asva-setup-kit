// functions/api/admin/logout.js
// POST /api/admin/logout
// Ends the current review session: expires the admin_sessions row and clears the
// cookie. Idempotent — clearing an already-gone session still succeeds.

import { makeSupabase, readCookie, clearCookie, ADMIN_COOKIE } from '../../../lib/admin-auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const token    = readCookie(context.request, ADMIN_COOKIE);
  const supabase = makeSupabase(context.env);
  if (token && supabase) {
    try {
      await supabase
        .from('admin_sessions')
        .update({ session_expires_at: new Date(0).toISOString() })
        .eq('session_token', token);
    } catch (e) {
      console.error('admin logout error:', e.message || e);
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie() },
  });
}
