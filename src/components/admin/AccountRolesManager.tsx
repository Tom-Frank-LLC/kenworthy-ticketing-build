import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { invokeFunction } from '@/lib/functions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Shield, X, Plus, UserPlus, Lock } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Accounts & roles — one component, two shapes.
 *
 * A superadmin sees every control: any role on anyone, any invitable role. An
 * admin sees the same list, but may only grant and revoke the lower roles, and
 * only on accounts that hold neither admin nor superadmin (a "protected user");
 * those rows render locked.
 *
 * It renders in two places — the /superadmin page and the dashboard's Team →
 * Team Members sub-tab — and that is why it is one component rather than a
 * page and a copy. The grant/revoke/invite rules below mirror the RLS on
 * `user_roles` and the checks in `invite-staff`; two renderings that could
 * drift apart would eventually show one audience a button the server refuses.
 * Because the shape follows `useAuth`, not the mount point, an admin gets the
 * restricted set wherever it appears and a superadmin the full one.
 *
 * None of that is a boundary. The buttons this hides are refused by RLS on
 * `user_roles` (migration 20260916080513) and by `invite-staff`, so a crafted
 * request gets exactly what the server allows. What the component adds is not
 * showing an admin a button that would fail.
 */

const ROLES = ['superadmin', 'admin', 'staff', 'host', 'regular_user'] as const;
type Role = typeof ROLES[number];

/** Holding either makes an account off-limits to admins. Mirrors is_protected_user(). */
const PROTECTED_ROLES: readonly Role[] = ['admin', 'superadmin'];

/** What an admin may grant or revoke. Mirrors the "Admins ... lower roles" policies. */
const ADMIN_GRANTABLE_ROLES: readonly Role[] = ['staff', 'host', 'regular_user'];

/**
 * Roles the invite flow will assign. `regular_user` is missing on purpose — the
 * signup trigger stamps it automatically, so inviting somebody *as* one is not
 * a thing anyone means to do. The edge function rejects it too; this list only
 * keeps the mistake off the screen.
 */
const INVITABLE_ROLES = ['staff', 'admin', 'host', 'superadmin'] as const;
type InvitableRole = typeof INVITABLE_ROLES[number];

/** The subset an admin may invite. Mirrors ADMIN_INVITABLE_ROLES in the function. */
const ADMIN_INVITABLE_ROLES: readonly InvitableRole[] = ['staff', 'host'];

const ROLE_COLOR: Record<Role, string> = {
  superadmin: 'bg-primary text-primary-foreground',
  admin: 'bg-accent text-accent-foreground',
  staff: 'bg-muted text-foreground',
  host: 'bg-muted text-foreground',
  regular_user: 'bg-muted/50 text-muted-foreground',
};

type Row = { id: string; email: string | null; display_name: string | null; roles: Role[] };

function isProtected(row: Row): boolean {
  return row.roles.some(role => PROTECTED_ROLES.includes(role));
}

