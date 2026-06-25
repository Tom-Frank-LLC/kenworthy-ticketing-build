import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, startOfWeek, endOfWeek, subWeeks, differenceInMinutes } from 'date-fns';
import { Loader2, Send } from 'lucide-react';

interface Shift { id: string; team_member_id: string; start_at: string; end_at?: string | null; breaks?: Array<{ start_at: string; end_at?: string | null; is_paid?: boolean }> }
interface Member { id: string; given_name?: string; family_name?: string; wage?: { hourly_rate_cents?: number } | null }
interface Link { user_id: string; square_team_member_id: string }

function shiftMinutes(s: Shift) {
  if (!s.end_at) return 0;
  const total = differenceInMinutes(new Date(s.end_at), new Date(s.start_at));
  const unpaid = (s.breaks || []).reduce((sum, b) => {
    if (!b.end_at || b.is_paid) return sum;
    return sum + differenceInMinutes(new Date(b.end_at), new Date(b.start_at));
  }, 0);
  return Math.max(0, total - unpaid);
}

export function PayrollExport() {
  const today = new Date();
  const lastWeek = subWeeks(today, 1);
  const [periodStart, setPeriodStart] = useState(format(startOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [periodEnd, setPeriodEnd] = useState(format(endOfWeek(lastWeek, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [qboConnected, setQboConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, l, h, qbo] = await Promise.all([
        supabase.functions.invoke('square-labor', {
          body: { action: 'list_shifts',
            begin: new Date(periodStart + 'T00:00:00').toISOString(),
            end: new Date(periodEnd + 'T23:59:59').toISOString() },
        }),
        supabase.functions.invoke('square-labor', { body: { action: 'list_team' } }),
        supabase.from('staff_square_links').select('user_id, square_team_member_id'),
        supabase.from('payroll_exports').select('*').order('created_at', { ascending: false }).limit(10),
        supabase.functions.invoke('qbo-sync?action=status', { method: 'POST' }),
      ]);
      setShifts(s.data?.shifts || []);
      setMembers(t.data?.team_members || []);
      setLinks((l.data || []) as Link[]);
      setHistory(h.data || []);
      setQboConnected(!!(qbo.data as any)?.connected);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load');
    } finally { setLoading(false); }
  }, [periodStart, periodEnd]);

  useEffect(() => { load(); }, [load]);

  const lines = useMemo(() => {
    const linkByMember = new Map(links.map((l) => [l.square_team_member_id, l.user_id]));
    const memberMap = new Map(members.map((m) => [m.id, m]));
    const buckets = new Map<string, { user_id: string; staff_name: string; minutes: number; rateMinutes: number; rateCentsSum: number }>();
    for (const s of shifts) {
      const userId = linkByMember.get(s.team_member_id);
      const m = memberMap.get(s.team_member_id);
      const name = m ? [m.given_name, m.family_name].filter(Boolean).join(' ') : s.team_member_id;
      const mins = shiftMinutes(s);
      const rate = m?.wage?.hourly_rate_cents || 0;
      const cur = buckets.get(s.team_member_id) || { user_id: userId || '', staff_name: name, minutes: 0, rateMinutes: 0, rateCentsSum: 0 };
      cur.minutes += mins;
      cur.rateCentsSum += rate * mins;
      cur.rateMinutes += mins;
      buckets.set(s.team_member_id, cur);
    }
    return Array.from(buckets.values()).map((b) => {
      const hours = b.minutes / 60;
      const regular = Math.min(hours, 40);
      const overtime = Math.max(0, hours - 40);
      const rate = b.rateMinutes ? b.rateCentsSum / b.rateMinutes / 100 : 0;
      const cost = regular * rate + overtime * rate * 1.5;
      return { user_id: b.user_id, staff_name: b.staff_name, regular_hours: regular, overtime_hours: overtime, cost };
    });
  }, [shifts, members, links]);

  const push = async () => {
    setPushing(true);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/qbo-sync?action=payroll_export`;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ period_start: periodStart, period_end: periodEnd, lines }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Push failed');
      toast.success(data.message || 'Pushed to QuickBooks');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Push failed');
    } finally { setPushing(false); }
  };

  const totalHours = lines.reduce((a, l) => a + l.regular_hours + l.overtime_hours, 0);
  const totalCost = lines.reduce((a, l) => a + l.cost, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 flex flex-wrap items-end gap-3">
          <div><Label className="text-xs">Period start</Label><Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
          <div><Label className="text-xs">Period end</Label><Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
          <Button variant="outline" onClick={load} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh preview'}</Button>
          <div className="ml-auto flex items-center gap-3">
            <Badge variant={qboConnected ? 'secondary' : 'outline'}>{qboConnected ? 'QuickBooks connected' : 'QuickBooks not connected'}</Badge>
            <Button onClick={push} disabled={pushing || lines.length === 0}>
              {pushing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              {qboConnected ? 'Push to QuickBooks' : 'Stage export'}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="font-display">Preview — what will post</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Staff</TableHead>
              <TableHead>Linked to user</TableHead>
              <TableHead className="text-right">Regular hrs</TableHead>
              <TableHead className="text-right">OT hrs</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {lines.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No shifts in this period.</TableCell></TableRow> :
              lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{l.staff_name}</TableCell>
                  <TableCell>{l.user_id ? <Badge variant="secondary">linked</Badge> : <Badge variant="outline">unlinked</Badge>}</TableCell>
                  <TableCell className="text-right">{l.regular_hours.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{l.overtime_hours.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${l.cost.toFixed(2)}</TableCell>
                </TableRow>
              ))}
              {lines.length > 0 && (
                <TableRow className="font-medium">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right" colSpan={2}>{totalHours.toFixed(2)} hrs</TableCell>
                  <TableCell className="text-right">${totalCost.toFixed(2)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="font-display">Recent exports</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? <p className="text-sm text-muted-foreground">No exports yet.</p> :
          (<Table>
            <TableHeader><TableRow>
              <TableHead>Period</TableHead><TableHead>Status</TableHead>
              <TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Cost</TableHead>
              <TableHead>QBO batch</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{h.period_start} → {h.period_end}</TableCell>
                  <TableCell><Badge variant={h.status === 'success' ? 'secondary' : h.status === 'failed' ? 'destructive' : 'outline'}>{h.status}</Badge></TableCell>
                  <TableCell className="text-right">{((h.totals?.regular_hours || 0) + (h.totals?.overtime_hours || 0)).toFixed(2)}</TableCell>
                  <TableCell className="text-right">${Number(h.totals?.cost || 0).toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-xs">{h.qbo_batch_id || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>)}
        </CardContent>
      </Card>
    </div>
  );
}