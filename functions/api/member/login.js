// functions/api/member/login.js
// POST /api/member/login
// Body: { email, constituency?, mp_name? }
// Emails a one-time magic login link so a confirmed ASVA member can suggest an
// edit to their MP's scorecard rating. `constituency`/`mp_name`, if given, are
// carried through the login session so /api/member/verify can deep-link the
// member straight back to the card they started from.
//
// UNLIKE /api/admin/login (which only ever emails a fixed address), this
// endpoint necessarily sends to whatever address is typed — so it takes extra
// care not to become a way to spam or phish a stranger:
//   • a link is only ever sent when the email matches an existing, confirmed
//     row in `members` — typing someone else's address does nothing to them
//     beyond one row in the rate-limit table;
//   • always returns the same generic success, whether or not the email
//     matched, whether or not it's rate-limited, and whether or not email
//     sending is configured — the response never reveals membership status;
//   • rate-limited by BOTH the requester's IP and the target email's
//     canonical form, so repeatedly naming one victim's address is capped
//     even from many different IPs.

import { makeSupabase, randomToken, MAGIC_TTL_MS } from '../../../lib/member-auth.js';
import { sendEmail, confirmationEnabled } from '../../../lib/email.js';
import { memberLoginEmailHTML, SUBJECTS } from '../../../lib/comms-templates.js';
import { normalizeEmail } from '../../../lib/normalize-email.js';

const IP_LIMIT_MAX      = 8;
const IP_LIMIT_WINDOW   = 15 * 60 * 1000;  // 15 minutes
const EMAIL_LIMIT_MAX   = 5;
const EMAIL_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour — the harassment-prevention cap

async function hashKey(s) {
  const data = new TextEncoder().encode(s + ':asva-member-rl');
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Fails open on DB error — a Supabase hiccup must never lock a real member out.
async function isRateLimited(supabase, key, max, windowMs) {
  try {
    const windowStart = new Date(Date.now() - windowMs).toISOString();
    const { data } = await supabase
      .from('rate_limits')
      .select('attempts, window_start')
      .eq('ip_hash', key)
      .maybeSingle();

    if (!data || data.window_start < windowStart) {
      await supabase.from('rate_limits').upsert(
        { ip_hash: key, attempts: 1, window_start: new Date().toISOString() },
        { onConflict: 'ip_hash' }
      );
      return false;
    }
    if (data.attempts >= max) return true;
    await supabase.from('rate_limits').update({ attempts: data.attempts + 1 }).eq('ip_hash', key);
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

  let body;
  try { body = await context.request.json(); } catch { return ok(); }

  const email = String(body.email ?? '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return ok();

  const constituency = body.constituency ? String(body.constituency).trim().slice(0, 200) : null;
  const mpName        = body.mp_name ? String(body.mp_name).trim().slice(0, 200) : null;

  const ip           = context.request.headers.get('CF-Connecting-IP') || 'unknown';
  const canonical     = normalizeEmail(email);
  const ipKey         = await hashKey('ip:' + ip);
  const emailKey      = await hashKey('email:' + canonical);

  if (await isRateLimited(supabase, ipKey, IP_LIMIT_MAX, IP_LIMIT_WINDOW)) return ok();
  if (await isRateLimited(supabase, emailKey, EMAIL_LIMIT_MAX, EMAIL_LIMIT_WINDOW)) return ok();

  try {
    const { data: member } = await supabase
      .from('members')
      .select('id, email, confirmed')
      .eq('email_canonical', canonical)
      .maybeSingle();

    // No match, or not a confirmed member yet: do nothing further, but still
    // return the same generic success below.
    if (member && member.confirmed) {
      const magicToken   = randomToken();
      const sessionToken = randomToken();
      const now          = Date.now();

      const { error } = await supabase.from('member_login_sessions').insert([{
        member_id:              member.id,
        magic_token:            magicToken,
        session_token:          sessionToken,
        magic_expires_at:       new Date(now + MAGIC_TTL_MS).toISOString(),
        activated:              false,
        return_to_constituency: constituency,
        return_to_mp_name:      mpName,
      }]);

      if (!error) {
        const origin    = new URL(context.request.url).origin;
        const verifyUrl = `${origin}/api/member/verify?token=${magicToken}`;
        // Always to the member's OWN address on file, never the raw typed
        // string — the lookup above is the only thing that decides the
        // destination past this point.
        await sendEmail(context.env, member.email, SUBJECTS.memberLogin, memberLoginEmailHTML(verifyUrl));
      } else {
        console.error('member login insert error:', error.message || error);
      }
    }
  } catch (e) {
    console.error('member login error:', e.message || e);
  }

  return ok();
}
