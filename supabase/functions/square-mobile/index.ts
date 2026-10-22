import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders } from '../_shared/http.ts';
import { actorHeaders, logStaffAction } from '../_shared/audit.ts';
import { SITE_URL } from '../_shared/brand.ts';
import { callerHasRole, requireRole } from '../_shared/callers.ts';
import { loadSquareConfig, SQUARE_API_VERSION, type SquareConfig } from '../_shared/square.ts';
import {
  makeState,
  returnUrl,
  safeReturnPath,
  STATE_TTL_MS,
  stateSecretFrom,
  verifyState,
  type StateBody,
} from '../_shared/oauth_state.ts';
import { authorizeUrl, DEFAULT_RETURN_TO, isExpired, needsRefresh, OAUTH_HOST } from './oauth.ts';

// square-mobile — the Square OAuth connection behind the box-office Stand
// (docs/briefs/BRIEF-ios-stand-reader.md).
//
// Square's Mobile Payments SDK, on the iPad in the Stand, takes payments only
// with an OAuth access token in production. This function holds that token
// and hands it to signed-in staff.
//
// Actions:
//   token          staff   {access_token, location_id, environment, expires_at}
//   status         staff   {environment, connected, merchant_id, expires_at, connected_at}
//   connect_start  admin   {url}: Square's consent screen
//   oauth_callback (none)  Square's browser redirect; gated by the signed, single-use state
//   disconnect     admin   revoke (best effort) and forget the tokens
//
// verify_jwt = false (supabase/config.toml): Square's redirect carries no JWT.
// So the gateway checks nothing, and every action but the callback is gated in
// code by requireRole. The OAuth pattern is qbo-sync's, which has the same
// shape and was hardened in the 2026-10-06 audit (L4).
//
// In the sandbox (staging) `token` returns the configured sandbox access token,
// which Square allows for the SDK there. That is staging's personal token, so
// staging staff can read it; it moves only sandbox money.

const STATE_SECRET = 'SQUARE_OAUTH_STATE_SECRET';
const CLIENT_SECRET = 'SQUARE_OAUTH_CLIENT_SECRET';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** A service-role client; pass the caller's id when it writes (audit trigger). */
function serviceClient(actorId?: string) {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    actorId ? { global: { headers: actorHeaders(actorId) } } : undefined,
  );
}

function clientSecret(): string | null {
  const s = (Deno.env.get(CLIENT_SECRET) ?? '').trim();
  return s ? s : null;
}

