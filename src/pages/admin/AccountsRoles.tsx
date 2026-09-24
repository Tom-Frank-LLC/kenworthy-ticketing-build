import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Shield, ShieldCheck } from 'lucide-react';
import { SEO } from '@/components/SEO';
import { AccountRolesManager } from '@/components/admin/AccountRolesManager';

/**
 * The /superadmin page: a heading around `AccountRolesManager`.
 *
 * All of the role logic lives in the manager, which the dashboard's Team →
 * Team Members sub-tab also renders. This page is kept for the superadmin's
 * header link and bookmarks; it used to be reachable as /admin/accounts too,
 * and that route is gone because an admin now reaches the same controls from
 * the dashboard. The manager still decides what to show by role, so an admin
 * who lands here by URL gets the restricted set, not an error.
 */
export default function AccountsRoles() {
  const { isAdmin, isSuperadmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Admin includes superadmin (see lib/auth.tsx). The route is wrapped in
  // AdminOnly as well; this is the in-page copy of the same signage.
  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) navigate('/');
  }, [authLoading, isAdmin, navigate]);

  if (authLoading || !isAdmin) return null;

  return (
    <>
      <SEO
        title={`${isSuperadmin ? 'Superadmin' : 'Admin'} — Accounts & Roles`}
        description="Manage staff accounts and roles for the Kenworthy platform."
      />
      <div className="container mx-auto px-4 py-10 max-w-5xl space-y-6">
        <header className="space-y-1">
          <p className="font-display uppercase tracking-[0.3em] text-xs text-primary flex items-center gap-2">
            {isSuperadmin
              ? <><ShieldCheck className="h-4 w-4" /> Superadmin</>
              : <><Shield className="h-4 w-4" /> Admin</>}
          </p>
          <h1 className="font-display uppercase text-4xl">Accounts &amp; roles</h1>
          <p className="font-serif text-muted-foreground">
            {isSuperadmin
              ? 'Grant or revoke roles. Superadmin inherits admin and staff access.'
              : 'Grant or revoke staff and host access. Accounts that hold admin or superadmin are managed by a superadmin and show as locked here.'}
          </p>
        </header>

        <AccountRolesManager />
      </div>
    </>
  );
}
