// square-transactions behind the MFA gate (BRIEF-admin-mfa.md, section 4): an
// admin-only read of the theatre's whole sales history. The real handler, every
// outbound call stubbed, so nothing reaches Square.
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/square-transactions/mfa_test.ts

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
  rpc,
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
const ADMIN_AAL2 = testJwt(ADMIN, 'aal2');
const STAFF_AAL1 = testJwt(STAFF, 'aal1');

const users = authUsers({
  [ADMIN_AAL1]: { id: ADMIN, email: 'admin@x.test' },
  [ADMIN_AAL2]: { id: ADMIN, email: 'admin@x.test' },
  [STAFF_AAL1]: { id: STAFF, email: 'staff@x.test' },
});
/** The database's rule with the switch on: role first, then aal2 for admins. */
const gateSwitchOn = roleGateRoute(({ _user_id, _role, _aal }) => {
  if (_user_id === ADMIN) return _aal === 'aal2' ? 'ok' : 'mfa_required';
  return _role === 'staff' ? 'ok' : 'forbidden';
});
/** Square answers anything with an empty page. */
const square: Route = (c) => (c.url.hostname.includes('squareup') ? jsonResponse({}) : undefined);
const anyRest: Route = (c) => (c.url.pathname.startsWith('/rest/v1/') ? jsonResponse([]) : undefined);

const toSquare = (c: Call) => c.url.hostname.includes('squareup');

function req(bearer: string): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({}),
  });
}

function run(name: string, fn: () => Promise<void>) {
  Deno.test({
    name,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: () => quietly(() => withEnv(SQUARE_TEST_ENV, async () => {
      useRoutes([users, gateSwitchOn, square, anyRest]);
      await fn();
    })),
  });
}

run('an aal1 admin is asked for the code, and Square is never asked', async () => {
  const res = await handler(req(ADMIN_AAL1));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.code, 'mfa_required');
  assertEquals(calls.filter(toSquare).length, 0);
  assertEquals(calls.find(rpc('role_gate'))!.body, { _user_id: ADMIN, _role: 'admin', _aal: 'aal1' });
});

run('the same admin at aal2 is let through to Square', async () => {
  const res = await handler(req(ADMIN_AAL2));
  assert(res.status !== 401 && res.status !== 403, `gate refused: ${res.status}`);
  assert(calls.filter(toSquare).length > 0, 'the gate passed, so Square was asked');
});

run('staff is forbidden outright, with no code prompt', async () => {
  const res = await handler(req(STAFF_AAL1));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.code, undefined);
  assertEquals(body.error, 'Admin access required');
  assertEquals(calls.filter(toSquare).length, 0);
});
