// square-mobile's gates, against the real handler with every outbound call
// stubbed. Nothing reaches Square: its OAuth and API hosts are routes below.
//
// verify_jwt = false (Square's redirect carries no JWT), so these are the only
// gates there are: requireRole in code for every POST, and the signed,
// single-use state for the callback (any GET).
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/square-mobile/handler_test.ts

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  ANON,
  authUsers,
  BASE_ENV,
  type Call,
  calls,
  is,
  jsonResponse,
  loadHandler,
  quietly,
  roleGateRoute,
  rpc,
  type Route,
  SQUARE_TEST_ENV,
  testJwt,
  useRoutes,
  withEnv,
} from '../_shared/testing/handler_harness.ts';
import { makeState } from '../_shared/oauth_state.ts';
import { authorizeUrl, needsRefresh, REFRESH_WITHIN_MS } from './oauth.ts';

const SITE = 'https://site.example';
const SECRET = 'square-state-secret-for-tests';
const ADMIN_ID = '00000000-0000-0000-0000-0000000000d1';
const STAFF_ID = '00000000-0000-0000-0000-0000000000c1';
const ADMIN_JWT = testJwt(ADMIN_ID, 'aal2');
const ADMIN_AAL1_JWT = testJwt(ADMIN_ID, 'aal1');
const STAFF_JWT = testJwt(STAFF_ID, 'aal2');
const NONCE = '11111111-1111-1111-1111-111111111111';
const LOC = SQUARE_TEST_ENV.SQUARE_LOCATION_ID;

const handler = await loadHandler(() => import('./index.ts'), {
  ...BASE_ENV,
  ...SQUARE_TEST_ENV,
  SITE_URL: SITE,
  SQUARE_ENV: 'production',
  SQUARE_OAUTH_STATE_SECRET: SECRET,
  SQUARE_OAUTH_CLIENT_SECRET: 'client-secret',
});

const auth = authUsers({
  [ADMIN_JWT]: { id: ADMIN_ID, email: 'admin@x.test' },
  [ADMIN_AAL1_JWT]: { id: ADMIN_ID, email: 'admin@x.test' },
  [STAFF_JWT]: { id: STAFF_ID, email: 'staff@x.test' },
});
/** The database's rule: admin passes either gate, staff only the staff one. */
const gate: Route = roleGateRoute(({ _user_id, _role }) =>
  _user_id === ADMIN_ID || _role === 'staff' ? 'ok' : 'forbidden'
);
const gateMfaOn: Route = roleGateRoute(({ _user_id, _role, _aal }) =>
  _aal !== 'aal2' ? 'mfa_required' : _user_id === ADMIN_ID || _role === 'staff' ? 'ok' : 'forbidden'
);
const hasRole = (admin: boolean): Route => (c) => (rpc('has_role')(c) ? jsonResponse(admin) : undefined);
const nonces = (consumed: boolean): Route => (c) => {
  if (c.url.pathname !== '/rest/v1/square_oauth_states') return undefined;
  if (c.method === 'DELETE') {
    return jsonResponse(consumed && c.url.searchParams.get('nonce') === `eq.${NONCE}` ? [{ nonce: NONCE }] : []);
  }
  if (c.method === 'POST') return new Response(null, { status: 201 });
  return undefined;
};
const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();
const stored = (expires: string | null): Route => (c) =>
  rpc('square_mobile_get_tokens')(c)
    ? jsonResponse(expires === null ? [] : [{ merchant_id: 'M1', access_token: 'stored-at', refresh_token: 'stored-rt', token_expires_at: expires, connected_at: inDays(-20) }])
    : undefined;
const save: Route = (c) => (rpc('square_mobile_save_tokens')(c) ? new Response(null, { status: 204 }) : undefined);
const disconnectRpc: Route = (c) => (rpc('square_mobile_disconnect')(c) ? jsonResponse(true) : undefined);
const squareOAuth = (ok = true): Route => (c) => {
  if (c.url.hostname !== 'connect.squareup.com' || !c.url.pathname.startsWith('/oauth2/')) return undefined;
  if (c.url.pathname === '/oauth2/revoke') return jsonResponse({ success: true });
  return ok
    ? jsonResponse({ access_token: 'new-at', refresh_token: 'new-rt', expires_at: inDays(30), merchant_id: 'M1' })
    : jsonResponse({ message: 'nope', type: 'bad_request' }, 400);
};
const location = (owns: boolean): Route => (c) =>
  is(c, 'GET', `/v2/locations/${LOC}`) && c.url.hostname === 'connect.squareup.com'
    ? (owns ? jsonResponse({ location: { id: LOC } }) : jsonResponse({ errors: [{ code: 'NOT_FOUND' }] }, 404))
    : undefined;

