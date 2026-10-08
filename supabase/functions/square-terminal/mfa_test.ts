// square-terminal behind the MFA gate (BRIEF-admin-mfa.md, section 4). A staff
// gate, so this is the all-or-nothing case: an admin at aal1 is refused even
// the counter work a staff account may do. The real handler, every outbound call
// stubbed, so no checkout reaches a reader.
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/square-terminal/mfa_test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  ANON,
  authUsers,
  BASE_ENV,
  type Call,
  calls,
  jsonResponse,
  loadHandler,
  quietly,
  roleGateRoute,
  type Route,
  SQUARE_TEST_ENV,
  testJwt,
  useRoutes,
  withEnv,
} from '../_shared/testing/handler_harness.ts';

const handler = await loadHandler(() => import('./index.ts'), BASE_ENV);

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const STAFF = '00000000-0000-0000-0000-0000000000c1';
const ADMIN_AAL1 = testJwt(ADMIN, 'aal1');
const STAFF_AAL1 = testJwt(STAFF, 'aal1');

const users = authUsers({
  [ADMIN_AAL1]: { id: ADMIN, email: 'admin@x.test' },
  [STAFF_AAL1]: { id: STAFF, email: 'staff@x.test' },
});
const gateSwitchOn = roleGateRoute(({ _user_id, _aal }) =>
  _user_id === ADMIN ? (_aal === 'aal2' ? 'ok' : 'mfa_required') : 'ok'
);
const square: Route = (c) =>
  c.url.hostname.includes('squareup') ? jsonResponse({ checkout: { id: 'chk-1', status: 'PENDING' } }) : undefined;

const toSquare = (c: Call) => c.url.hostname.includes('squareup');

function checkout(bearer: string): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({
      action: 'create_checkout',
      amount_cents: 1060,
      note: 'test',
      idempotency_key: 'idem-terminal-1',
    }),
  });
}

function run(name: string, fn: () => Promise<void>) {
  Deno.test({
    name,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: () => quietly(() => withEnv(SQUARE_TEST_ENV, async () => {
      useRoutes([users, gateSwitchOn, square]);
      await fn();
    })),
  });
}

run('an aal1 admin at the till is asked for the code, and nothing reaches the reader', async () => {
  const res = await handler(checkout(ADMIN_AAL1));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).code, 'mfa_required');
  assertEquals(calls.filter(toSquare).length, 0);
});

run('a staff account at aal1 is unaffected: the checkout goes to Square', async () => {
  const res = await handler(checkout(STAFF_AAL1));
  assertEquals(res.status, 200, await res.clone().text());
  assert(calls.filter(toSquare).length > 0);
});

run('the anon key is refused 401 before the gate is asked', async () => {
  const res = await handler(checkout(ANON));
  assertEquals(res.status, 401);
  assertEquals(calls.filter((c) => c.url.pathname === '/rest/v1/rpc/role_gate').length, 0);
  assertEquals(calls.filter(toSquare).length, 0);
});
