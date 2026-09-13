// functions/api/recommendations/export.js
// GET /api/recommendations/export[?status=pending]
// Authorization: Bearer <AGENT_INGEST_SECRET>
//
// Read-only export of recommendation drafts with their FULL content (bullets,
// sources, rationale, grade), so the research skill / maintenance passes can audit
// what has been drafted without an admin session — e.g. find drafts citing a
// low-credibility source, or re-examine the spread of grades. Defaults to pending;
// pass ?status=confirmed|rejected|all for the others.
//
// It never writes anything. The parallel human-facing list (/api/recommendations)
// stays admin-only; this agent-secret export exists purely for automated audits.

import { makeSupabase, agentSecretOk, json } from '../../../lib/admin-auth.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (!agentSecretOk(context)) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  const url    = new URL(context.request.url);
  const status = (url.searchParams.get('status') || 'pending').trim();

  let query = supabase
    .from('mp_recommendations')
    .select('id, constituency, mp_name, party, recommended_grade, rationale, bullets, sources, status, model, created_at')
    .order('constituency', { ascending: true });
  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    console.error('recommendations export error:', error.message || error);
    return json({ error: 'Failed to load recommendations' }, 500);
  }

  return json({ status, count: (data || []).length, recommendations: data || [] });
}
