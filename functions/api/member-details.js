// functions/api/member-details.js
// Looks a member up by their confirmation token so the post-confirmation page
// (confirmed.html) can tailor its message. Returns the contact preference —
// used to decide whether to show the "AI safety news" line — and the member's
// constituency, so the page can name it in the confirmation message.
// Deliberately no name/email/address: the token is an unguessable UUID
// delivered only to the member's own inbox, but there's no reason to expose
// more than the page actually needs.
//   GET /api/member-details?token=<confirm_token>

import { createClient } from '@supabase/supabase-js';

export async function onRequest(context) {
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  if (context.request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(context.request.url);
  const token = (url.searchParams.get('token') || '').trim();
  if (!token || token.length > 100) return json({ error: 'Not found' }, 404);

  const supabaseUrl = (context.env.SUPABASE_URL || '').trim();
  const supabaseKey = (context.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) return json({ error: 'Server error' }, 500);

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: member, error } = await supabase
      .from('members')
      .select('contact_pref, constituency')
      .eq('confirm_token', token)
      .maybeSingle();
    if (error) throw error;
    if (!member) return json({ error: 'Not found' }, 404);
    return json({ contact_pref: member.contact_pref, constituency: member.constituency });
  } catch (e) {
    console.error('member-details error:', e);
    return json({ error: 'Server error' }, 500);
  }
}
