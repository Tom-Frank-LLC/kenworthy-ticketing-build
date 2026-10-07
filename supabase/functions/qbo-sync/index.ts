import { corsHeaders } from 'npm:@supabase/supabase-js@2.117.2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { actorHeaders } from '../_shared/audit.ts';
import { SITE_URL } from '../_shared/brand.ts';
import { callerHasRole, callerUser } from '../_shared/callers.ts';
import {
  DEFAULT_RETURN_TO,
  makeState,
  returnUrl,
  safeReturnPath,
  STATE_TTL_MS,
  stateSecret,
  verifyState,
  type StateBody,
} from './oauth_state.ts';

// QBO sync — OAuth + payroll export.
// Actions: status | oauth_start | oauth_callback | disconnect | refresh | payroll_export
//
// oauth_callback is reached by Intuit's browser redirect and is gated by the
// signed, single-use state (oauth_state.ts). Everything else is admin-only,
// checked in code by requireAdmin — the gateway checks nothing, because this
// function is verify_jwt = false (see supabase/config.toml).
//
// Tokens live in Supabase Vault; written via admin RPC `qbo_save_tokens`,
// read service-side via `qbo_get_active_tokens`. Tokens never reach the browser.

const INTUIT_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const INTUIT_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const SCOPES = 'com.intuit.quickbooks.accounting';

function configuredRedirectUri(req: Request) {
  // Prefer an explicit secret so it always matches whatever is registered in Intuit.
  const envUri = Deno.env.get('QBO_REDIRECT_URI');
  if (envUri) return envUri;

  // Build the public functions URL for this request so the OAuth redirect_uri
  // matches whatever host Intuit calls us back on. Edge runtime may see the request
  // as http internally, but the public callback is always https.
  const u = new URL(req.url);
  const host = u.host;
  return `https://${host}/functions/v1/qbo-sync?action=oauth_callback`;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * A service-role client. Pass the admin's id when it writes, so the audit
 * trigger names them rather than nobody (_shared/audit.ts, M11).
 */
function serviceClient(actorId?: string) {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    actorId ? { global: { headers: actorHeaders(actorId) } } : undefined,
  );
}

/**
 * The admin behind this request, or the response that refuses it.
 *
 * This function is `verify_jwt = false` (supabase/config.toml), because
 * Intuit's browser redirect to oauth_callback carries no JWT and the gateway
 * would 401 it. So the gateway checks nothing here, and every action except
 * the callback comes through this gate in code. `has_role` is hierarchical, so
 * a superadmin passes; the old exact `role === 'admin'` match refused one.
 */
