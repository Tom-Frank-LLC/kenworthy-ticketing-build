import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  ADMIN_INVITABLE_ROLES,
  INVITABLE_ROLES,
  holdsProtectedRole,
  invitableRolesFor,
  inviteRefusal,
} from './role_management.ts';

/**
 * These pin the TypeScript half of the admin-scoped role rule. The database
 * half is pinned by supabase/tests/roles. The two must agree, and nothing
 * checks that they do except a reader holding both open — so each case here
 * names the RLS case it mirrors.
 */

Deno.test('the admin set is exactly staff and host', () => {
  assertEquals([...ADMIN_INVITABLE_ROLES], ['staff', 'host']);
  assertEquals([...invitableRolesFor('admin')], ['staff', 'host']);
  assertEquals([...invitableRolesFor('superadmin')], [...INVITABLE_ROLES]);
  assertEquals([...invitableRolesFor(null)], []);
});

Deno.test('holdsProtectedRole sees admin and superadmin only', () => {
  assertEquals(holdsProtectedRole(['regular_user']), false);
  assertEquals(holdsProtectedRole(['staff', 'host']), false);
  assertEquals(holdsProtectedRole(['regular_user', 'admin']), true);
  assertEquals(holdsProtectedRole(['superadmin']), true);
  assertEquals(holdsProtectedRole([]), false);
});

Deno.test('nobody without admin gets anywhere', () => {
  const r = inviteRefusal(null, 'staff', null);
  assertEquals(r?.status, 403);
});

Deno.test('superadmin may invite any role to anyone (RLS: "S grants admin to R")', () => {
  assertEquals(inviteRefusal('superadmin', 'admin', ['regular_user']), null);
  assertEquals(inviteRefusal('superadmin', 'superadmin', null), null);
  assertEquals(inviteRefusal('superadmin', 'staff', ['admin']), null);
});

Deno.test('admin may invite staff or host to a new or unprotected account (RLS: "A grants staff to R")', () => {
  assertEquals(inviteRefusal('admin', 'staff', null), null);
  assertEquals(inviteRefusal('admin', 'host', ['regular_user']), null);
  assertEquals(inviteRefusal('admin', 'staff', ['host', 'regular_user']), null);
});

Deno.test('admin may not mint admin or superadmin (RLS: "A grants admin to R")', () => {
  for (const role of ['admin', 'superadmin'] as const) {
    const r = inviteRefusal('admin', role, null);
    assertEquals(r?.status, 403);
    // The message has to say what to do instead, or the admin files a bug.
    assertEquals(r?.error.includes('superadmin'), true);
  }
});

Deno.test('admin may not touch a protected account, even with a lower role (RLS: "A grants staff to S")', () => {
  assertEquals(inviteRefusal('admin', 'staff', ['admin'])?.status, 403);
  assertEquals(inviteRefusal('admin', 'host', ['superadmin', 'regular_user'])?.status, 403);
});

Deno.test('the role check comes before the target check, so a bad role is refused even for a new account', () => {
  const r = inviteRefusal('admin', 'admin', ['regular_user']);
  assertEquals(r?.error.startsWith('Admins can invite'), true);
});