const ROUTES = [auth, gate, hasRole(true), nonces(true), stored(inDays(20)), save, disconnectRpc, squareOAuth(), location(true)];

function post(action: string, bearer: string | null, body: Record<string, unknown> = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: ANON };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return new Request('http://localhost/square-mobile', { method: 'POST', headers, body: JSON.stringify({ action, ...body }) });
}
function callback(params: Record<string, string>, extra: Record<string, string> = {}): Request {
  const u = new URL('http://localhost/square-mobile');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return new Request(u, { method: 'GET', headers: extra });
}
const goodState = (over: Record<string, unknown> = {}, secret = SECRET) =>
  makeState({ u: ADMIN_ID, e: 'production', r: '/staff/pos', n: NONCE, t: Date.now(), ...over }, secret);

const touched = (pred: (c: Call) => boolean) => calls.filter(pred).length;
const toSquare = (c: Call) => c.url.hostname.includes('squareup');
const toTokens = (c: Call) => rpc('square_mobile_get_tokens')(c) || rpc('square_mobile_save_tokens')(c) || rpc('square_mobile_disconnect')(c);
const toNonces = (c: Call) => c.url.pathname === '/rest/v1/square_oauth_states';

function run(name: string, fn: () => Promise<void>) {
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn: () => quietly(fn) });
}

// ---- unit: refresh window and consent URL ---------------------------------

Deno.test('needsRefresh: a token with more than 7 days left is used as is', () => {
  const now = Date.now();
  assertEquals(needsRefresh(new Date(now + REFRESH_WITHIN_MS + 60_000).toISOString(), now), false);
  assertEquals(needsRefresh(new Date(now + REFRESH_WITHIN_MS - 60_000).toISOString(), now), true);
  assertEquals(needsRefresh(null, now), true);
  assertEquals(needsRefresh('garbage', now), true);
});

Deno.test('authorizeUrl: the three Stand scopes, session=false, the environment\'s host', () => {
  const u = new URL(authorizeUrl('production', 'sq0idp-x', 'S'));
  assertEquals(u.origin, 'https://connect.squareup.com');
  assertEquals(u.searchParams.get('scope'), 'MERCHANT_PROFILE_READ PAYMENTS_WRITE PAYMENTS_WRITE_IN_PERSON');
  assertEquals(u.searchParams.get('session'), 'false');
  assertEquals(u.searchParams.get('state'), 'S');
  assertEquals(new URL(authorizeUrl('sandbox', 'a', 's')).origin, 'https://connect.squareupsandbox.com');
});

// ---- the role gates --------------------------------------------------------

for (const action of ['token', 'status', 'connect_start', 'disconnect']) {
  run(`${action}: the anon key is refused 401 and nothing is read`, async () => {
    useRoutes(ROUTES);
    assertEquals((await handler(post(action, ANON))).status, 401);
    assertEquals(touched(toTokens) + touched(toNonces) + touched(toSquare), 0);
  });
  run(`${action}: no Authorization at all is refused 401`, async () => {
    useRoutes(ROUTES);
    assertEquals((await handler(post(action, null))).status, 401);
  });
  run(`${action}: an aal1 session with the MFA switch on is told mfa_required`, async () => {
    useRoutes([auth, gateMfaOn, ...ROUTES.slice(2)]);
    const res = await handler(post(action, ADMIN_AAL1_JWT));
    assertEquals(res.status, 403);
    assertEquals((await res.json()).code, 'mfa_required');
    assertEquals(touched(toTokens) + touched(toNonces) + touched(toSquare), 0);
  });
}

for (const action of ['connect_start', 'disconnect']) {
  run(`${action}: staff is refused 403 — connecting the till is an admin's call`, async () => {
    useRoutes(ROUTES);
    assertEquals((await handler(post(action, STAFF_JWT))).status, 403);
    assertEquals(touched(toTokens) + touched(toNonces) + touched(toSquare), 0);
    assertEquals((calls.find(rpc('role_gate'))!.body as { _role: string })._role, 'admin');
  });
}

// ---- token -----------------------------------------------------------------

run('token: staff get the stored token, unrefreshed, while it has more than 7 days', async () => {
  useRoutes(ROUTES);
  const res = await handler(post('token', STAFF_JWT));
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.access_token, 'stored-at');
  assertEquals(j.location_id, LOC);
  assertEquals(j.environment, 'production');
  assertEquals(touched(toSquare), 0);
});