async function requireAdmin(req: Request): Promise<{ id: string } | Response> {
  const user = await callerUser(createClient, req);
  if (!user) return json({ error: 'Not authenticated' }, 401);
  const isAdmin = await callerHasRole(serviceClient(), user.id, 'admin');
  if (isAdmin === null) return json({ error: 'Could not check your role. Try again.' }, 503);
  if (!isAdmin) return json({ error: 'Admin role required' }, 403);
  return { id: user.id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const clientId = Deno.env.get('QBO_CLIENT_ID');
  const clientSecret = Deno.env.get('QBO_CLIENT_SECRET');
  const env = Deno.env.get('QBO_ENVIRONMENT') || 'sandbox';

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'status';
  const redirectUri = configuredRedirectUri(req);

  // -------- oauth_callback: Intuit redirects browser here with code+state+realmId --------
  // The one action with no session. The signed, single-use state is its gate.
  if (action === 'oauth_callback') {
    if (!clientId || !clientSecret) {
      return new Response('QBO credentials not configured', { status: 400 });
    }
    const secret = stateSecret();
    if (!secret) {
      console.error('qbo-sync: QBO_STATE_SECRET is not set; refusing the callback');
      return new Response('QuickBooks connection is not configured', { status: 503 });
    }
    const code = url.searchParams.get('code');
    const realmId = url.searchParams.get('realmId');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');

    // Always our own configured origin. Never the Referer: that is whatever
    // page the browser came from, which an attacker can choose.
    const origin = SITE_URL;

    if (oauthError) {
      return Response.redirect(returnUrl(origin, DEFAULT_RETURN_TO, { qbo: 'error', message: oauthError }), 302);
    }
    if (!code || !realmId || !state) {
      return new Response('Missing code/realmId/state', { status: 400 });
    }

    let stateBody: StateBody;
    try { stateBody = await verifyState(state, secret); }
    catch (e) {
      return new Response(`Invalid state: ${(e as Error).message}`, { status: 400 });
    }

    const svc = serviceClient();

    // Consume the nonce before anything acts on the state. One DELETE …
    // RETURNING: of two racing callbacks only one gets the row back, and a
    // replayed URL finds nothing.
    const { data: consumed, error: consumeErr } = await svc
      .from('qbo_oauth_states')
      .delete()
      .eq('nonce', stateBody.n)
      .eq('user_id', stateBody.u)
      .eq('environment', stateBody.e)
      .gt('expires_at', new Date().toISOString())
      .select('nonce');
    if (consumeErr) {
      console.error('qbo-sync: nonce consume failed', consumeErr.message);
      return new Response('Could not check the connection request. Start again from the admin page.', { status: 503 });
    }
    if (!consumed || consumed.length !== 1) {
      return new Response('Invalid state: already used or unknown', { status: 400 });
    }
    if (stateBody.e !== env) {
      return new Response('Invalid state: environment changed', { status: 400 });
    }

    // Still an admin? The state is up to ten minutes old.
    const stillAdmin = await callerHasRole(svc, stateBody.u, 'admin');
    if (stillAdmin !== true) {
      return Response.redirect(returnUrl(origin, stateBody.r, { qbo: 'error', message: 'Admin role required' }), 302);
    }

    // Exchange auth code for tokens
    const basic = btoa(`${clientId}:${clientSecret}`);
    const tokenRes = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });
    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      return Response.redirect(
        returnUrl(origin, stateBody.r, {
          qbo: 'error',
          message: tokenJson.error_description || tokenJson.error || 'token_exchange_failed',
        }),
        302,
      );
    }

    const expiresAt = new Date(Date.now() + (tokenJson.expires_in ?? 3600) * 1000).toISOString();

    // Save tokens via a service-role-only SECURITY DEFINER RPC. qbo_save_tokens
    // (the admin RPC) needs auth.uid(), which a browser redirect does not have;
    // qbo_save_tokens_service takes the admin's id from the verified state.
    const { error: saveErr } = await svc.rpc('qbo_save_tokens_service', {
      p_user_id: stateBody.u,
      p_realm_id: realmId,
      p_access_token: tokenJson.access_token,
      p_refresh_token: tokenJson.refresh_token,
      p_expires_at: expiresAt,
      p_environment: env,
    });
    if (saveErr) {
      console.error('qbo-sync: saving tokens failed', saveErr.message);
      return Response.redirect(
        returnUrl(origin, stateBody.r, { qbo: 'error', message: 'Could not save the connection' }),
        302,
      );
    }

    return Response.redirect(returnUrl(origin, stateBody.r, { qbo: 'connected', realm: realmId }), 302);
  }

  // Every other action is admin-only.
  const gate = await requireAdmin(req);
  if (gate instanceof Response) return gate;
  const adminId = gate.id;

  if (action === 'status') {
    // Report connection metadata only — never the token values.
    let connected = false;
    let realm: string | null = null;
    let expiresAt: string | null = null;
    try {
      const { data } = await serviceClient()
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

    return json({
      configured: !!(clientId && clientSecret && stateSecret()),
      environment: env,
      connected,
      realm_id: realm,
      token_expires_at: expiresAt,
      message: clientId && clientSecret && stateSecret()
        ? 'QBO credentials configured. Click Connect to authorize.'
        : 'QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_STATE_SECRET must all be set to enable live sync.',
      redirect_uri: redirectUri,
    });
  }

  // -------- oauth_start: authenticated admin → returns Intuit authorize URL --------
  if (action === 'oauth_start') {
    if (!clientId || !clientSecret) {
      return json({ error: 'QBO credentials not configured' }, 400);
    }
    const secret = stateSecret();
    if (!secret) {
      console.error('qbo-sync: QBO_STATE_SECRET is not set; refusing oauth_start');
      return json({ error: 'QBO_STATE_SECRET not configured' }, 503);
    }

    let payload: { return_to?: unknown } = {};
    try { payload = await req.json(); } catch (_) { /* no body */ }
    const returnTo = safeReturnPath(payload.return_to);

    const now = Date.now();
    const nonce = crypto.randomUUID();
    const svc = serviceClient(adminId);
    // Housekeeping: a state nobody came back with is dead after its TTL.
    await svc.from('qbo_oauth_states').delete().lt('expires_at', new Date(now).toISOString());
    const { error: nonceErr } = await svc.from('qbo_oauth_states').insert({
      nonce,
      user_id: adminId,
      environment: env,
      expires_at: new Date(now + STATE_TTL_MS).toISOString(),
    });
    if (nonceErr) {
      console.error('qbo-sync: recording the OAuth nonce failed', nonceErr.message);
      return json({ error: 'Could not start the QuickBooks connection. Try again.' }, 503);
    }
    const state = await makeState({ u: adminId, e: env, r: returnTo, n: nonce, t: now }, secret);

    const authUrl = new URL(INTUIT_AUTHORIZE_URL);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);

    console.log('QBO oauth_start', { redirect_uri: redirectUri, environment: env, user_id: adminId });

    return json({
      authorize_url: authUrl.toString(),
      redirect_uri: redirectUri,
      environment: env,
    });
  }

  // -------- disconnect --------
  if (action === 'disconnect') {
    // As the admin, not the service role: qbo_disconnect checks has_role on
    // auth.uid() itself, a second gate behind requireAdmin.
    const authHeader = req.headers.get('Authorization') || '';
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data, error } = await supabaseUser.rpc('qbo_disconnect', { p_environment: env });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ disconnected: data === true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // -------- refresh: rotate access token (uses refresh_token from vault) --------
  if (action === 'refresh') {
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'QBO credentials not configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const svc = serviceClient(adminId);
    const { data: tokens, error: tokErr } = await svc.rpc('qbo_get_active_tokens', { p_environment: env });
    if (tokErr || !tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ error: 'No active QBO connection' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const t = tokens[0];
    const basic = btoa(`${clientId}:${clientSecret}`);
    const res = await fetch(INTUIT_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: t.refresh_token,
      }).toString(),
    });
    const j = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: j.error_description || j.error || 'refresh_failed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const expiresAt = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
    await svc.rpc('qbo_save_tokens_service', {
      p_user_id: null,
      p_realm_id: t.realm_id,
      p_access_token: j.access_token,
      p_refresh_token: j.refresh_token || t.refresh_token,
      p_expires_at: expiresAt,
      p_environment: env,
    });
    return new Response(JSON.stringify({ refreshed: true, expires_at: expiresAt }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  if (action === 'payroll_export') {
    const supabase = serviceClient(adminId);
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