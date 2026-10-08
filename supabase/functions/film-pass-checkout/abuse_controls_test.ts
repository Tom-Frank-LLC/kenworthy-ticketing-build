// The public `order` action: rate limit, Turnstile (fail closed), and no
// account for a refused request (audit M2, L10), against the real handler with
// every outbound call stubbed. None of these reaches a charge.
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/film-pass-checkout/abuse_controls_test.ts

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  ANON,
  authUsers,
  BASE_ENV,
  calls,
  createdUser,
  firstIndex,
  is,
  jsonResponse,
  loadHandler,
  post,
  quietly,
  rateLimit,
  roleGateRoute,
  rows,
  siteverify,
  testJwt,
  useRoutes,
  verifiedBot,
  withEnv,
} from '../_shared/testing/handler_harness.ts';

const handler = await loadHandler(() => import('./index.ts'), BASE_ENV);

const orderBody = (over: Record<string, unknown> = {}) => ({
  action: 'order',
  pass_type_id: 'pass-type-1',
  quantity: 2,
  fulfillment: 'pickup',
  source_id: 'cnon:card-nonce-ok',
  name: 'Guest Patron',
  email: 'guest@example.com',
  idempotency_key: 'idem-key-0002',
  turnstile_token: 'a-solved-token',
  ...over,
});

const base = (bot = true, limited = false, passTypes: unknown[] = []) => [
  rateLimit(!limited),
  siteverify(bot),
  (c: any) => is(c, 'GET', '/rest/v1/film_pass_orders') ? rows(c, []) : undefined,
  (c: any) => is(c, 'GET', '/rest/v1/film_pass_types') ? rows(c, passTypes) : undefined,
  (c: any) => is(c, 'GET', '/rest/v1/profiles') ? rows(c, []) : undefined,
  (c: any) => is(c, 'GET', '/auth/v1/admin/users') ? jsonResponse({ users: [] }) : undefined,
  (c: any) => createdUser(c) ? jsonResponse({ id: 'new-user-1', aud: 'authenticated' }) : undefined,
];

const pendingOrder = () => calls.filter((c) => is(c, 'POST', '/rest/v1/film_pass_orders')).length;

function run(name: string, fn: () => Promise<void>) {
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn: () => quietly(fn) });
}

run('a pass that does not exist creates no account', async () => {
  useRoutes(base(true, false, []));
  const res = await handler(post(orderBody()));
  assertEquals(res.status, 404);
  assertEquals(calls.filter(createdUser).length, 0);
  // ...and the bot check came before the pass was even read.
  const bot = firstIndex(verifiedBot);
  const read = firstIndex((c) => is(c, 'GET', '/rest/v1/film_pass_types'));
  assertEquals(bot >= 0 && read > bot, true);
});

run('a failed bot check: no pass read, no account, no order', async () => {
  useRoutes(base(false));
  const res = await handler(post(orderBody()));
  assertEquals(res.status, 403);
  assertEquals(calls.filter((c) => is(c, 'GET', '/rest/v1/film_pass_types')).length, 0);
  assertEquals(calls.filter(createdUser).length, 0);
  assertEquals(pendingOrder(), 0);
});

run('Turnstile fails CLOSED on pass orders when the secret is unset', async () => {
  await withEnv({ TURNSTILE_SECRET_KEY: null }, async () => {
    useRoutes(base(true));
    const res = await handler(post(orderBody()));
    assertEquals(res.status, 403);
    assertEquals(calls.filter(createdUser).length, 0);
  });
});

run('over the rate limit: 429 before the bot check', async () => {
  useRoutes(base(true, true));
  const res = await handler(post(orderBody()));
  assertEquals(res.status, 429);
  assertEquals(calls.filter(verifiedBot).length, 0);
});

run('"CASH" is refused before anything is counted, verified or created', async () => {
  useRoutes(base(true));
  const res = await handler(post(orderBody({ source_id: 'CASH' })));
  assertEquals(res.status, 400);
  assertEquals(calls.length, 0);
});

run('the staff queue is not behind Turnstile (it is behind a staff sign-in)', async () => {
  useRoutes([]);
  const res = await handler(post({ action: 'queue' }));
  assertEquals(res.status, 401);
  assertEquals(calls.filter(verifiedBot).length, 0);
});

// ---- the MFA gate (BRIEF-admin-mfa.md, section 4) --------------------------
//
// Staff actions and admin actions both go through requireRole, so an admin
// whose session is aal1 is asked for their code at either level, and nothing
// past the gate is read or written. A staff account is unaffected.

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const STAFF = '00000000-0000-0000-0000-0000000000c1';
const ADMIN_AAL1 = testJwt(ADMIN, 'aal1');
const STAFF_AAL1 = testJwt(STAFF, 'aal1');

const signedIn = (bearer: string, body: unknown) =>
  new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });

const mfaWorld = () => [
  authUsers({ [ADMIN_AAL1]: { id: ADMIN }, [STAFF_AAL1]: { id: STAFF } }),
  // The switch is on: an admin needs aal2; staff holds staff and nothing more.
  roleGateRoute(({ _user_id, _role, _aal }) =>
    _user_id === ADMIN ? (_aal === 'aal2' ? 'ok' : 'mfa_required') : _role === 'staff' ? 'ok' : 'forbidden'
  ),
  (c: any) => (c.url.pathname.startsWith('/rest/v1/') ? jsonResponse([]) : undefined),
];
const filmPassTableCalls = () =>
  calls.filter((c) => c.url.pathname.startsWith('/rest/v1/') && !c.url.pathname.startsWith('/rest/v1/rpc/role_gate')).length;

for (const action of ['queue', 'lookup', 'admit', 'void', 'delete']) {
  run(`${action}: an aal1 admin gets mfa_required, and no film-pass table is touched`, async () => {
    useRoutes(mfaWorld());
    const res = await handler(signedIn(ADMIN_AAL1, { action, pass_id: 'p1', qr_code: 'PASS:x', showing_id: 's1' }));
    assertEquals(res.status, 403);
    assertEquals((await res.json()).code, 'mfa_required');
    assertEquals(filmPassTableCalls(), 0);
  });
}

run('queue: a staff account at aal1 passes the gate and reads the queue', async () => {
  useRoutes(mfaWorld());
  const res = await handler(signedIn(STAFF_AAL1, { action: 'queue' }));
  assertEquals(res.status, 200);
  assertEquals(calls.filter((c) => is(c, 'GET', '/rest/v1/film_pass_orders')).length, 2);
});

run('void: staff is refused with the old wording, and no code prompt', async () => {
  useRoutes(mfaWorld());
  const res = await handler(signedIn(STAFF_AAL1, { action: 'void', pass_id: 'p1' }));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, 'Admin access required');
  assertEquals(body.code, undefined);
});