run('token: inside 7 days it is refreshed first, saved, and the new one returned', async () => {
  useRoutes([auth, gate, stored(inDays(3)), save, squareOAuth(), location(true)]);
  const j = await (await handler(post('token', STAFF_JWT))).json();
  assertEquals(j.access_token, 'new-at');
  const refresh = calls.find((c) => c.url.pathname === '/oauth2/token')!;
  assertEquals((refresh.body as Record<string, string>).grant_type, 'refresh_token');
  assertEquals((refresh.body as Record<string, string>).refresh_token, 'stored-rt');
  const saved = calls.find(rpc('square_mobile_save_tokens'))!.body as Record<string, unknown>;
  assertEquals(saved.p_access_token, 'new-at');
  assertEquals(saved.p_connected_by, null, 'a refresh keeps the original connector');
});

run('token: a failed refresh still hands out a token that has not expired', async () => {
  useRoutes([auth, gate, stored(inDays(3)), save, squareOAuth(false)]);
  const res = await handler(post('token', STAFF_JWT));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).access_token, 'stored-at');
});

run('token: an expired token that cannot be refreshed is not handed out', async () => {
  useRoutes([auth, gate, stored(inDays(-1)), save, squareOAuth(false)]);
  const res = await handler(post('token', STAFF_JWT));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, 'not_connected');
});

run('token: nothing connected is a 409 not_connected the POS can explain', async () => {
  useRoutes([auth, gate, stored(null)]);
  const res = await handler(post('token', STAFF_JWT));
  assertEquals(res.status, 409);
  const j = await res.json();
  assertEquals(j.code, 'not_connected');
  assertStringIncludes(j.error, 'Connect Square');
});

run('token: in the sandbox, the configured sandbox token, no database read', async () => {
  useRoutes([auth, gate]);
  await withEnv({ SQUARE_ENV: 'sandbox' }, async () => {
    const j = await (await handler(post('token', STAFF_JWT))).json();
    assertEquals(j.access_token, SQUARE_TEST_ENV.SQUARE_ACCESS_TOKEN);
    assertEquals(j.environment, 'sandbox');
  });
  assertEquals(touched(toTokens), 0);
});

// ---- connect_start ---------------------------------------------------------

