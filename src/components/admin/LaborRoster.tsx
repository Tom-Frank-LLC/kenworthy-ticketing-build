import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Link2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface SquareMember {
  id: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  status?: string;
  wage?: { hourly_rate_cents?: number; title?: string } | null;
}

interface StaffProfile {
  id: string;
  display_name: string | null;
  email: string | null;
}

interface Link {
  user_id: string;
  square_team_member_id: string;
}

export function LaborRoster() {
  const [loading, setLoading] = useState(true);
  const [simulated, setSimulated] = useState(false);
  const [members, setMembers] = useState<SquareMember[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [links, setLinks] = useState<Link[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [labor, roles, linksRes] = await Promise.all([
        supabase.functions.invoke('square-labor', { body: { action: 'list_team' } }),
        supabase.from('user_roles').select('user_id, role').in('role', ['admin', 'staff']),
        supabase.from('staff_square_links').select('user_id, square_team_member_id'),
      ]);
      if (labor.error) throw labor.error;
      setMembers(labor.data?.team_members || []);
      setSimulated(!!labor.data?.simulated);
      setLinks(linksRes.data || []);

      const userIds = [...new Set((roles.data || []).map((r) => r.user_id))];
      if (userIds.length) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name, email')
          .in('id', userIds);
        setStaff(profiles || []);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load roster');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setLink = async (memberId: string, userId: string | null) => {
    if (userId === null) {
      await supabase.from('staff_square_links').delete().eq('square_team_member_id', memberId);
    } else {
      // Remove any existing link for this user or this member
      await supabase.from('staff_square_links').delete().eq('user_id', userId);
      await supabase.from('staff_square_links').delete().eq('square_team_member_id', memberId);
      const { error } = await supabase.from('staff_square_links').insert({
        user_id: userId,
        square_team_member_id: memberId,
      });
      if (error) { toast.error(error.message); return; }
    }
    toast.success('Link updated');
    load();
  };

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Loading team…</div>;
  }

  return (
    <div className="space-y-4">
      {simulated && (
        <Card className="border-accent/40 bg-accent/5">
          <CardContent className="py-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-accent mt-0.5" />
            <span>Square sandbox returned no team data. Add team members in your Square sandbox dashboard, or wait for production wire-up.</span>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle className="font-display">Square Team Roster</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Square Team Member</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Wage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Linked Lovable user</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No team members.</TableCell></TableRow>
              ) : members.map((m) => {
                const link = links.find((l) => l.square_team_member_id === m.id);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{[m.given_name, m.family_name].filter(Boolean).join(' ') || '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{m.email || '—'}</TableCell>
                    <TableCell>{m.wage?.hourly_rate_cents ? `$${(m.wage.hourly_rate_cents / 100).toFixed(2)}/hr` : <span className="text-muted-foreground text-xs">Set in production</span>}</TableCell>
                    <TableCell><Badge variant={m.status === 'ACTIVE' ? 'default' : 'secondary'}>{m.status || '—'}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-2 items-center">
                        <Select value={link?.user_id || 'none'} onValueChange={(v) => setLink(m.id, v === 'none' ? null : v)}>
                          <SelectTrigger className="w-[240px]"><SelectValue placeholder="Unlinked" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— Unlinked —</SelectItem>
                            {staff.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.display_name || s.email}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {link && <Link2 className="h-4 w-4 text-primary" />}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}