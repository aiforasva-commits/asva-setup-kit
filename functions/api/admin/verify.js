// functions/api/admin/verify.js
// GET /api/admin/verify?token=<magic_token>
// The destination of the emailed magic link. Activates the matching, unexpired,
// not-yet-used admin_sessions row, sets its 8-hour session window, drops the
// session_token into an HttpOnly cookie, and redirects to /goldenpath.html.
// Bad/expired/used tokens redirect to /goldenpath.html?login=invalid.

import { makeSupabase, sessionCookie, SESSION_TTL_MS } from '../../../lib/admin-auth.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const redirect = (query, cookie) => {
    const headers = { Location: `${url.origin}/goldenpath.html${query}` };
    if (cookie) headers['Set-Cookie'] = cookie;
    return new Response(null, { status: 302, headers });
  };

  if (context.request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = (url.searchParams.get('token') || '').trim();
  if (!token || token.length > 200) return redirect('?login=invalid');

  const supabase = makeSupabase(context.env);
  if (!supabase) return redirect('?login=error');

  try {
    const { data: row, error } = await supabase
      .from('admin_sessions')
      .select('id, session_token, activated, magic_expires_at')
      .eq('magic_token', token)
      .maybeSingle();

    if (error) throw error;
    if (!row) return redirect('?login=invalid');
    if (row.activated) return redirect('?login=invalid');             // single-use
    if (new Date(row.magic_expires_at) < new Date()) return redirect('?login=expired');

    const sessionExpires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const { error: updateError } = await supabase
      .from('admin_sessions')
      .update({ activated: true, session_expires_at: sessionExpires })
      .eq('id', row.id);
    if (updateError) throw updateError;

    return redirect('', sessionCookie(row.session_token, Math.floor(SESSION_TTL_MS / 1000)));
  } catch (e) {
    console.error('admin verify error:', e.message || e);
    return redirect('?login=error');
  }
}
