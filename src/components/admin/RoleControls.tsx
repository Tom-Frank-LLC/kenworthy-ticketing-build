import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Shield, X, Plus, Lock } from 'lucide-react';
import { toast } from 'sonner';
import {
  ROLES, ADMIN_GRANTABLE_ROLES, ROLE_COLOR, isProtected, type Role,
} from '@/lib/roleRules';

/**
 * One account's role badges (each with a revoke ×) and the grant buttons for
 * the roles it does not hold. Rendered on a /superadmin row and on a Team
 * Members card alike, so the admin-vs-superadmin shape is decided once here.
 *
 * A superadmin edits anyone. An admin edits only unprotected accounts — which
 * is also why their own row is locked: they hold admin, so they are protected
 * from themselves.
 */
export function RoleControls({
  userId,
  roles,
  onChanged,
}: {
  userId: string;
  roles: Role[];
  /** Called after any successful write, so the owner can reload. */
  onChanged: () => void;
}) {
  const { user, isSuperadmin } = useAuth();
  const grantable: readonly Role[] = isSuperadmin ? ROLES : ADMIN_GRANTABLE_ROLES;
  const editable = isSuperadmin || !isProtected(roles);
  const missing = editable ? grantable.filter(role => !roles.includes(role)) : [];

  async function grant(role: Role) {
    const { error } = await supabase.from('user_roles').insert({ user_id: userId, role });
    if (error) toast.error(error.message);
    else { toast.success(`Granted ${role}`); onChanged(); }
  }

  async function revoke(role: Role) {
    if (role === 'superadmin' && userId === user?.id) {
      if (!confirm('Remove your own superadmin role? You will lose access to this page.')) return;
    }
    const { error } = await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', role);
    if (error) toast.error(error.message);
    else { toast.success(`Removed ${role}`); onChanged(); }
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {roles.length === 0 && <span className="text-xs text-muted-foreground italic">no roles</span>}
      {roles.map(role => (
        <Badge
          key={role}
          className={`text-xs ${editable ? ROLE_COLOR[role] : 'bg-muted text-muted-foreground'} pl-2 ${editable ? 'pr-1' : 'pr-2'} gap-1`}
        >
          {role === 'superadmin' && <Shield className="h-3 w-3" />}
          {role}
          {editable && (
            <button
              onClick={() => revoke(role)}
              className="ml-0.5 hover:bg-foreground/10 rounded p-0.5"
              aria-label={`Remove ${role}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </Badge>
      ))}
      {!editable && (
        <span className="text-xs font-serif text-muted-foreground flex items-center gap-1 ml-1">
          <Lock className="h-3 w-3" aria-hidden="true" /> Managed by a superadmin
        </span>
      )}
      {missing.map(role => (
        <Button
          key={role}
          size="sm"
          variant="outline"
          onClick={() => grant(role)}
          className="text-xs h-7"
        >
          <Plus className="h-3 w-3 mr-1" /> {role}
        </Button>
      ))}
    </div>
  );
}
