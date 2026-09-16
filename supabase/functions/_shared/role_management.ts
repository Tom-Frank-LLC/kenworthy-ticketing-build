// Who may hand out which role — the one place the rule is written in TypeScript.
//
// The rule itself lives in the database: migration 20260916080513
// (admin_scoped_role_management) makes RLS on user_roles the boundary for
// client-side grants and revokes. invite-staff cannot lean on that, because it
// runs as service_role and RLS never sees its writes, so it has to apply the
// same rule by hand before it touches the table. This module is that rule,
// kept small enough to test without a database.
//
// In one sentence: a "protected user" is anyone holding admin or superadmin;
// an admin may deal only in the lower roles, and only with users who are not
// protected. Superadmin keeps full power.
//
// If you change the sets below, change the SQL policy to match. The RLS test
// (supabase/tests/roles) pins the database side; role_management_test.ts pins
// this side. Neither can see the other drift.

export const ALL_ROLES = ['superadmin', 'admin', 'staff', 'host', 'regular_user'] as const;
export type AppRole = typeof ALL_ROLES[number];

/** Holding either of these makes an account off-limits to admins. */
export const PROTECTED_ROLES: readonly AppRole[] = ['admin', 'superadmin'];

/**
 * Roles the invite flow will grant at all.
 *
 * `regular_user` is excluded on purpose — the on_auth_user_created trigger
 * already stamps it, so asking for it here means "invite a staff member who is
 * not staff", which is a mistake worth rejecting rather than honouring.
 */
export const INVITABLE_ROLES = ['staff', 'admin', 'host', 'superadmin'] as const;
export type InvitableRole = typeof INVITABLE_ROLES[number];

/** The subset an admin may invite. Matches the INSERT policy's allowed set. */
export const ADMIN_INVITABLE_ROLES: readonly InvitableRole[] = ['staff', 'host'];

/** What the caller is, once has_role() has been asked. */
export type CallerTier = 'superadmin' | 'admin' | null;

export function isInvitableRole(role: string): role is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role);
}

export function invitableRolesFor(tier: CallerTier): readonly InvitableRole[] {
  if (tier === 'superadmin') return INVITABLE_ROLES;
  if (tier === 'admin') return ADMIN_INVITABLE_ROLES;
  return [];
}

/** True when a role list contains admin or superadmin. */
export function holdsProtectedRole(roles: readonly string[]): boolean {
  return roles.some(r => (PROTECTED_ROLES as readonly string[]).includes(r));
}

export interface Refusal {
  status: 403;
  error: string;
}

/**
 * May `tier` grant `role` to an account that currently holds `targetRoles`?
 *
 * Returns null when allowed, or the refusal to send back. Pass `null` for
 * `targetRoles` when the account does not exist yet (the request has no target
 * to protect) or is not known yet (an early check before the lookup) — the
 * caller must ask again once it has the real list.
 *
 * A nullable failure rather than a discriminated union: see the note in
 * tsconfig about `strict: false` and narrowing on the client side; the
 * functions are strict, but one shape for both worlds is easier to keep true.
 */
export function inviteRefusal(
  tier: CallerTier,
  role: InvitableRole,
  targetRoles: readonly string[] | null,
): Refusal | null {
  if (tier === null) return { status: 403, error: 'Admin access required' };
  if (tier === 'superadmin') return null;

  if (!ADMIN_INVITABLE_ROLES.includes(role)) {
    return {
      status: 403,
      error: `Admins can invite ${ADMIN_INVITABLE_ROLES.join(' or ')} only; ask a superadmin to grant ${role}`,
    };
  }
  if (targetRoles && holdsProtectedRole(targetRoles)) {
    return {
      status: 403,
      error: 'That account holds admin or superadmin and can only be changed by a superadmin',
    };
  }
  return null;
}
