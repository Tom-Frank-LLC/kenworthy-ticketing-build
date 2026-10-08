// Service-role identity is proved, never read off a claim (security audit L9).
//
// The hole these pin: callers.ts and send-ticket-confirmation trusted any
// token whose payload said "role": "service_role". Safe only while the gateway
// verified signatures (verify_jwt = true); one --no-verify-jwt deploy and a
// hand-written token would have been the server.

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  type Caller,
  isServiceRoleCaller,
  MFA_REQUIRED_MESSAGE,
  requireRole,
  roleGate,
  serviceKeys,
  verifiedCaller,
  verifyServiceRoleCaller,
} from './callers.ts';

const SERVICE = 'sb_secret_service_key_for_tests_only';
const OTHER_SECRET = 'sb_secret_second_named_key';
const ANON = 'anon-key-for-tests';

function setEnv() {
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SERVICE);
  Deno.env.set('SUPABASE_SECRET_KEYS', JSON.stringify({ default: SERVICE, ci: OTHER_SECRET }));
  Deno.env.set('SUPABASE_ANON_KEY', ANON);
  Deno.env.set('SUPABASE_URL', 'https://project.example');
}

function b64url(o: unknown): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An unsigned token claiming service_role — what an attacker can write by hand. */
const FORGED = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ role: 'service_role' })}.`;
const FORGED_HS = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role: 'service_role' })}.c2ln`;

function req(headers: Record<string, string>): Request {
  return new Request('https://fn.example/', { method: 'POST', headers });
}

/** A fetch stub that records calls and answers like auth's admin API. */
function authStub(status: number, body: unknown) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = ((url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { calls, impl };
}

Deno.test('L9: a forged service_role claim is not the service role', async () => {
  setEnv();
  for (const token of [FORGED, FORGED_HS]) {
    const r = req({ Authorization: `Bearer ${token}`, apikey: ANON });
    assertEquals(isServiceRoleCaller(r), false);
    // Auth refuses a token it did not sign.
    const stub = authStub(401, { code: 401, error_code: 'bad_jwt' });
    assertEquals(await verifyServiceRoleCaller(r, stub.impl), false);
    assertEquals(stub.calls.length, 1);
  }
});

Deno.test('L9: a forged claim is refused even if auth answers oddly', async () => {
  setEnv();
  const r = req({ Authorization: `Bearer ${FORGED}` });
  // 200 with a user, 403, a 404 that is not auth's "user not found" (a gateway
  // path error), and an unreachable auth: none of them is proof.
  for (const [status, body] of [
    [200, { id: 'x' }],
    [403, { error_code: 'not_admin' }],
    [404, { message: 'requested path is invalid' }],
  ] as Array<[number, unknown]>) {
    assertEquals(await verifyServiceRoleCaller(r, authStub(status, body).impl), false);
  }
  const throwing = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
  assertEquals(await verifyServiceRoleCaller(r, throwing), false);
});

Deno.test('the injected service key is the service role, in either header', () => {
  setEnv();
  assertEquals(isServiceRoleCaller(req({ Authorization: `Bearer ${SERVICE}` })), true);
  assertEquals(isServiceRoleCaller(req({ apikey: SERVICE })), true);
});

Deno.test('every key in SUPABASE_SECRET_KEYS is accepted', () => {
  setEnv();
  assertEquals(serviceKeys().sort(), [OTHER_SECRET, SERVICE].sort());
  assertEquals(isServiceRoleCaller(req({ apikey: OTHER_SECRET })), true);
});

Deno.test('the anon key, a near miss, and nothing at all are not the service role', async () => {
  setEnv();
  for (const h of [
    { Authorization: `Bearer ${ANON}`, apikey: ANON },
    { Authorization: `Bearer ${SERVICE}x` },
    { Authorization: `Bearer ${SERVICE.slice(0, -1)}` },
    {},
  ] as Array<Record<string, string>>) {
    const stub = authStub(404, { error_code: 'user_not_found' });
    assertEquals(await verifyServiceRoleCaller(req(h), stub.impl), false);
    // Not a JWT claiming service_role, so auth is not even asked.
    assertEquals(stub.calls.length, 0);
  }
});

Deno.test('a genuine service-role JWT in another format is verified by auth', async () => {
  setEnv();
  // e.g. the legacy dashboard key while the environment holds sb_secret_.
  const legacy = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role: 'service_role' })}.realsig`;
  const stub = authStub(404, { code: 404, error_code: 'user_not_found', msg: 'User not found' });
  assertEquals(await verifyServiceRoleCaller(req({ Authorization: `Bearer ${legacy}` }), stub.impl), true);
  // It asked about the all-zero user, presenting the token as the bearer.
  assertEquals(stub.calls[0].url, 'https://project.example/auth/v1/admin/users/00000000-0000-0000-0000-000000000000');
  assertEquals(stub.calls[0].headers.Authorization, `Bearer ${legacy}`);
  assertEquals(stub.calls[0].headers.apikey, ANON);
});

Deno.test('no service key in the environment means nobody is the service role', () => {
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  Deno.env.delete('SUPABASE_SECRET_KEYS');
  assertEquals(isServiceRoleCaller(req({ Authorization: 'Bearer ' })), false);
  assertEquals(isServiceRoleCaller(req({ apikey: '' })), false);
  setEnv();
});

// ---------------------------------------------------------------------------
// verifiedCaller / roleGate / requireRole: the MFA gate (BRIEF-admin-mfa.md, 4)
//
// The property under test: `aal` is believed only once auth has accepted the
// very token that carries it, and the database (role_gate) decides everything
// else. A hand-written token saying aal2 must get nowhere.
// ---------------------------------------------------------------------------

const USER_ID = '00000000-0000-0000-0000-0000000000a1';

/** A JWT-shaped user token. The signature is not ours to check: auth does. */
function userJwt(claims: Record<string, unknown>): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ role: 'authenticated', ...claims })}.sig`;
}

