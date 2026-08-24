import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

/**
 * A route wrapper that will not render its child to a patron.
 *
 * Every staff screen already turns an unprivileged visitor away in its own
 * `useEffect`, and that is worth keeping — but it turns them away *after*
 * mounting, which means the page's queries fire first and the redirect is a
 * navigation rather than a refusal. Here the decision happens before the child
 * exists at all, so a pasted URL never reaches the component behind it.
 *
 * Nothing here is a security boundary. RLS and the edge functions' own
 * `has_role` checks are; this is what stops a patron who guessed `/staff/pos`
 * from being shown a till that then fails on every button. Treat it as
 * signage, not as a lock.
 *
 * `isStaff` is already the union of staff, admin and superadmin — see
 * `checkRoles` in src/lib/auth.tsx, and `has_role`'s matching hierarchy in
 * migration 20260812063211.
 */
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
  const { user, isStaff, isHost, loading } = useAuth();
  const location = useLocation();

  // Roles arrive a round trip after the session does. Redirecting during that
  // window would bounce the person who *is* staff, on every hard refresh.
  if (loading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  if (!isStaff && !(allowHost && isHost)) {
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
