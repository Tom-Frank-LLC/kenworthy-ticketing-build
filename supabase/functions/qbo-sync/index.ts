import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// QBO sync — scaffolding only. Activates when QBO_CLIENT_ID / QBO_CLIENT_SECRET secrets are present.
// Supported actions: status, oauth_start, oauth_callback, pull_accounts, push_journal

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const clientId = Deno.env.get('QBO_CLIENT_ID');
  const clientSecret = Deno.env.get('QBO_CLIENT_SECRET');
  const env = Deno.env.get('QBO_ENVIRONMENT') || 'sandbox';

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'status';

  if (action === 'status') {
    return new Response(JSON.stringify({
      configured: !!(clientId && clientSecret),
      environment: env,
      message: clientId && clientSecret
        ? 'QBO credentials configured. Click Connect to authorize.'
        : 'QBO_CLIENT_ID and QBO_CLIENT_SECRET not set. Add them in project secrets to enable live sync.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    error: 'not_implemented',
    message: 'QBO live sync scaffolding is in place. Provide QBO_CLIENT_ID / QBO_CLIENT_SECRET to activate.',
  }), { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});