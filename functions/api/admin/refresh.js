// functions/api/admin/refresh.js
// POST /api/admin/refresh   Body: { remember?: boolean }
// Slides the current admin session's expiry forward and re-issues the session
// cookie, so an open/active review session doesn't lapse mid-edit. The golden
// path pings this on a timer while its "Keep me signed in" toggle is on.
//   remember=true  → 30-day window (survives closing the tab)
//   remember=false → default 8-hour window from now
// Requires a still-valid admin session; an already-expired one returns 401 (you
// then have to log in again — this can extend a live session, not revive a dead one).

import {
  requireAdmin, makeSupabase, sessionCookie, readCookie,
  ADMIN_COOKIE, SESSION_TTL_MS, REMEMBER_TTL_MS, json,
} from '../../../lib/admin-auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const session = await requireAdmin(context);
  if (!session) return json({ error: 'Not authenticated' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  let remember = false;
  try { const body = await context.request.json(); remember = !!body.remember; } catch {}

  const ttl     = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
  const expires = new Date(Date.now() + ttl).toISOString();

  const { error } = await supabase
    .from('admin_sessions')
    .update({ session_expires_at: expires })
    .eq('id', session.id);

  if (error) {
    console.error('admin refresh error:', error.message || error);
    return json({ error: 'Failed to refresh session' }, 500);
  }

  // Re-issue the cookie with a matching Max-Age — otherwise the browser would
  // still drop it at the original 8-hour mark regardless of the DB expiry.
  const token = readCookie(context.request, ADMIN_COOKIE);
  return json({ success: true, expires_at: expires, remember }, 200, {
    'Set-Cookie': sessionCookie(token, Math.floor(ttl / 1000)),
  });
}
