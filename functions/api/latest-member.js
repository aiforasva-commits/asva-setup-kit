// functions/api/latest-member.js
// Returns the constituency of the most recently signed-up member, so the
// constituency map (member view) can highlight it with a celebratory animation.
// Only confirmed members with a constituency are considered — the same rule the
// constituency_counts view uses — so an unconfirmed signup is never surfaced.
// Returns: { "constituency": "Constituency Name" }  (constituency is null if none)

import { createClient } from '@supabase/supabase-js';

export async function onRequest(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = (context.env.SUPABASE_URL || '').trim();
  const supabaseKey = (context.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ constituency: null }), { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('members')
      .select('constituency')
      .eq('confirmed', true)
      .not('constituency', 'is', null)
      .order('signed_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ constituency: null, _error: error.message }), { status: 200, headers: corsHeaders });
    }

    return new Response(
      JSON.stringify({ constituency: data ? data.constituency : null }),
      { status: 200, headers: corsHeaders }
    );
  } catch (e) {
    return new Response(JSON.stringify({ constituency: null, _error: e.message }), { status: 200, headers: corsHeaders });
  }
}
