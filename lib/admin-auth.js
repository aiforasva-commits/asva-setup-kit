// lib/admin-auth.js
// Shared helpers for the magic-link admin session used by the MP-rating review
// page (/goldenpath.html) and its API endpoints (functions/api/admin/*,
// functions/api/recommendations/*). See docs/mp-rating-agent.md.
//
// Flow:
//   1. /api/admin/login  inserts an admin_sessions row with a one-time
//      magic_token and emails a link to the fixed ASVA address.
//   2. /api/admin/verify activates that row, sets session_expires_at, and drops
//      the session_token into an HttpOnly cookie.
//   3. requireAdmin() (below) validates that cookie on every protected request.
//
// The service-role key bypasses RLS, so all of these run server-side only.

import { createClient } from '@supabase/supabase-js';

export const ADMIN_COOKIE      = 'asva_admin';
export const MAGIC_TTL_MS      = 15 * 60 * 1000;           // magic link valid 15 min
export const SESSION_TTL_MS    = 8  * 60 * 60 * 1000;      // default session window 8 h
export const REMEMBER_TTL_MS   = 30 * 24 * 60 * 60 * 1000; // "keep me signed in" window 30 d

// The one address magic links are ever sent to. Configurable so a test
// deployment can point elsewhere, but it is NEVER taken from the request — that
// would turn the login endpoint into an open email relay.
export function adminEmail(env) {
  return (env.ADMIN_EMAIL || 'contact@aisafetyvoteralliance.co.uk').trim();
}

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

// Parse a single cookie value out of a Cookie header.
export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionCookie(token, maxAgeSeconds) {
  // Secure + HttpOnly + SameSite=Lax: not readable by JS, only sent to this
  // site, and only over HTTPS. Lax lets the cookie ride the top-level redirect
  // back from the emailed verify link.
  const parts = [
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}

export function clearCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Validates the admin session cookie. Returns the session row on success, or
// null if there is no cookie, it doesn't match, it isn't activated, or it has
// expired. Callers that get null should return 401.
export async function requireAdmin(context) {
  const supabase = makeSupabase(context.env);
  if (!supabase) return null;

  const token = readCookie(context.request, ADMIN_COOKIE);
  if (!token || token.length > 200) return null;

  const { data, error } = await supabase
    .from('admin_sessions')
    .select('id, activated, session_expires_at')
    .eq('session_token', token)
    .maybeSingle();

  if (error || !data) return null;
  if (!data.activated) return null;
  if (!data.session_expires_at || new Date(data.session_expires_at) < new Date()) return null;

  return data;
}

// Bearer-secret check for the agent-facing endpoints (recommendation ingest and
// the research queue). Length-checked equality against AGENT_INGEST_SECRET.
export function agentSecretOk(context) {
  const expected = (context.env.AGENT_INGEST_SECRET || '').trim();
  if (!expected) return false;
  const header = context.request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const given = m ? m[1].trim() : '';
  return given.length === expected.length && given === expected;
}

// Shared JSON responder.
export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
