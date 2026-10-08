// admin-mfa-reset: the superadmin's recovery for a lost authenticator
// (BRIEF-admin-mfa.md, section 5). The real handler, every outbound call stubbed.
//
// What these pin: a reset needs an aal2 superadmin even while the switch is off
// (the gate says 'ok' to an aal1 session then, and the function must still
// refuse); nobody else gets in; the reset removes every factor and is audited;
// a superadmin can't reset themselves here.
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/admin-mfa-reset/handler_test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
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
  type Route,
  testJwt,
  useRoutes,
} from '../_shared/testing/handler_harness.ts';

const handler = await loadHandler(() => import('./index.ts'), BASE_ENV);

const SUPER = '00000000-0000-0000-0000-0000000000e1';
const ADMIN = '00000000-0000-0000-0000-0000000000d1';
const SUPER_AAL1 = testJwt(SUPER, 'aal1');
const SUPER_AAL2 = testJwt(SUPER, 'aal2');
const ADMIN_AAL2 = testJwt(ADMIN, 'aal2');

const users = authUsers({
  [SUPER_AAL1]: { id: SUPER, email: 'super@x.test' },
  [SUPER_AAL2]: { id: SUPER, email: 'super@x.test' },
  [ADMIN_AAL2]: { id: ADMIN, email: 'admin@x.test' },
});
/** Switch off: the gate is the plain role test, whatever the aal. */
const gateSwitchOff = roleGateRoute(({ _user_id, _role }) =>
  _user_id === SUPER || _role !== 'superadmin' ? 'ok' : 'forbidden'
);

const FACTORS = [
  { id: '0000000f-0000-4000-8000-000000000001', factor_type: 'totp', status: 'verified', friendly_name: 'Phone' },
  { id: '0000000f-0000-4000-8000-000000000002', factor_type: 'totp', status: 'verified', friendly_name: '1Password' },
];

/** GoTrue's admin API for the target, plus the audit write and the role list. */
const gotrueAdmin: Route = (c) => {
  const p = c.url.pathname;
  if (is(c, 'GET', `/auth/v1/admin/users/${ADMIN}`)) {
    return jsonResponse({ id: ADMIN, email: 'admin@x.test', factors: FACTORS });
  }
  if (is(c, 'GET', `/auth/v1/admin/users/${SUPER}`)) {
    return jsonResponse({ id: SUPER, email: 'super@x.test', factors: [FACTORS[0]] });
  }
  if (is(c, 'GET', `/auth/v1/admin/users/${ADMIN}/factors`)) return jsonResponse(FACTORS);
  if (c.method === 'DELETE' && p.startsWith(`/auth/v1/admin/users/${ADMIN}/factors/`)) {
    return jsonResponse({ id: p.split('/').pop() });
  }
  if (is(c, 'POST', '/rest/v1/admin_audit_log')) return jsonResponse([{}], 201);
  if (is(c, 'GET', '/rest/v1/user_roles')) {
    return jsonResponse([{ user_id: SUPER, role: 'superadmin' }, { user_id: ADMIN, role: 'admin' }]);
  }
  if (is(c, 'GET', '/rest/v1/app_config')) return jsonResponse({ value: { enabled: false } });
  return undefined;
};

const deletes = () => calls.filter((c: Call) => c.method === 'DELETE');
const audits = () => calls.filter((c: Call) => is(c, 'POST', '/rest/v1/admin_audit_log'));

function req(bearer: string, body: unknown): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
}

Deno.test('reset refuses an aal1 superadmin even with the switch off', async () => {
  useRoutes([users, gateSwitchOff, gotrueAdmin]);
  const res = await quietly(() => handler(req(SUPER_AAL1, { action: 'reset', user_id: ADMIN })));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).code, 'mfa_required');
  assertEquals(deletes().length, 0);
  assertEquals(audits().length, 0);
});

Deno.test('reset by an aal2 superadmin removes every factor and is audited', async () => {
  useRoutes([users, gateSwitchOff, gotrueAdmin]);
  const res = await quietly(() => handler(req(SUPER_AAL2, { action: 'reset', user_id: ADMIN })));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).removed, 2);
  assertEquals(deletes().map(c => c.url.pathname.split('/').pop()).sort(), ['0000000f-0000-4000-8000-000000000001', '0000000f-0000-4000-8000-000000000002']);
  assertEquals(audits().length, 1);
  const row = audits()[0].body as { action: string; entity_id: string; actor_id: string };
  assertEquals(row.action, 'auth.mfa_reset');
  assertEquals(row.entity_id, ADMIN);
  assertEquals(row.actor_id, SUPER);
});

Deno.test('a superadmin cannot reset themselves here', async () => {
  useRoutes([users, gateSwitchOff, gotrueAdmin]);
  const res = await quietly(() => handler(req(SUPER_AAL2, { action: 'reset', user_id: SUPER })));
  assertEquals(res.status, 400);
  assertEquals(deletes().length, 0);
});

Deno.test('an admin is refused both actions', async () => {
  for (const action of ['status', 'reset']) {
    useRoutes([users, gateSwitchOff, gotrueAdmin]);
    const res = await quietly(() => handler(req(ADMIN_AAL2, { action, user_id: SUPER })));
    assertEquals(res.status, 403);
    assertEquals((await res.json()).code, undefined);
    assertEquals(deletes().length, 0);
  }
});

Deno.test('the anon key is refused before any lookup', async () => {
  useRoutes([users, gateSwitchOff, gotrueAdmin]);
  const res = await quietly(() => handler(req(ANON, { action: 'status' })));
  assertEquals(res.status, 401);
  assert(!calls.some(c => c.url.pathname.startsWith('/auth/v1/admin')));
});

Deno.test('status lists role holders with their factor counts', async () => {
  useRoutes([users, gateSwitchOff, gotrueAdmin]);
  const res = await quietly(() => handler(req(SUPER_AAL1, { action: 'status' })));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.required, false);
  const byId = Object.fromEntries(body.accounts.map((a: { user_id: string }) => [a.user_id, a]));
  assertEquals(byId[ADMIN].verified_factors, 2);
  assertEquals(byId[SUPER].verified_factors, 1);
  assertEquals(byId[ADMIN].factor_types, ['totp']);
});
