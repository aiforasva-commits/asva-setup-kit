// functions/api/admin/stats.js
// GET /api/admin/stats  (admin session cookie required)
// Aggregate membership counts for the Golden Path tally. Counts only — no PII.
//   { members, opted_in, pending_partner_export }
// members             = confirmed members (the public tally basis)
// opted_in            = confirmed members who opted in to AI safety news
// pending_partner_export = opted-in members not yet sent to the partners
//                          (null if the partner_exported_at column isn't present)

import { requireAdmin, makeSupabase, json } from '../../../lib/admin-auth.js';

const OPTED_IN = 'urgent_and_updates';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const session = await requireAdmin(context);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  // head:true + count:'exact' returns only the count, never the rows.
  async function countWhere(build) {
    const { count, error } = await build(supabase.from('members').select('*', { count: 'exact', head: true }));
    if (error) throw error;
    return count || 0;
  }

  try {
    const members  = await countWhere(q => q.eq('confirmed', true));
    const optedIn  = await countWhere(q => q.eq('confirmed', true).eq('contact_pref', OPTED_IN));

    // Resilient: if partner_exported_at doesn't exist yet, report null rather
    // than failing the whole tally.
    let pendingExport = null;
    try {
      pendingExport = await countWhere(q =>
        q.eq('confirmed', true).eq('contact_pref', OPTED_IN).is('partner_exported_at', null));
    } catch (e) {
      console.error('stats: pending_partner_export unavailable:', e?.message || e);
    }

    return json({ members, opted_in: optedIn, pending_partner_export: pendingExport },
      200, { 'Cache-Control': 'no-store' });
  } catch (e) {
    console.error('admin stats error:', e?.message || e);
    return json({ error: 'Failed to load stats' }, 500);
  }
}
