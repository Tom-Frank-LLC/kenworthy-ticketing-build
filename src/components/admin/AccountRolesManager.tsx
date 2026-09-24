import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { roleRank, type Role } from '@/lib/roleRules';
import { RoleControls } from './RoleControls';
import { InviteStaffDialog } from './InviteStaffDialog';

/**
 * Every account with its roles — the /superadmin page's body.
 *
 * This is the complete list, regular users included: it is where a superadmin
 * finds any account at all. The dashboard's Team Members roster is the
 * day-to-day view and shows only the team; both render `RoleControls` and
 * `InviteStaffDialog`, so the admin-vs-superadmin rules live once, in
 * `lib/roleRules.ts`.
 */

type Row = { id: string; email: string | null; display_name: string | null; roles: Role[] };

export function AccountRolesManager() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => { load(); }, []);

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
    combined.sort((a, b) => roleRank(a.roles) - roleRank(b.roles) || (a.email || '').localeCompare(b.email || ''));
    setRows(combined);
    setLoading(false);
  }

  const filtered = rows.filter(r => !q ||
    (r.email || '').toLowerCase().includes(q.toLowerCase()) ||
    (r.display_name || '').toLowerCase().includes(q.toLowerCase())
  );

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

      <InviteStaffDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={load} />

      {loading ? (
        <p className="text-muted-foreground font-serif">Loading…</p>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => (
            <Card key={r.id} className="glass">
              <CardContent className="p-3 grid gap-2 md:grid-cols-[1fr_auto] items-center">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {r.display_name || '—'}
                    {r.id === user?.id && <span className="ml-2 text-xs text-accent">(you)</span>}
                  </p>
                  <p className="text-xs font-serif text-muted-foreground truncate">{r.email || r.id}</p>
                </div>
                <div className="flex justify-end">
                  <RoleControls userId={r.id} roles={r.roles} onChanged={load} />
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <p className="text-center py-8 text-muted-foreground font-serif">No users match your search.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default AccountRolesManager;
