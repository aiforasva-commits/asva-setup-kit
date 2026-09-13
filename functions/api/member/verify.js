// functions/api/member/verify.js
// GET /api/member/verify?token=<magic_token>
// The destination of the emailed magic link. Activates the matching,
// unexpired, not-yet-used member_login_sessions row, sets its session
// window, drops the session_token into an HttpOnly cookie, and redirects back
// to /scorecard.html — deep-linked to the constituency/MP the member started
// from (if any) so the card and the edit panel reopen automatically instead
// of dropping them on a blank page. Bad/expired/used tokens redirect with
// memberLogin=invalid|expired|error so the page can show a message.

import { makeSupabase, sessionCookie, SESSION_TTL_MS } from '../../../lib/member-auth.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const redirect = (query, cookie) => {
    const headers = { Location: `${url.origin}/scorecard.html${query}` };
    if (cookie) headers['Set-Cookie'] = cookie;
    return new Response(null, { status: 302, headers });
  };

  if (context.request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = (url.searchParams.get('token') || '').trim();
  if (!token || token.length > 200) return redirect('?memberLogin=invalid');

  const supabase = makeSupabase(context.env);
  if (!supabase) return redirect('?memberLogin=error');

  try {
    const { data: row, error } = await supabase
      .from('member_login_sessions')
      .select('id, session_token, activated, magic_expires_at, return_to_constituency, return_to_mp_name')
      .eq('magic_token', token)
      .maybeSingle();

    if (error) throw error;
    if (!row) return redirect('?memberLogin=invalid');
    if (row.activated) return redirect('?memberLogin=invalid');             // single-use
    if (new Date(row.magic_expires_at) < new Date()) return redirect('?memberLogin=expired');

    const sessionExpires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const { error: updateError } = await supabase
      .from('member_login_sessions')
      .update({ activated: true, session_expires_at: sessionExpires })
      .eq('id', row.id);
    if (updateError) throw updateError;

    const qs = new URLSearchParams({ memberEdit: '1' });
    if (row.return_to_constituency) qs.set('constituency', row.return_to_constituency);
    if (row.return_to_mp_name) qs.set('editMp', row.return_to_mp_name);

    return redirect('?' + qs.toString(), sessionCookie(row.session_token, Math.floor(SESSION_TTL_MS / 1000)));
  } catch (e) {
    console.error('member verify error:', e.message || e);
    return redirect('?memberLogin=error');
  }
}