/** POST to Square's OAuth endpoint. Never throws; a network failure is a 502-shaped result. */
async function oauthPost(config: SquareConfig, path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  try {
    const res = await fetch(`${OAUTH_HOST[config.environment]}${path}`, {
      method: 'POST',
      headers: { 'Square-Version': SQUARE_API_VERSION, 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
    let data: any = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error('[square-mobile] OAuth call failed', path, err);
    return { ok: false, status: 502, data: null };
  }
}

/** Does this token belong to OUR seller? It must be able to read the configured location. */
async function tokenOwnsLocation(config: SquareConfig, accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${config.apiBase}/locations/${encodeURIComponent(config.locationId)}`, {
      headers: { 'Square-Version': SQUARE_API_VERSION, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.location?.id === config.locationId;
  } catch {
    return false;
  }
}

function squareError(data: any, fallback: string): string {
  return data?.message || data?.errors?.[0]?.detail || data?.errors?.[0]?.code || data?.error_description || data?.error || fallback;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const square = loadSquareConfig();
  if (!square.ok) return json({ error: square.error }, 500);
  const config = square.config;
  const env = config.environment;

  const url = new URL(req.url);

  // -------- oauth_callback: Square's browser redirect, with code + state --------
  // The one action with no session. The signed, single-use state is its gate.
  // Any GET is the callback: every other action is a POST. So the redirect URL
  // registered with Square works with or without `?action=oauth_callback`.
  if (req.method === 'GET') {
    const secret = stateSecretFrom(STATE_SECRET);
    if (!secret) {
      console.error(`square-mobile: ${STATE_SECRET} is not set; refusing the callback`);
      return new Response('The Square connection is not configured', { status: 503 });
    }
    // Always our own origin, never the Referer.
    const back = (path: string, params: Record<string, string>) =>
      Response.redirect(returnUrl(SITE_URL, path, params, DEFAULT_RETURN_TO), 302);

    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      return back(DEFAULT_RETURN_TO, { square: 'error', message: url.searchParams.get('error_description') || oauthError });
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return new Response('Missing code/state', { status: 400 });

    let body: StateBody;
    try { body = await verifyState(state, secret); }
    catch (e) { return new Response(`Invalid state: ${(e as Error).message}`, { status: 400 }); }

    const svc = serviceClient();
    // Consume the nonce before anything acts on the state.
    const { data: consumed, error: consumeErr } = await svc
      .from('square_oauth_states')
      .delete()
      .eq('nonce', body.n)
      .eq('user_id', body.u)
      .eq('environment', body.e)
      .gt('expires_at', new Date().toISOString())
      .select('nonce');
    if (consumeErr) {
      console.error('square-mobile: nonce consume failed', consumeErr.message);
      return new Response('Could not check the connection request. Start again from the POS.', { status: 503 });
    }
    if (!consumed || consumed.length !== 1) return new Response('Invalid state: already used or unknown', { status: 400 });
    if (body.e !== env) return new Response('Invalid state: environment changed', { status: 400 });

    // Still an admin? Role only, not MFA: a browser redirect has no session.
    // connect_start, which minted this state, is behind the MFA gate.
    const stillAdmin = await callerHasRole(svc, body.u, 'admin');
    if (stillAdmin !== true) return back(body.r, { square: 'error', message: 'Admin role required' });

    const secretValue = clientSecret();
    if (!secretValue) return back(body.r, { square: 'error', message: `${CLIENT_SECRET} is not set` });

    const exchanged = await oauthPost(config, '/oauth2/token', {
      client_id: config.applicationId,
      client_secret: secretValue,
      code,
      grant_type: 'authorization_code',
    });
    const t = exchanged.data;
    if (!exchanged.ok || !t?.access_token) {
      console.error('square-mobile: code exchange failed', exchanged.status, JSON.stringify(t?.errors ?? t?.error ?? ''));
      return back(body.r, { square: 'error', message: squareError(t, 'Square did not issue a token') });
    }

    // The account that approved must be the one this site sells as. A
    // different Square account would take the Stand's payments into the
    // wrong bank account, and the server could not read them back to confirm.
    if (!(await tokenOwnsLocation(config, t.access_token))) {
      console.error('square-mobile: the approving account cannot read our location; not saved');
      await oauthPost(config, '/oauth2/revoke', { client_id: config.applicationId, access_token: t.access_token }, { Authorization: `Client ${secretValue}` });
      return back(body.r, { square: 'error', message: 'That Square account is not the Kenworthy account. Sign in to Square as the Kenworthy account and try again.' });
    }

    const { error: saveErr } = await serviceClient(body.u).rpc('square_mobile_save_tokens', {
      p_environment: env,
      p_merchant_id: t.merchant_id ?? '',
      p_access_token: t.access_token,
      p_refresh_token: t.refresh_token ?? null,
      p_expires_at: t.expires_at ?? null,
      p_connected_by: body.u,
    });
    if (saveErr) {
      console.error('square-mobile: saving tokens failed', saveErr.message);
      return back(body.r, { square: 'error', message: 'Could not save the connection' });
    }
    await logStaffAction({ id: body.u }, 'square_mobile.connected', 'square_mobile_connection', {
      environment: env, merchant_id: t.merchant_id ?? null, expires_at: t.expires_at ?? null,
    }, env);
    return back(body.r, { square: 'connected' });
  }

  // Every other action is a POST from a signed-in caller.
  let payload: { action?: string; return_to?: unknown } = {};
  try { payload = await req.json(); } catch { /* no body */ }
  const action = payload.action ?? url.searchParams.get('action') ?? '';

  const needed = action === 'connect_start' || action === 'disconnect' ? 'admin' : 'staff';
  const caller = await requireRole(req, serviceClient(), needed, {
    headers: corsHeaders,
    unauthorized: 'Not authenticated',
    forbidden: needed === 'admin' ? 'Admin role required' : 'Staff access required',
  });
  if (caller instanceof Response) return caller;

  if (action === 'token') {
    if (env === 'sandbox') {
      return json({ access_token: config.accessToken, location_id: config.locationId, environment: env, expires_at: null });
    }
    const svc = serviceClient(caller.id);
    const { data: rows, error } = await svc.rpc('square_mobile_get_tokens', { p_environment: env });
    if (error) {
      console.error('square-mobile: reading tokens failed', error.message);
      return json({ error: 'Could not read the Square connection. Try again.' }, 503);
    }
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.access_token) {
      return json({ error: 'Square is not connected for the Stand yet. An admin must press Connect Square.', code: 'not_connected' }, 409);
    }
    if (!needsRefresh(row.token_expires_at)) {
      return json({ access_token: row.access_token, location_id: config.locationId, environment: env, expires_at: row.token_expires_at });
    }

    const secretValue = clientSecret();
    const refreshed = secretValue && row.refresh_token
      ? await oauthPost(config, '/oauth2/token', {
          client_id: config.applicationId,
          client_secret: secretValue,
          grant_type: 'refresh_token',
          refresh_token: row.refresh_token,
        })
      : null;
    const r = refreshed?.data;
    if (refreshed?.ok && r?.access_token) {
      const { error: saveErr } = await svc.rpc('square_mobile_save_tokens', {
        p_environment: env,
        p_merchant_id: r.merchant_id ?? row.merchant_id,
        p_access_token: r.access_token,
        p_refresh_token: r.refresh_token ?? null,
        p_expires_at: r.expires_at ?? null,
        p_connected_by: null,
      });
      if (saveErr) console.error('square-mobile: saving the refreshed token failed', saveErr.message);
      return json({ access_token: r.access_token, location_id: config.locationId, environment: env, expires_at: r.expires_at ?? null });
    }

    console.error('square-mobile: refresh failed', refreshed?.status ?? 'no secret or refresh token', JSON.stringify(r?.errors ?? r?.error ?? ''));
    // A token that still works is better than none; the next call tries again.
    if (!isExpired(row.token_expires_at)) {
      return json({ access_token: row.access_token, location_id: config.locationId, environment: env, expires_at: row.token_expires_at });
    }
    if (!secretValue) return json({ error: `${CLIENT_SECRET} is not set, so the Square connection cannot be renewed.` }, 500);
    return json({ error: 'The Square connection has expired and could not be renewed. An admin must press Connect Square again.', code: 'not_connected' }, 409);
  }

  if (action === 'status') {
    if (env === 'sandbox') {
      return json({ environment: env, connected: true, merchant_id: null, expires_at: null, connected_at: null });
    }
    const { data, error } = await serviceClient().from('square_mobile_connection')
      .select('merchant_id, token_expires_at, connected_at')
      .eq('environment', env)
      .maybeSingle();
    if (error) return json({ error: 'Could not read the Square connection.' }, 503);
    return json({
      environment: env,
      connected: !!data,
      merchant_id: data?.merchant_id ?? null,
      expires_at: data?.token_expires_at ?? null,
      connected_at: data?.connected_at ?? null,
    });
  }

  if (action === 'connect_start') {
    const secret = stateSecretFrom(STATE_SECRET);
    if (!secret) {
      console.error(`square-mobile: ${STATE_SECRET} is not set; refusing connect_start`);
      return json({ error: `${STATE_SECRET} is not set` }, 503);
    }
    if (!clientSecret()) return json({ error: `${CLIENT_SECRET} is not set. Copy the Application secret from the Square Developer Console (OAuth page) into it.` }, 503);

    const returnTo = safeReturnPath(payload.return_to, DEFAULT_RETURN_TO);
    const now = Date.now();
    const nonce = crypto.randomUUID();
    const svc = serviceClient(caller.id);
    await svc.from('square_oauth_states').delete().lt('expires_at', new Date(now).toISOString());
    const { error: nonceErr } = await svc.from('square_oauth_states').insert({
      nonce,
      user_id: caller.id,
      environment: env,
      expires_at: new Date(now + STATE_TTL_MS).toISOString(),
    });
    if (nonceErr) {
      console.error('square-mobile: recording the OAuth nonce failed', nonceErr.message);
      return json({ error: 'Could not start the Square connection. Try again.' }, 503);
    }
    const state = await makeState({ u: caller.id, e: env, r: returnTo, n: nonce, t: now }, secret);
    return json({ url: authorizeUrl(env, config.applicationId, state), environment: env });
  }

  if (action === 'disconnect') {
    const svc = serviceClient(caller.id);
    const { data: rows } = await svc.rpc('square_mobile_get_tokens', { p_environment: env });
    const row = Array.isArray(rows) ? rows[0] : null;
    const secretValue = clientSecret();
    let revoked = false;
    if (row?.access_token && secretValue) {
      const res = await oauthPost(config, '/oauth2/revoke', { client_id: config.applicationId, access_token: row.access_token }, { Authorization: `Client ${secretValue}` });
      revoked = res.ok;
      if (!res.ok) console.error('square-mobile: revoke failed (forgetting the token anyway)', res.status);
    }
    const { data: removed, error } = await svc.rpc('square_mobile_disconnect', { p_environment: env });
    if (error) return json({ error: 'Could not remove the Square connection.' }, 503);
    await logStaffAction(caller, 'square_mobile.disconnected', 'square_mobile_connection', { environment: env, revoked }, env);
    return json({ disconnected: removed === true, revoked });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
