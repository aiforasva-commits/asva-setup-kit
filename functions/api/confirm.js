// functions/api/confirm.js
// Confirms a member's email address, and applies any pending detail edits.
// Links in both the signup and the "updated details" emails point here:
//   GET /api/confirm?token=<confirm_token>
// On success (idempotent — clicking the link twice is fine) redirects to
// /confirmed.html?status=ok&token=<token> so the page can show the member
// exactly what they signed up with; bad or unknown tokens redirect with
// status=invalid, and unexpected failures with status=error.

import { createClient } from '@supabase/supabase-js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const redirect = (status, token) => {
    const qs = token ? `status=${status}&token=${encodeURIComponent(token)}` : `status=${status}`;
    return Response.redirect(`${url.origin}/confirmed.html?${qs}`, 302);
  };

  if (context.request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = (url.searchParams.get('token') || '').trim();
  if (!token || token.length > 100) return redirect('invalid');

  const supabaseUrl = (context.env.SUPABASE_URL || '').trim();
  const supabaseKey = (context.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) return redirect('error');

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // pending_update is added by a later migration (supabase/pending_update.sql).
    // Read it defensively so that if that migration hasn't been run yet, plain
    // email confirmation still works instead of erroring on a missing column.
    let sel = await supabase
      .from('members')
      .select('id, confirmed, pending_update')
      .eq('confirm_token', token)
      .maybeSingle();

    if (sel.error) {
      // Most likely the pending_update column doesn't exist yet — retry without
      // it. Any genuine (non-column) error will resurface on this second call.
      sel = await supabase
        .from('members')
        .select('id, confirmed')
        .eq('confirm_token', token)
        .maybeSingle();
    }

    if (sel.error) throw sel.error;
    const member = sel.data;
    if (!member) return redirect('invalid');

    // Build one update covering both jobs this link can do:
    //   • first-time confirmation (flip an unconfirmed member to confirmed)
    //   • applying a pending detail edit made by an already-confirmed member
    // Either, both, or neither may apply — clicking a stale link that has
    // nothing left to do simply redirects to the success page.
    const updates = {};
    if (member.pending_update && typeof member.pending_update === 'object') {
      Object.assign(updates, member.pending_update);
      updates.pending_update = null; // consume it so a re-click is a no-op
    }
    if (!member.confirmed) {
      updates.confirmed = true;
      updates.confirmed_at = new Date().toISOString();
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('members')
        .update(updates)
        .eq('id', member.id);
      if (updateError) throw updateError;
    }

    return redirect('ok', token);
  } catch (e) {
    console.error('Confirm error:', e);
    return redirect('error');
  }
}
