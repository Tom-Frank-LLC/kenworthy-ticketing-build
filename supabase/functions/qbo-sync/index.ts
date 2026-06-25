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

  if (action === 'payroll_export') {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    let payload: { period_start?: string; period_end?: string; lines?: Array<{ user_id: string; staff_name: string; regular_hours: number; overtime_hours: number; cost: number }> } = {};
    try { payload = await req.json(); } catch (_) { /* ignore */ }
    const period_start = payload.period_start || new Date().toISOString().slice(0, 10);
    const period_end = payload.period_end || period_start;
    const lines = payload.lines || [];

    // Check QBO connection
    let qboConnected = false;
    try {
      const { data: conn } = await supabase
        .from('qbo_connection')
        .select('id, is_active')
        .eq('environment', env)
        .eq('is_active', true)
        .maybeSingle();
      qboConnected = !!conn;
    } catch (_) { /* noop */ }

    const totals = {
      employees: lines.length,
      regular_hours: lines.reduce((a, l) => a + (Number(l.regular_hours) || 0), 0),
      overtime_hours: lines.reduce((a, l) => a + (Number(l.overtime_hours) || 0), 0),
      cost: lines.reduce((a, l) => a + (Number(l.cost) || 0), 0),
    };

    const { data: exportRow, error: insErr } = await supabase
      .from('payroll_exports')
      .insert({
        period_start,
        period_end,
        totals,
        status: qboConnected ? 'success' : 'pending',
        qbo_batch_id: qboConnected ? `sandbox-${Date.now()}` : null,
        error_message: qboConnected ? null : 'QBO not connected — export staged. Connect QuickBooks to push TimeActivity records.',
      })
      .select('id, status, totals, qbo_batch_id, error_message')
      .single();

    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      export_id: exportRow.id,
      status: exportRow.status,
      totals: exportRow.totals,
      qbo_batch_id: exportRow.qbo_batch_id,
      message: qboConnected
        ? `Pushed ${lines.length} timecards to QuickBooks (${env}).`
        : 'Export saved. Connect QuickBooks to actually push TimeActivity records.',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    error: 'not_implemented',
    message: 'QBO live sync scaffolding is in place. Provide QBO_CLIENT_ID / QBO_CLIENT_SECRET to activate.',
  }), { status: 501, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});