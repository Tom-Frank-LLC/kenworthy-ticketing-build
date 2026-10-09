// qbo-sync's gates, against the real handler with every outbound call stubbed
// (security audit 2026-10-06, L4). Nothing reaches Intuit: its token endpoint
// is a route in the table below.
//
// The function is verify_jwt = false (Intuit's redirect carries no JWT), so
// these are the only gates there are: the admin check in code for every action
// but the callback, and the signed single-use state for the callback.
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/qbo-sync/handler_test.ts

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  ANON,
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
  testJwt,
  useRoutes,
  withEnv,
} from '../_shared/testing/handler_harness.ts';
import { makeState } from './oauth_state.ts';

const SITE = 'https://site.example';
const SECRET = 'qbo-state-secret-for-tests';
const ADMIN_ID = '00000000-0000-0000-0000-0000000000d1';
const STAFF_ID = '00000000-0000-0000-0000-0000000000c1';
const ADMIN_JWT = testJwt(ADMIN_ID, 'aal2');
/** The same admin, signed in with a password only. */
const ADMIN_AAL1_JWT = testJwt(ADMIN_ID, 'aal1');
const STAFF_JWT = testJwt(STAFF_ID, 'aal1');
const NONCE = '11111111-1111-1111-1111-111111111111';

const handler = await loadHandler(() => import('./index.ts'), {
  ...BASE_ENV,
  SITE_URL: SITE,
  QBO_CLIENT_ID: 'qbo-client',
  QBO_CLIENT_SECRET: 'qbo-secret',
  QBO_ENVIRONMENT: 'sandbox',
  QBO_STATE_SECRET: SECRET,
});

/** GoTrue: who a bearer is. The anon key is nobody. */
const auth: Route = (c) => {
  if (!is(c, 'GET', '/auth/v1/user')) return undefined;
  const bearer = (c.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (bearer === ADMIN_JWT || bearer === ADMIN_AAL1_JWT) {
    return jsonResponse({ id: ADMIN_ID, email: 'admin@x.test', aud: 'authenticated' });
  }
  if (bearer === STAFF_JWT) return jsonResponse({ id: STAFF_ID, email: 'staff@x.test', aud: 'authenticated' });
  return jsonResponse({ code: 401, msg: 'invalid JWT' }, 401);
};
/** has_role(_, 'admin'): true for the admin (or a superadmin), false for staff.
 *  Only the callback asks it now; it has no session to gate. */
const hasRole: Route = (c) =>
  rpc('has_role')(c) ? jsonResponse((c.body as { _user_id: string })._user_id === ADMIN_ID) : undefined;
/** role_gate with the MFA switch off: the admin passes at any aal, staff never. */
const gate: Route = roleGateRoute(({ _user_id }) => (_user_id === ADMIN_ID ? 'ok' : 'forbidden'));
/** role_gate with the switch on: an admin needs aal2. */
const gateMfaOn: Route = roleGateRoute(({ _user_id, _aal }) =>
  _user_id !== ADMIN_ID ? 'forbidden' : _aal === 'aal2' ? 'ok' : 'mfa_required'
);
const nonces = (consumed: boolean): Route => (c) => {
  if (c.url.pathname !== '/rest/v1/qbo_oauth_states') return undefined;
  if (c.method === 'DELETE') return jsonResponse(consumed && c.url.searchParams.get('nonce') === `eq.${NONCE}` ? [{ nonce: NONCE }] : []);
  if (c.method === 'POST') return new Response(null, { status: 201 });
  return undefined;
};
const intuit: Route = (c) =>
  c.url.hostname === 'oauth.platform.intuit.com'
    ? jsonResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 })
    : undefined;
const saveTokens: Route = (c) => (rpc('qbo_save_tokens_service')(c) ? jsonResponse('row-id') : undefined);
const connection: Route = (c) =>
  is(c, 'GET', '/rest/v1/qbo_connection') ? jsonResponse({ realm_id: 'R1', token_expires_at: null, is_active: true, environment: 'sandbox' }) : undefined;

const ROUTES = [auth, gate, hasRole, nonces(true), intuit, saveTokens, connection];

