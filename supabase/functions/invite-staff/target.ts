// The last check before invite-staff grants a role onto an existing account.
//
// Split out so it can be tested without a live auth server. The rule: the
// account's own auth.users address must be the invited address. Anything else
// — a lookup that answered from a self-editable column (security audit H1),
// a missing user, an auth error — refuses the grant.

export function inviteTargetMatches(
  invitedEmail: string,
  found: { user?: { email?: string | null } | null } | null | undefined,
  error: unknown,
): boolean {
  if (error) return false;
  const want = invitedEmail.trim().toLowerCase();
  const have = (found?.user?.email ?? '').trim().toLowerCase();
  return want !== '' && have === want;
}
