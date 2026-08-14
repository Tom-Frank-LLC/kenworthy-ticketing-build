import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

/**
 * Route guard for pages that need a session at all — not a particular role.
 *
 * Pages in this app have historically guarded themselves with `useAuth()` plus
 * a redirect in an effect (see AdminDashboard, Superadmin). That works for the
 * admin tree, where the page is a shell that fetches nothing until it knows the
 * role, but it renders the page first and redirects after — so a page that
 * loads its content on mount flashes that content at a logged-out visitor
 * before bouncing them. Wrapping the route decides before the page ever
 * mounts, and it keeps the lazy chunk from being fetched at all.
 *
 * The `loading` check is the part that matters. `useAuth` starts `loading` true
 * and `user` null while `getSession()` restores the session from storage, so
 * deciding before it resolves would bounce a signed-in staff member to /auth on
 * every refresh. Render nothing until auth has actually answered.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Matches App.tsx's RouteFallback, so a refresh does not flicker between two
  // different loading states on the way to the same page.
  if (loading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  if (!user) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?redirect=${redirect}`} replace />;
  }

  return <>{children}</>;
}
