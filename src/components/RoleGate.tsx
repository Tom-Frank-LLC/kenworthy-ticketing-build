import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

/**
 * Route wrappers that will not render their child to the wrong person.
 *
 * Every one of these screens already turns an unprivileged visitor away in its
 * own `useEffect`, and that is worth keeping — but it turns them away *after*
 * mounting, which means the page's queries fire first and the redirect is a
 * navigation rather than a refusal. Here the decision happens before the child
 * exists at all, so a pasted URL never reaches the component behind it.
 *
 * Nothing here is a security boundary. RLS and the edge functions' own
 * `has_role` checks are; this is what stops someone who guessed `/staff/pos`
 * from being shown a till that then fails on every button. Treat it as
 * signage, not as a lock.
 *
 * The two roles are nested the way `lib/auth.tsx` nests them: `isAdmin` is
 * admin or superadmin, `isStaff` is those plus staff. `has_role` in the
 * database agrees — see migration 20260812063211_has_role_hierarchy.sql.
 */

function RoleGate({
  allowed,
  children,
}: {
  /** Whether this visitor may see the child, decided by the caller. */
  allowed: boolean;
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Roles arrive a round trip after the session does. Redirecting during that
  // window would bounce the person who *does* have the role, on every hard
  // refresh.
  if (loading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  if (!allowed) {
    // Two different people arrive here. Someone signed out is usually staff
    // whose session expired — send them to the sign-in card with a `redirect`
    // so they land back on the tool instead of hunting for the footer link.
    // Someone signed in without the role has nowhere to be sent but home;
    // /auth would show them a form they have already filled in.
    const to = user
      ? '/'
      : `/auth?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    return <Navigate to={to} replace />;
  }

  return <>{children}</>;
}

/** The counter: staff, admin and superadmin. */
export function StaffOnly({
  children,
  /**
   * Let a host through as well.
   *
   * The door scanner is the one staff tool a host runs: they scan their own
   * rented event's tickets from the host dashboard. Nothing else under /staff
   * is theirs.
   */
  allowHost = false,
}: {
  children: React.ReactNode;
  allowHost?: boolean;
}) {
  const { isStaff, isHost } = useAuth();
  return <RoleGate allowed={isStaff || (allowHost && isHost)}>{children}</RoleGate>;
}

/**
 * Management: admin and superadmin, and explicitly not staff.
 *
 * The dashboard used to admit anyone with `isStaff`, which is how the counter
 * came to live behind a door labelled "management" in the first place. Now that
 * the counter has /staff, the two sides mean what they say: a staff-only
 * account gets the till, the scanner and Print QRs, and nothing that edits the
 * schedule.
 */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth();
  return <RoleGate allowed={isAdmin}>{children}</RoleGate>;
}
