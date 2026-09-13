// functions/api/admin/login.js
// POST /api/admin/login
// Emails a one-time magic login link to the fixed ASVA address so the holder of
// that inbox can open the MP-rating review page (/goldenpath.html). The requester
// supplies nothing — the destination is always adminEmail(env) — so this cannot
// be used to send mail to arbitrary addresses.
//
// Always returns a generic success (even when email isn't configured or the
// send fails) so the endpoint never reveals whether the admin address exists or
// whether a link was actually sent.

import { makeSupabase, randomToken, adminEmail, MAGIC_TTL_MS } from '../../../lib/admin-auth.js';
import { sendEmail, confirmationEnabled } from '../../../lib/email.js';
import { loginEmailHTML, SUBJECTS } from '../../../lib/comms-templates.js';

const RATE_LIMIT_MAX    = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes

async function hashKey(s) {
  const data = new TextEncoder().encode(s + ':asva-admin-rl');
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Fails open on DB error — a login link is low-value to spam and we never want a
// transient Supabase issue to lock the admin out entirely.
async function isRateLimited(supabase, ipHash) {
  try {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW).toISOString();
    const { data } = await supabase
      .from('rate_limits')
      .select('attempts, window_start')
      .eq('ip_hash', ipHash)
      .maybeSingle();

    if (!data || data.window_start < windowStart) {
      await supabase.from('rate_limits').upsert(
        { ip_hash: ipHash, attempts: 1, window_start: new Date().toISOString() },
        { onConflict: 'ip_hash' }
      );
      return false;
    }
    if (data.attempts >= RATE_LIMIT_MAX) return true;
    await supabase.from('rate_limits').update({ attempts: data.attempts + 1 }).eq('ip_hash', ipHash);
    return false;
  } catch {
    return false;
  }
}

const ok = () =>
  new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = makeSupabase(context.env);
  // Generic success even when unconfigured — don't leak setup state.
  if (!supabase || !confirmationEnabled(context.env)) return ok();

  const ip     = context.request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await hashKey(ip);
  if (await isRateLimited(supabase, ipHash)) return ok();

  const magicToken   = randomToken();
  const sessionToken = randomToken();
  const now          = Date.now();

  const { error } = await supabase.from('admin_sessions').insert([{
    magic_token:      magicToken,
    session_token:    sessionToken,
    magic_expires_at: new Date(now + MAGIC_TTL_MS).toISOString(),
    activated:        false,
  }]);
  if (error) {
    console.error('admin login insert error:', error.message || error);
    return ok();
  }

  const origin    = new URL(context.request.url).origin;
  const verifyUrl = `${origin}/api/admin/verify?token=${magicToken}`;
  await sendEmail(context.env, adminEmail(context.env), SUBJECTS.adminLogin, loginEmailHTML(verifyUrl));

  return ok();
}
