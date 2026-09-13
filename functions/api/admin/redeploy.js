// functions/api/admin/redeploy.js
// POST /api/admin/redeploy
// Triggers a fresh Cloudflare Pages deployment of the current production build
// by calling a Cloudflare "Deploy Hook". Used by the button on /goldenpath.html
// so the site can be redeployed without logging into the Cloudflare dashboard.
//
// The hook URL is a secret: anyone who has it can trigger a build, so it is NEVER
// exposed to the browser. It lives in the CF_DEPLOY_HOOK_URL environment variable
// (set it in Cloudflare Pages → Settings → Environment variables, as a Secret),
// and this endpoint only calls it after a valid admin session is confirmed.
//
// To create the hook: Cloudflare Pages → your project → Settings → Builds &
// deployments → Deploy hooks → add one for the production branch, then paste the
// generated URL into CF_DEPLOY_HOOK_URL.

import { requireAdmin, json } from '../../../lib/admin-auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const session = await requireAdmin(context);
  if (!session) return json({ error: 'Not authenticated' }, 401);

  const hook = (context.env.CF_DEPLOY_HOOK_URL || '').trim();
  if (!hook) {
    return json({
      error: 'Redeploy is not configured. Set CF_DEPLOY_HOOK_URL (a Cloudflare Pages deploy hook) in the environment.',
    }, 501);
  }

  try {
    const res = await fetch(hook, { method: 'POST' });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      console.error('deploy hook failed:', res.status, detail);
      return json({ error: `Deploy hook returned ${res.status}` }, 502);
    }
    return json({ success: true });
  } catch (e) {
    console.error('redeploy error:', e.message || e);
    return json({ error: 'Could not reach the deploy hook' }, 502);
  }
}
