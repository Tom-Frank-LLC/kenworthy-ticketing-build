// CORS + JSON response helpers shared by the checkout functions.
//
// The header list matches what supabase-js actually sends from the browser;
// omitting one of the x-supabase-client-* headers fails the preflight and the
// call never reaches the function.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function preflight() {
  return new Response(null, { headers: corsHeaders });
}