/** A stub service-role client whose role_gate answers `answer` and records its arguments. */
function gateClient(answer: { data?: unknown; error?: unknown }) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    rpcCalls,
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null });
    },
  };
}

const bearer = (token: string) => req({ Authorization: `Bearer ${token}`, apikey: ANON });

Deno.test('verifiedCaller: the anon key is nobody, and auth is not even asked', async () => {
  setEnv();
  const stub = authStub(200, { id: USER_ID });
  assertEquals(await verifiedCaller(bearer(ANON), stub.impl), null);
  assertEquals(await verifiedCaller(req({}), stub.impl), null);
  assertEquals(stub.calls.length, 0);
});

Deno.test('verifiedCaller: asks auth /user with the anon apikey and the caller\'s own token', async () => {
  setEnv();
  const token = userJwt({ sub: USER_ID, aal: 'aal2' });
  const stub = authStub(200, { id: USER_ID, email: 'admin@x.test' });
  assertEquals(await verifiedCaller(bearer(token), stub.impl), { id: USER_ID, email: 'admin@x.test', aal: 'aal2' });
  assertEquals(stub.calls[0].url, 'https://project.example/auth/v1/user');
  assertEquals(stub.calls[0].headers.Authorization, `Bearer ${token}`);
  assertEquals(stub.calls[0].headers.apikey, ANON);
});

Deno.test('verifiedCaller: a token auth refuses is nobody, whatever aal it claims', async () => {
  setEnv();
  // The forgery that matters: a hand-written token saying aal2. qbo-sync has
  // no gateway check, so this is the only thing standing in the way.
  const forged = userJwt({ sub: USER_ID, aal: 'aal2' });
  assertEquals(await verifiedCaller(bearer(forged), authStub(401, { code: 401, msg: 'invalid JWT' }).impl), null);
  assertEquals(await verifiedCaller(bearer(forged), authStub(403, { msg: 'session not found' }).impl), null);
  const throwing = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
  assertEquals(await verifiedCaller(bearer(forged), throwing), null);
});

Deno.test('verifiedCaller: auth naming a different user than the token\'s sub is nobody', async () => {
  setEnv();
  const token = userJwt({ sub: USER_ID, aal: 'aal2' });
  assertEquals(await verifiedCaller(bearer(token), authStub(200, { id: 'someone-else' }).impl), null);
  assertEquals(await verifiedCaller(bearer(token), authStub(200, {}).impl), null);
});

Deno.test('verifiedCaller: no aal claim, or anything but aal2, is aal1', async () => {
  setEnv();
  for (const claims of [{ sub: USER_ID }, { sub: USER_ID, aal: 'aal1' }, { sub: USER_ID, aal: 'AAL2' }]) {
    const caller = await verifiedCaller(bearer(userJwt(claims)), authStub(200, { id: USER_ID }).impl);
    assertEquals(caller?.aal, 'aal1');
  }
});

