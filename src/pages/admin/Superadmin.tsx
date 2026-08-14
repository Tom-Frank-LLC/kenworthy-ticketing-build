import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Shield, ShieldCheck, X, Plus, Image as ImageIcon, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { SEO } from '@/components/SEO';

const ROLES = ['superadmin', 'admin', 'staff', 'host', 'regular_user'] as const;
type Role = typeof ROLES[number];

/**
 * Roles the invite flow will assign. `regular_user` is missing on purpose — the
 * signup trigger stamps it automatically, so inviting somebody *as* one is not
 * a thing anyone means to do. The edge function rejects it too; this list only
 * keeps the mistake off the screen.
 */
const INVITABLE_ROLES = ['staff', 'admin', 'host', 'superadmin'] as const;
type InvitableRole = typeof INVITABLE_ROLES[number];

const ROLE_COLOR: Record<Role, string> = {
  superadmin: 'bg-primary text-primary-foreground',
  admin: 'bg-accent text-accent-foreground',
  staff: 'bg-muted text-foreground',
  host: 'bg-muted text-foreground',
  regular_user: 'bg-muted/50 text-muted-foreground',
};

type Row = { id: string; email: string | null; display_name: string | null; roles: Role[] };

export default function Superadmin() {
  const { user, isSuperadmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [refetching, setRefetching] = useState(false);
  const [refetchSummary, setRefetchSummary] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<InvitableRole>('staff');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isSuperadmin) { navigate('/'); return; }
    load();
  }, [authLoading, isSuperadmin, navigate]);

  async function load() {
    setLoading(true);
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
      supabase.from('profiles').select('id, email, display_name'),
      supabase.from('user_roles').select('user_id, role'),
    ]);
    if (pErr || rErr) { toast.error((pErr || rErr)!.message); setLoading(false); return; }
    const roleMap = new Map<string, Role[]>();
    (roles || []).forEach((r: any) => {
      const arr = roleMap.get(r.user_id) || [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    });
    const combined: Row[] = (profiles || []).map((p: any) => ({
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
    const { error } = await (supabase as any).from('user_roles').insert({ user_id: userId, role });
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

  async function runRefetch(dryRun: boolean) {
    setRefetching(true);
    setRefetchSummary(null);
    try {
      const { data, error } = await supabase.functions.invoke('refetch-posters', {
        body: { dryRun },
      });
      if (error) throw error;
      const s = data as any;
      toast.success(
        dryRun
          ? `Would update ${s.total} poster${s.total === 1 ? '' : 's'}.`
          : `Updated ${s.updated} · failed ${s.failed}.`
      );
      setRefetchSummary(JSON.stringify(s, null, 2));
    } catch (e: any) {
      toast.error(e.message || 'Re-fetch failed');
    } finally {
      setRefetching(false);
    }
  }

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
    } catch (err: any) {
      toast.error(err.message || 'Could not send that invitation');
    } finally {
      setInviting(false);
    }
  }

  if (authLoading || !isSuperadmin) return null;

  return (
    <>
      <SEO title="Superadmin — User Roles" description="Manage user roles for the Kenworthy platform." />
      <div className="container mx-auto px-4 py-10 max-w-5xl space-y-6">
        <header className="space-y-1">
          <p className="font-display uppercase tracking-[0.3em] text-xs text-primary flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Superadmin
          </p>
          <h1 className="font-display uppercase text-4xl">User roles</h1>
          <p className="font-serif text-muted-foreground">
            Grant or revoke roles. Superadmin inherits admin and staff access.
          </p>
        </header>

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
                      {INVITABLE_ROLES.map(role => (
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

        <Card className="glass">
          <CardContent className="p-4 space-y-2">
            <p className="font-display uppercase tracking-wider text-sm flex items-center gap-2">
              <ImageIcon className="h-4 w-4" /> Re-fetch posters
            </p>
            <p className="text-xs font-serif text-muted-foreground">
              Scans movies, events, and live performances for poster URLs with a WordPress size
              suffix (e.g. <code>-198x300.jpg</code>), downloads the full-size original from
              kenworthy.org, uploads it to storage, and replaces the URL.
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                disabled={refetching}
                onClick={() => runRefetch(true)}
              >
                Preview (dry run)
              </Button>
              <Button
                size="sm"
                disabled={refetching}
                onClick={() => runRefetch(false)}
              >
                {refetching ? 'Working…' : 'Run re-fetch'}
              </Button>
            </div>
            {refetchSummary && (
              <pre className="text-[10px] font-mono bg-muted/40 rounded p-2 max-h-64 overflow-auto whitespace-pre-wrap">
                {refetchSummary}
              </pre>
            )}
          </CardContent>
        </Card>

        {loading ? (
          <p className="text-muted-foreground font-serif">Loading…</p>
        ) : (
          <div className="space-y-2">
            {filtered.map(r => {
              const missing = ROLES.filter(role => !r.roles.includes(role));
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
                          <Badge key={role} className={`text-xs ${ROLE_COLOR[role]} pl-2 pr-1 gap-1`}>
                            {role === 'superadmin' && <Shield className="h-3 w-3" />}
                            {role}
                            <button
                              onClick={() => revoke(r.id, role)}
                              className="ml-0.5 hover:bg-foreground/10 rounded p-0.5"
                              aria-label={`Remove ${role}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end">
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
    </>
  );
}