function req(action: string, bearer: string | null, body?: unknown, extra: Record<string, string> = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: ANON, ...extra };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return new Request(`http://localhost/qbo-sync?action=${action}`, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function callback(params: Record<string, string>, extra: Record<string, string> = {}): Request {
  const u = new URL('http://localhost/qbo-sync');
  u.searchParams.set('action', 'oauth_callback');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return new Request(u, { method: 'GET', headers: extra }); // a browser redirect: no JWT
}

const goodState = (over: Record<string, unknown> = {}, secret = SECRET) =>
  makeState({ u: ADMIN_ID, e: 'sandbox', r: '/admin?tab=accounting', n: NONCE, t: Date.now(), ...over }, secret);

const touched = (pred: (c: Call) => boolean) => calls.filter(pred).length;
const toIntuit = (c: Call) => c.url.hostname.includes('intuit.com');
const toConnection = (c: Call) => c.url.pathname === '/rest/v1/qbo_connection';
const toNonces = (c: Call) => c.url.pathname === '/rest/v1/qbo_oauth_states';

function run(name: string, fn: () => Promise<void>) {
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn: () => quietly(fn) });
}

// ---- every action but the callback is admin-only --------------------------

for (const action of ['status', 'oauth_start', 'disconnect', 'refresh', 'payroll_export', 'nonsense']) {
  run(`${action}: anon key is refused 401 before any data is read`, async () => {
    useRoutes(ROUTES);
    const res = await handler(req(action, ANON, {}));
    assertEquals(res.status, 401);
    assertEquals(touched(toConnection) + touched(toNonces) + touched(toIntuit), 0);
  });
  run(`${action}: no Authorization at all is refused 401`, async () => {
    useRoutes(ROUTES);
    assertEquals((await handler(req(action, null, {}))).status, 401);
  });
  run(`${action}: staff is refused 403`, async () => {
    useRoutes(ROUTES);
    const res = await handler(req(action, STAFF_JWT, {}));
    assertEquals(res.status, 403);
    assertEquals(touched(toConnection) + touched(toNonces) + touched(toIntuit), 0);
  });
}

run('status: an admin (the role gate, so superadmin too) gets the connection metadata', async () => {
  useRoutes(ROUTES);
  const res = await handler(req('status', ADMIN_JWT));
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.connected, true);
  assertEquals(j.realm_id, 'R1');
  const roleCall = calls.find(rpc('role_gate'))!;
  assertEquals(roleCall.body, { _user_id: ADMIN_ID, _role: 'admin', _aal: 'aal2' }, 'asked through role_gate, not a literal match');
});

run('a failed role lookup is a retryable 503, not a silent demotion or a pass', async () => {
  useRoutes([auth, (c) => (rpc('role_gate')(c) ? jsonResponse({ message: 'down' }, 500) : undefined), ...ROUTES]);
  assertEquals((await handler(req('status', ADMIN_JWT))).status, 503);
});

// ---- MFA (BRIEF-admin-mfa.md, section 4) ------------------------------------
//
// verify_jwt = false here, so this gate is the only one. An admin whose session
// is aal1 is told to enter their code, and nothing past the gate runs.

for (const action of ['status', 'oauth_start', 'disconnect', 'refresh', 'payroll_export']) {
  run(`${action}: an aal1 admin with the switch on gets mfa_required, and nothing is read or sent`, async () => {
    useRoutes([auth, gateMfaOn, hasRole, nonces(true), intuit, saveTokens, connection]);
    const res = await handler(req(action, ADMIN_AAL1_JWT, {}));
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.code, 'mfa_required');
    assertEquals(touched(toConnection) + touched(toNonces) + touched(toIntuit), 0);
    assertEquals((calls.find(rpc('role_gate'))!.body as { _aal: string })._aal, 'aal1');
  });
}

run('status: the same admin at aal2 passes with the switch on', async () => {
  useRoutes([auth, gateMfaOn, hasRole, nonces(true), intuit, saveTokens, connection]);
  assertEquals((await handler(req('status', ADMIN_JWT))).status, 200);
});

run('a hand-written token claiming aal2 is refused 401: auth never accepted it', async () => {
  useRoutes([auth, gateMfaOn, connection]);
  // ADMIN_ID's sub with aal2, but not a token GoTrue knows: the stub 401s it.
  const forged = testJwt(ADMIN_ID, 'aal2').replace(/\.sig$/, '.forged');
  const res = await handler(req('status', forged));
  assertEquals(res.status, 401);
  assertEquals(calls.filter(rpc('role_gate')).length, 0);
  assertEquals(touched(toConnection), 0);
});

// ---- oauth_start -----------------------------------------------------------