export function AccountRolesManager() {
  const { user, isSuperadmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<InvitableRole>('staff');
  const [inviting, setInviting] = useState(false);

  useEffect(() => { load(); }, []);

  const grantable: readonly Role[] = isSuperadmin ? ROLES : ADMIN_GRANTABLE_ROLES;
  const invitable: readonly InvitableRole[] = isSuperadmin ? INVITABLE_ROLES : ADMIN_INVITABLE_ROLES;

  async function load() {
    setLoading(true);
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('user_roles').select('user_id, role'),
    ]);
    if (pErr || rErr) { toast.error((pErr || rErr)!.message); setLoading(false); return; }
    const roleMap = new Map<string, Role[]>();
    (roles || []).forEach(r => {
      const arr = roleMap.get(r.user_id) || [];
      arr.push(r.role as Role);
      roleMap.set(r.user_id, arr);
    });
    const combined: Row[] = (profiles || []).map(p => ({
      id: p.id, email: p.email, display_name: p.display_name,
      roles: roleMap.get(p.id) || [],
    }));
    combined.sort((a, b) => {
      const w = (r: Row) => r.roles.includes('superadmin') ? 0 : r.roles.includes('admin') ? 1 : r.roles.includes('staff') ? 2 : r.roles.includes('host') ? 3 : 4;
      return w(a) - w(b) || (a.email || '').localeCompare(b.email || '');
    });
    setRows(combined);
    setLoading(false);
  }

  async function grant(userId: string, role: Role) {
    const { error } = await supabase.from('user_roles').insert({ user_id: userId, role });
    if (error) toast.error(error.message);
    else { toast.success(`Granted ${role}`); load(); }
  }

  async function revoke(userId: string, role: Role) {
    if (role === 'superadmin' && userId === user?.id) {
      if (!confirm('Remove your own superadmin role? You will lose access to this page.')) return;
    }
    const { error } = await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', role);
    if (error) toast.error(error.message);
    else { toast.success(`Removed ${role}`); load(); }
  }

  const filtered = rows.filter(r => !q ||
    (r.email || '').toLowerCase().includes(q.toLowerCase()) ||
    (r.display_name || '').toLowerCase().includes(q.toLowerCase())
  );

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    try {
      const res = await invokeFunction<{ created: boolean; email: string; role: string }>(
        'invite-staff',
        { email: inviteEmail, display_name: inviteName, role: inviteRole },
      );
      toast.success(
        res.created
          ? `Invited ${res.email} as ${res.role} — they'll get an email to set a password.`
          : `${res.email} already had an account — granted ${res.role}.`,
      );
      setInviteOpen(false);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('staff');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send that invitation');
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Search by email or name…"
          value={q}
          onChange={e => setQ(e.target.value)}
          className="max-w-md"
        />
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" /> Invite staff member
        </Button>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={invite}>
            <DialogHeader>
              <DialogTitle className="font-display uppercase">Invite staff member</DialogTitle>
              <DialogDescription className="font-serif">
                Creates their account and assigns the role. They receive an email with a link to
                set a password, then sign in at /auth. If they already have an account — a past
                ticket buyer, say — the role is added to it rather than making a second one.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-name">Display name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="invite-name"
                  value={inviteName}
                  onChange={e => setInviteName(e.target.value)}
                  placeholder="Jane Doe"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select value={inviteRole} onValueChange={v => setInviteRole(v as InvitableRole)}>
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {invitable.map(role => (
                      <SelectItem key={role} value={role}>{role}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={inviting || !inviteEmail.trim()}>
                {inviting ? 'Sending…' : 'Send invitation'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {loading ? (
        <p className="text-muted-foreground font-serif">Loading…</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => {
            // A superadmin edits anyone. An admin edits only unprotected
            // accounts — which is also why their own row is locked: they
            // hold admin, so they are protected from themselves.
            const editable = isSuperadmin || !isProtected(r);
            const missing = editable ? grantable.filter(role => !r.roles.includes(role)) : [];
            return (
              <Card key={r.id} className="glass">
                <CardContent className="p-3 grid gap-2 md:grid-cols-[1fr_auto] items-center">
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {r.display_name || '—'}
                      {r.id === user?.id && <span className="ml-2 text-xs text-accent">(you)</span>}
                    </p>
                    <p className="text-xs font-serif text-muted-foreground truncate">{r.email || r.id}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {r.roles.length === 0 && <span className="text-xs text-muted-foreground italic">no roles</span>}
                      {r.roles.map(role => (
                        <Badge
                          key={role}
                          className={`text-xs ${editable ? ROLE_COLOR[role] : 'bg-muted text-muted-foreground'} pl-2 ${editable ? 'pr-1' : 'pr-2'} gap-1`}
                        >
                          {role === 'superadmin' && <Shield className="h-3 w-3" />}
                          {role}
                          {editable && (
                            <button
                              onClick={() => revoke(r.id, role)}
                              className="ml-0.5 hover:bg-foreground/10 rounded p-0.5"
                              aria-label={`Remove ${role}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {!editable && (
                      <span className="text-xs font-serif text-muted-foreground flex items-center gap-1">
                        <Lock className="h-3 w-3" aria-hidden="true" /> Managed by a superadmin
                      </span>
                    )}
                    {missing.map(role => (
                      <Button
                        key={role}
                        size="sm"
                        variant="outline"
                        onClick={() => grant(r.id, role)}
                        className="text-xs h-7"
                      >
                        <Plus className="h-3 w-3 mr-1" /> {role}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-center py-8 text-muted-foreground font-serif">No users match your search.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default AccountRolesManager;
