// Service-role identity is proved, never read off a claim (security audit L9).
//
// The hole these pin: callers.ts and send-ticket-confirmation trusted any
// token whose payload said "role": "service_role". Safe only while the gateway
// verified signatures (verify_jwt = true); one --no-verify-jwt deploy and a
// hand-written token would have been the server.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isServiceRoleCaller, serviceKeys, verifyServiceRoleCaller } from './callers.ts';

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