Deno.test('verifiedCaller: a token with no sub (a service key, a service_role JWT) is not a user', async () => {
  setEnv();
  const stub = authStub(200, { id: USER_ID });
  assertEquals(await verifiedCaller(bearer(SERVICE), stub.impl), null);
  assertEquals(await verifiedCaller(bearer(FORGED), stub.impl), null);
  assertEquals(stub.calls.length, 0);
});

Deno.test('roleGate: asks role_gate with the caller\'s id, the role and the verified aal', async () => {
  const caller: Caller = { id: USER_ID, email: null, aal: 'aal1' };
  const admin = gateClient({ data: 'mfa_required' });
  assertEquals(await roleGate(admin, caller, 'staff'), 'mfa_required');
  assertEquals(admin.rpcCalls, [{ fn: 'role_gate', args: { _user_id: USER_ID, _role: 'staff', _aal: 'aal1' } }]);
});

Deno.test('roleGate: an rpc error or an unexpected answer is null, never a pass', async () => {
  const caller: Caller = { id: USER_ID, email: null, aal: 'aal2' };
  assertEquals(await roleGate(gateClient({ error: { message: 'down' } }), caller, 'admin'), null);
  assertEquals(await roleGate(gateClient({ data: true }), caller, 'admin'), null);
  assertEquals(await roleGate(gateClient({ data: 'yes' }), caller, 'admin'), null);
});

async function gateOutcome(answer: { data?: unknown; error?: unknown }, token = userJwt({ sub: USER_ID, aal: 'aal1' })) {
  setEnv();
  const admin = gateClient(answer);
  const out = await requireRole(bearer(token), admin, 'admin', {
    headers: { 'Access-Control-Allow-Origin': '*' },
    forbidden: 'Admin only',
    fetchImpl: authStub(200, { id: USER_ID, email: 'admin@x.test' }).impl,
  });
  return { out, admin };
}

Deno.test('requireRole: ok is the Caller', async () => {
  const { out, admin } = await gateOutcome({ data: 'ok' }, userJwt({ sub: USER_ID, aal: 'aal2' }));
  assertEquals(out, { id: USER_ID, email: 'admin@x.test', aal: 'aal2' });
  assertEquals(admin.rpcCalls[0].args, { _user_id: USER_ID, _role: 'admin', _aal: 'aal2' });
});

Deno.test('requireRole: forbidden is 403 with the function\'s own wording and no code', async () => {
  const { out } = await gateOutcome({ data: 'forbidden' });
  assert(out instanceof Response);
  assertEquals(out.status, 403);
  assertEquals(out.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(await out.json(), { error: 'Admin only' });
});

Deno.test('requireRole: mfa_required is 403 with code mfa_required', async () => {
  const { out } = await gateOutcome({ data: 'mfa_required' });
  assert(out instanceof Response);
  assertEquals(out.status, 403);
  assertEquals(out.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(await out.json(), { error: MFA_REQUIRED_MESSAGE, code: 'mfa_required' });
});

Deno.test('requireRole: a failed lookup is a retryable 503', async () => {
  const { out } = await gateOutcome({ error: { message: 'down' } });
  assert(out instanceof Response);
  assertEquals(out.status, 503);
});

Deno.test('requireRole: no verified user is 401 and the gate is never asked', async () => {
  setEnv();
  for (const [token, fetchImpl] of [
    [ANON, authStub(200, { id: USER_ID }).impl],
    // aal2 claimed, auth refuses: 401, not a pass.
    [userJwt({ sub: USER_ID, aal: 'aal2' }), authStub(401, { msg: 'invalid JWT' }).impl],
    [userJwt({ sub: USER_ID, aal: 'aal2' }), authStub(200, { id: 'someone-else' }).impl],
  ] as Array<[string, typeof fetch]>) {
    const admin = gateClient({ data: 'ok' });
    const out = await requireRole(bearer(token), admin, 'admin', { fetchImpl, unauthorized: 'Sign in required' });
    assert(out instanceof Response);
    assertEquals(out.status, 401);
    assertEquals(await out.json(), { error: 'Sign in required' });
    assertEquals(admin.rpcCalls.length, 0);
  }
});
