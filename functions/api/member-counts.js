// functions/api/member-counts.js
// Returns aggregated member counts per constituency from the
// constituency_counts view in Supabase.
// Returns: { "Constituency Name": count, ... }

import { createClient } from '@supabase/supabase-js';

export async function onRequest(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = (context.env.SUPABASE_URL || '').trim();
  const supabaseKey = (context.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({}), { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('constituency_counts')
      .select('constituency, member_count');

    if (error) {
      return new Response(JSON.stringify({ _error: error.message, _details: error.details }), { status: 500, headers: corsHeaders });
    }

    const counts = {};
    for (const row of data || []) {
      if (row.constituency) counts[row.constituency] = row.member_count;
    }

    return new Response(JSON.stringify(counts), { status: 200, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ _error: e.message }), { status: 500, headers: corsHeaders });
  }
}
