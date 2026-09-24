// Who may grant what, in one place.
//
// Two admin screens show role controls — the /superadmin page and the Team
// Members roster on the dashboard — and both have to agree with the RLS on
// `user_roles` (migration 20260916080513) and with `invite-staff`'s own
// checks. A rule written twice drifts, and the failure is quiet: one screen
// shows a button the server refuses. So the rules are data here, and the
// screens only render them.
//
// None of this is a boundary. Hiding a button stops nobody from calling the
// API directly; the server refuses what these lists refuse. What the lists add
// is not showing someone a control that would fail.

export const ROLES = ['superadmin', 'admin', 'staff', 'host', 'regular_user'] as const;
export type Role = typeof ROLES[number];

/** Holding either makes an account off-limits to admins. Mirrors is_protected_user(). */
export const PROTECTED_ROLES: readonly Role[] = ['admin', 'superadmin'];

/** What an admin may grant or revoke. Mirrors the "Admins ... lower roles" policies. */
export const ADMIN_GRANTABLE_ROLES: readonly Role[] = ['staff', 'host', 'regular_user'];

/**
 * The roles that make an account part of the team. The roster shows exactly
 * these; a regular user — a past ticket buyer — is not a team member and is
 * onboarded through Invite, which grants the role onto their existing account.
 */
export const TEAM_ROLES: readonly Role[] = ['superadmin', 'admin', 'staff', 'host'];

/**
 * Roles the invite flow will assign. `regular_user` is missing on purpose — the
 * signup trigger stamps it automatically, so inviting somebody *as* one is not
 * a thing anyone means to do. The edge function rejects it too; this list only
 * keeps the mistake off the screen.
 */
export const INVITABLE_ROLES = ['staff', 'admin', 'host', 'superadmin'] as const;
export type InvitableRole = typeof INVITABLE_ROLES[number];

/** The subset an admin may invite. Mirrors ADMIN_INVITABLE_ROLES in the function. */
export const ADMIN_INVITABLE_ROLES: readonly InvitableRole[] = ['staff', 'host'];

export const ROLE_COLOR: Record<Role, string> = {
  superadmin: 'bg-primary text-primary-foreground',
  admin: 'bg-accent text-accent-foreground',
  staff: 'bg-muted text-foreground',
  host: 'bg-muted text-foreground',
  regular_user: 'bg-muted/50 text-muted-foreground',
};

export function isProtected(roles: readonly Role[]): boolean {
  return roles.some(role => PROTECTED_ROLES.includes(role));
}

/** Highest role first, the way both screens sort. */
export function roleRank(roles: readonly Role[]): number {
  return roles.includes('superadmin') ? 0
    : roles.includes('admin') ? 1
    : roles.includes('staff') ? 2
    : roles.includes('host') ? 3
    : 4;
}
