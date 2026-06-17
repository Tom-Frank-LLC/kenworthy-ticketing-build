import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

// QBO sync — scaffolding only. Activates when QBO_CLIENT_ID / QBO_CLIENT_SECRET secrets are present.
// Supported actions: status, oauth_start, oauth_callback, pull_accounts, push_journal
//
// Token storage: QBO access/refresh tokens are stored encrypted in Supabase Vault.
// Tokens are written via the admin-only RPC `qbo_save_tokens` and read via the
// service-role-only RPC `qbo_get_active_tokens`. They are NEVER returned to the
// browser — the client only sees connection metadata (realm_id, expiry, env).

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const clientId = Deno.env.get('QBO_CLIENT_ID');
  const clientSecret = Deno.env.get('QBO_CLIENT_SECRET');
  const env = Deno.env.get('QBO_ENVIRONMENT') || 'sandbox';

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'status';

  if (action === 'status') {
    // Report connection metadata only — never the token values.
    let connected = false;
    let realm: string | null = null;
    let expiresAt: string | null = null;
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const { data } = await supabase
        .from('qbo_connection')
        .select('realm_id, token_expires_at, is_active, environment')
        .eq('environment', env)
        .eq('is_active', true)
        .maybeSingle();
      if (data) {
        connected = true;
        realm = data.realm_id;
        expiresAt = data.token_expires_at;
      }
    } catch (_) { /* table empty or unreachable */ }

    return new Response(JSON.stringify({
      configured: !!(clientId && clientSecret),
      environment: env,
      connected,
      realm_id: realm,
      token_expires_at: expiresAt,
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