run('connect_start: records a nonce for the admin and signs an on-site return path', async () => {
  useRoutes(ROUTES);
  const res = await handler(post('connect_start', ADMIN_JWT, { return_to: '/staff/pos?x=1' }));
  assertEquals(res.status, 200);
  const { url } = await res.json();
  const u = new URL(url);
  assertEquals(u.origin + u.pathname, 'https://connect.squareup.com/oauth2/authorize');
  assertEquals(u.searchParams.get('client_id'), SQUARE_TEST_ENV.SQUARE_APPLICATION_ID);
  const state = u.searchParams.get('state')!;
  const payload = JSON.parse(atob(state.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
  assertEquals(payload.r, '/staff/pos?x=1');
  const insert = calls.find((c) => toNonces(c) && c.method === 'POST')!;
  const row = (Array.isArray(insert.body) ? insert.body[0] : insert.body) as Record<string, string>;
  assertEquals(row.nonce, payload.n);
  assertEquals(row.user_id, ADMIN_ID);
});

for (const bad of ['@evil.tld', '//evil.example', 'https://evil.example/x', '/\\evil.example']) {
  run(`connect_start: return_to ${JSON.stringify(bad)} becomes /staff/pos`, async () => {
    useRoutes(ROUTES);
    const { url } = await (await handler(post('connect_start', ADMIN_JWT, { return_to: bad }))).json();
    const state = new URL(url).searchParams.get('state')!;
    assertEquals(JSON.parse(atob(state.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).r, '/staff/pos');
  });
}

run('connect_start: no state secret or no client secret fails closed, no nonce written', async () => {
  useRoutes(ROUTES);
  await withEnv({ SQUARE_OAUTH_STATE_SECRET: null }, async () => {
    assertEquals((await handler(post('connect_start', ADMIN_JWT))).status, 503);
  });
  await withEnv({ SQUARE_OAUTH_CLIENT_SECRET: null }, async () => {
    const res = await handler(post('connect_start', ADMIN_JWT));
    assertEquals(res.status, 503);
    assertStringIncludes((await res.json()).error, 'SQUARE_OAUTH_CLIENT_SECRET');
  });
  assertEquals(touched(toNonces), 0);
});

// ---- oauth_callback --------------------------------------------------------

run('callback: consumed, exchanged, checked against our location, saved, sent to SITE_URL — not the Referer', async () => {
  useRoutes(ROUTES);
  const res = await handler(callback({ code: 'c', state: await goodState() }, { referer: 'https://evil.example/' }));
  assertEquals(res.status, 302);
  assertEquals(res.headers.get('location'), `${SITE}/staff/pos?square=connected`);
  const del = calls.findIndex((c) => toNonces(c) && c.method === 'DELETE');
  const exchange = calls.findIndex((c) => c.url.pathname === '/oauth2/token');
  const owns = calls.findIndex((c) => c.url.pathname === `/v2/locations/${LOC}`);
  const saved = calls.findIndex(rpc('square_mobile_save_tokens'));
  assert(del >= 0 && exchange > del && owns > exchange && saved > owns, 'consume → exchange → ownership → save');
  assertEquals((calls[exchange].body as Record<string, string>).grant_type, 'authorization_code');
  assertEquals((calls[owns].headers.get('authorization')), 'Bearer new-at', 'ownership is checked with the NEW token');
  assertEquals((calls[saved].body as Record<string, unknown>).p_connected_by, ADMIN_ID);
});

run('callback: works with ?action=oauth_callback on the registered URL too', async () => {
  useRoutes(ROUTES);
  const res = await handler(callback({ action: 'oauth_callback', code: 'c', state: await goodState() }));
  assertEquals(res.headers.get('location'), `${SITE}/staff/pos?square=connected`);
});

run('callback: a token for another Square account is revoked and not saved', async () => {
  useRoutes([auth, gate, hasRole(true), nonces(true), save, squareOAuth(), location(false)]);
  const res = await handler(callback({ code: 'c', state: await goodState() }));
  assertEquals(res.status, 302);
  assertStringIncludes(res.headers.get('location')!, 'square=error');
  assertEquals(touched(rpc('square_mobile_save_tokens')), 0);
  assertEquals(touched((c) => c.url.pathname === '/oauth2/revoke'), 1);
});

run('callback: a replayed state is refused before Square is called', async () => {
  useRoutes([auth, gate, hasRole(true), nonces(false), save, squareOAuth(), location(true)]);
  const res = await handler(callback({ code: 'c', state: await goodState() }));
  assertEquals(res.status, 400);
  assertStringIncludes(await res.text(), 'already used');
  assertEquals(touched(toSquare), 0);
});

run('callback: a bogus or foreign-signed state is refused 400, nothing touched', async () => {
  useRoutes(ROUTES);
  assertEquals((await handler(callback({ code: 'c', state: 'bogus' }))).status, 400);
  assertEquals((await handler(callback({ code: 'c', state: await goodState({}, 'other-secret') }))).status, 400);
  assertEquals(touched(toNonces) + touched(toSquare), 0);
});

run('callback: an expired state is refused', async () => {
  useRoutes(ROUTES);
  const res = await handler(callback({ code: 'c', state: await goodState({ t: Date.now() - 11 * 60 * 1000 }) }));
  assertEquals(res.status, 400);
  assertEquals(touched(toSquare), 0);
});

run('callback: a starter who lost admin is not connected', async () => {
  useRoutes([auth, gate, hasRole(false), nonces(true), save, squareOAuth(), location(true)]);
  const res = await handler(callback({ code: 'c', state: await goodState() }));
  assertStringIncludes(res.headers.get('location')!, 'square=error');
  assertEquals(touched(toSquare), 0);
});

run('callback: Square\'s ?error= lands on SITE_URL with the message', async () => {
  useRoutes(ROUTES);
  const res = await handler(callback({ error: 'access_denied', error_description: 'user denied' }, { referer: 'https://evil.example/' }));
  assertEquals(res.status, 302);
  assertEquals(res.headers.get('location'), `${SITE}/staff/pos?square=error&message=user+denied`);
});

run('callback: no state secret fails closed', async () => {
  useRoutes(ROUTES);
  const state = await goodState();
  await withEnv({ SQUARE_OAUTH_STATE_SECRET: null }, async () => {
    assertEquals((await handler(callback({ code: 'c', state }))).status, 503);
  });
  assertEquals(touched(toNonces) + touched(toSquare), 0);
});

// ---- disconnect ------------------------------------------------------------

run('disconnect: an admin revokes and forgets the token', async () => {
  useRoutes(ROUTES);
  const j = await (await handler(post('disconnect', ADMIN_JWT))).json();
  assertEquals(j.disconnected, true);
  assertEquals(j.revoked, true);
  const revoke = calls.find((c) => c.url.pathname === '/oauth2/revoke')!;
  assertEquals(revoke.headers.get('authorization'), 'Client client-secret');
  assertEquals(touched(rpc('square_mobile_disconnect')), 1);
});
