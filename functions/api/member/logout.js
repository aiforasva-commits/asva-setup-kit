// functions/api/member/logout.js
// POST /api/member/logout
// Ends the current member session and clears the cookie. Idempotent —
// clearing an already-gone session still succeeds.

import { makeSupabase, readCookie, clearCookie, MEMBER_COOKIE } from '../../../lib/member-auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const token    = readCookie(context.request, MEMBER_COOKIE);
  const supabase = makeSupabase(context.env);
  if (token && supabase) {
    try {
      await supabase
        .from('member_login_sessions')
        .update({ session_expires_at: new Date(0).toISOString() })
        .eq('session_token', token);
    } catch (e) {
      console.error('member logout error:', e.message || e);
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie() },
  });
}
