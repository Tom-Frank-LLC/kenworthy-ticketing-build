import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { MfaCodeStep } from '@/components/MfaCodeStep';
import { needsCode } from '@/lib/mfa';

/**
 * Two-step sign-in in front of a signed-in page (BRIEF-admin-mfa). Everyone who
 * signs in needs it, whatever their role.
 *
 * Signage, not the lock. Once the switch is on, the database and the edge
 * functions give a password-only session nothing it isn't owed as a signed-out
 * visitor. This is what keeps that from showing up as a page of empty tables:
 *
 *   - An account with an authenticator whose session is still password-only
 *     (restored from before it enrolled, or a tab left open) is asked for the
 *     code here. Once it verifies, the auth listener re-renders this with an
 *     aal2 session and the child appears.
 *   - An account with no authenticator, once the server requires one, is sent
 *     to set one up. While the switch is off they are only nudged, once, after
 *     signing in (Auth.tsx).
 *
 * Signed-out visitors pass straight through. The page decides what to do about
 * them.
 */
export function MfaGate({ children }: { children: React.ReactNode }) {
  const { user, loading, mfa, mfaRequired, signOut } = useAuth();
  const location = useLocation();

  if (loading || !user) return <>{children}</>;

  if (needsCode(mfa)) {
    return (
      <div className="container max-w-md py-16">
        <MfaCodeStep
          factors={mfa.verifiedFactors}
          onCancel={() => {
            void signOut().finally(() => { window.location.href = '/auth'; });
          }}
        />
      </div>
    );
  }

  if (mfaRequired && mfa.verifiedFactors.length === 0) {
    const here = location.pathname + location.search;
    return <Navigate to={`/account/security?setup=1&redirect=${encodeURIComponent(here)}`} replace />;
  }

  return <>{children}</>;
}