run('oauth_start: records a nonce for the admin and signs an on-site return path', async () => {
  useRoutes(ROUTES);
  const res = await handler(req('oauth_start', ADMIN_JWT, { return_to: '/admin?tab=accounting' }));
  assertEquals(res.status, 200);
  const { authorize_url } = await res.json();
  const state = new URL(authorize_url).searchParams.get('state')!;
  const payload = JSON.parse(atob(state.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
  assertEquals(payload.r, '/admin?tab=accounting');
  const insert = calls.find((c) => toNonces(c) && c.method === 'POST')!;
  const row = (Array.isArray(insert.body) ? insert.body[0] : insert.body) as Record<string, string>;
  assertEquals(row.nonce, payload.n);
  assertEquals(row.user_id, ADMIN_ID);
  assertEquals(insert.headers.get('x-kw-actor-id'), ADMIN_ID, 'the write is attributed');
});

for (const bad of ['@evil.tld', '//evil.example', 'https://evil.example/x', '/\\evil.example']) {
  run(`oauth_start: return_to ${JSON.stringify(bad)} is replaced by the default`, async () => {
    useRoutes(ROUTES);
    const res = await handler(req('oauth_start', ADMIN_JWT, { return_to: bad }));
    const { authorize_url } = await res.json();
    const state = new URL(authorize_url).searchParams.get('state')!;
    const payload = JSON.parse(atob(state.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    assertEquals(payload.r, '/admin?tab=accounting');
  });
}

run('oauth_start: no QBO_STATE_SECRET fails closed, with no nonce written', async () => {
  useRoutes(ROUTES);
  await withEnv({ QBO_STATE_SECRET: null }, async () => {
    const res = await handler(req('oauth_start', ADMIN_JWT, {}));
    assertEquals(res.status, 503);
  });
  assertEquals(touched(toNonces), 0);
});

// ---- oauth_callback --------------------------------------------------------

run('callback: a fresh state is consumed, tokens saved, and the admin sent to SITE_URL — not the Referer', async () => {
  useRoutes(ROUTES);
  const res = await handler(callback(
    { code: 'c', realmId: 'R1', state: await goodState() },
    { referer: 'https://evil.example/phish' },
  ));
  assertEquals(res.status, 302);
  assertEquals(res.headers.get('location'), `${SITE}/admin?tab=accounting&qbo=connected&realm=R1`);
  const del = calls.findIndex((c) => toNonces(c) && c.method === 'DELETE');
  const exchange = calls.findIndex(toIntuit);
  assert(del >= 0 && exchange > del, 'the nonce is consumed before the code is exchanged');
  assertEquals(touched(rpc('qbo_save_tokens_service')), 1);
});

run('callback: a replayed state (nonce already consumed) is refused before Intuit is called', async () => {
  useRoutes([auth, hasRole, nonces(false), intuit, saveTokens]);
  const res = await handler(callback({ code: 'c', realmId: 'R1', state: await goodState() }));
  assertEquals(res.status, 400);
  assertStringIncludes(await res.text(), 'already used');
  assertEquals(touched(toIntuit), 0);
  assertEquals(touched(rpc('qbo_save_tokens_service')), 0);
});

run('callback: a state signed with the service-role key (the old scheme) is refused', async () => {
  useRoutes(ROUTES);
  const res = await handler(callback({ code: 'c', realmId: 'R1', state: await goodState({}, BASE_ENV.SUPABASE_SERVICE_ROLE_KEY) }));
  assertEquals(res.status, 400);
  assertEquals(touched(toNonces) + touched(toIntuit), 0);
});

run('callback: an expired state is refused', async () => {
  useRoutes(ROUTES);
  const res = await handler(callback({ code: 'c', realmId: 'R1', state: await goodState({ t: Date.now() - 11 * 60 * 1000 }) }));
  assertEquals(res.status, 400);
  assertEquals(touched(toIntuit), 0);
});

run('callback: no QBO_STATE_SECRET fails closed', async () => {
  useRoutes(ROUTES);
  const state = await goodState();
  await withEnv({ QBO_STATE_SECRET: null }, async () => {
    const res = await handler(callback({ code: 'c', realmId: 'R1', state }));
    assertEquals(res.status, 503);
  });
  assertEquals(touched(toNonces) + touched(toIntuit), 0);
});

run('callback: a starter who lost admin since oauth_start is not connected', async () => {
  useRoutes([auth, (c) => (rpc('has_role')(c) ? jsonResponse(false) : undefined), nonces(true), intuit, saveTokens]);
  const res = await handler(callback({ code: 'c', realmId: 'R1', state: await goodState() }));
  assertEquals(res.status, 302);
  assertStringIncludes(res.headers.get('location')!, `${SITE}/admin?tab=accounting&qbo=error`);
  assertEquals(touched(toIntuit), 0);
});

run('callback: an Intuit error parameter redirects to SITE_URL, never the Referer', async () => {
  useRoutes(ROUTES);
  const res = await handler(callback({ error: 'access_denied' }, { referer: 'https://evil.example/' }));
  assertEquals(res.status, 302);
  assertEquals(res.headers.get('location'), `${SITE}/admin?tab=accounting&qbo=error&message=access_denied`);
});
