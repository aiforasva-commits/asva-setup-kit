// lib/member-auth.js
// Shared helpers for the magic-link MEMBER session used to submit an edit to
// an MP's rating from /scorecard.html (functions/api/member/*,
// functions/api/member-submissions/*). See docs/mp-rating-agent.md.
//
// Deliberately parallel to, but entirely separate from, lib/admin-auth.js:
// different cookie name, different table, different (shorter) session
// window, and no "remember me". A member session must NEVER be accepted by
// requireAdmin(), and an admin session must never be accepted here — the two
// are different trust levels and must not share a code path.
//
// Flow:
//   1. /api/member/login   looks up the typed email against confirmed
//      `members` rows, and — only on a match — inserts a member_login_sessions
//      row with a one-time magic_token and emails a link to THAT member's own
//      inbox (never a caller-supplied destination that isn't already on file).
//   2. /api/member/verify  activates that row, sets session_expires_at, and
//      drops the session_token into an HttpOnly cookie.
//   3. requireMember() (below) validates that cookie on every protected
//      request and returns the member it belongs to.
//
// The service-role key bypasses RLS, so all of these run server-side only.

import { createClient } from '@supabase/supabase-js';

export const MEMBER_COOKIE  = 'asva_member';
export const MAGIC_TTL_MS   = 15 * 60 * 1000;      // magic link valid 15 min, same as admin
export const SESSION_TTL_MS = 2  * 60 * 60 * 1000; // 2 h — a member session is a one-off task, not a standing login; no "remember me"

export function makeSupabase(env) {
  const url = (env.SUPABASE_URL || '').trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

// A URL-safe random token. crypto.randomUUID() is fine but short; concatenating
// two gives ~256 bits of entropy for the session cookie / magic link.
export function randomToken() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `${MEMBER_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}

export function clearCookie() {
  return `${MEMBER_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Validates the member session cookie. Returns { id, email, first_name,
// constituency } on success, or null if there is no cookie, it doesn't
// match, isn't activated, has expired, or the member row is gone. Callers
// that get null should return 401.
export async function requireMember(context) {
  const supabase = makeSupabase(context.env);
  if (!supabase) return null;

  const token = readCookie(context.request, MEMBER_COOKIE);
  if (!token || token.length > 200) return null;

  const { data: session, error } = await supabase
    .from('member_login_sessions')
    .select('id, activated, session_expires_at, member_id')
    .eq('session_token', token)
    .maybeSingle();

  if (error || !session) return null;
  if (!session.activated) return null;
  if (!session.session_expires_at || new Date(session.session_expires_at) < new Date()) return null;

  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('id, email, first_name, constituency, confirmed')
    .eq('id', session.member_id)
    .maybeSingle();

  if (memberError || !member || !member.confirmed) return null;

  return member;
}

// Shared JSON responder.
export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
