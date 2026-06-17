import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Download, AlertTriangle } from 'lucide-react';
import { format, differenceInMinutes, startOfWeek, endOfWeek } from 'date-fns';
import { toast } from 'sonner';

interface Shift {
  id: string;
  team_member_id: string;
  start_at: string;
  end_at?: string | null;
  breaks?: Array<{ start_at: string; end_at?: string | null; is_paid?: boolean }>;
  wage?: { hourly_rate?: { amount?: number } };
}

interface Member {
  id: string;
  given_name?: string;
  family_name?: string;
  wage?: { hourly_rate_cents?: number } | null;
}

function shiftMinutes(s: Shift) {
  if (!s.end_at) return 0;
  const total = differenceInMinutes(new Date(s.end_at), new Date(s.start_at));
  const unpaidBreak = (s.breaks || []).reduce((sum, b) => {
    if (!b.end_at || b.is_paid) return sum;
    return sum + differenceInMinutes(new Date(b.end_at), new Date(b.start_at));
  }, 0);
  return Math.max(0, total - unpaidBreak);
}

export function LaborTimecards() {
  const today = new Date();
  const [begin, setBegin] = useState(format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [end, setEnd] = useState(format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(false);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [simulated, setSimulated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const beginIso = new Date(begin + 'T00:00:00').toISOString();
      const endIso = new Date(end + 'T23:59:59').toISOString();
      const [shiftsRes, teamRes] = await Promise.all([
        supabase.functions.invoke('square-labor', { body: { action: 'list_shifts', begin: beginIso, end: endIso } }),
        supabase.functions.invoke('square-labor', { body: { action: 'list_team' } }),
      ]);
      if (shiftsRes.error) throw shiftsRes.error;
      setShifts(shiftsRes.data?.shifts || []);
      setSimulated(!!shiftsRes.data?.simulated);
      setMembers(teamRes.data?.team_members || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load shifts');
    } finally {
      setLoading(false);
    }
  }, [begin, end]);

  useEffect(() => { load(); }, [load]);

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const rows = useMemo(() => shifts.map((s) => {
    const m = memberMap.get(s.team_member_id);
    const mins = shiftMinutes(s);
    const rateCents = m?.wage?.hourly_rate_cents || 0;
    const cost = (mins / 60) * (rateCents / 100);
    return {
      id: s.id,
      name: m ? [m.given_name, m.family_name].filter(Boolean).join(' ') : s.team_member_id,
      start: s.start_at,
      end: s.end_at,
      hours: mins / 60,
      cost,
    };
  }), [shifts, memberMap]);

  const totalHours = rows.reduce((a, r) => a + r.hours, 0);
  const totalCost = rows.reduce((a, r) => a + r.cost, 0);

  const exportCsv = () => {
    const header = 'Staff,Clock In,Clock Out,Hours,Labor Cost\n';
    const body = rows.map((r) =>
      [r.name, r.start, r.end || '', r.hours.toFixed(2), r.cost.toFixed(2)].map((v) => `"${v}"`).join(',')
    ).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timecards-${begin}-to-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4 flex flex-wrap gap-3 items-end">
          <div><Label className="text-xs">From</Label><Input type="date" value={begin} onChange={(e) => setBegin(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          <Button onClick={load} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}</Button>
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4 mr-1" /> CSV</Button>
          <div className="ml-auto text-sm text-muted-foreground">
            <span className="mr-4">Total: <strong className="text-foreground">{totalHours.toFixed(2)} h</strong></span>
            <span>Labor cost: <strong className="text-foreground">${totalCost.toFixed(2)}</strong></span>
          </div>
        </CardContent>
      </Card>
      {simulated && (
        <Card className="border-accent/40 bg-accent/5">
          <CardContent className="py-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-accent mt-0.5" />
            <span>Sandbox returned no shift records. Punch in/out from the POS time clock to seed test shifts.</span>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle className="font-display">Shifts</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Staff</TableHead><TableHead>Clock In</TableHead><TableHead>Clock Out</TableHead>
              <TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Labor cost</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No shifts in range.</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{format(new Date(r.start), 'MMM d, h:mm a')}</TableCell>
                  <TableCell>{r.end ? format(new Date(r.end), 'MMM d, h:mm a') : <span className="text-primary">Open</span>}</TableCell>
                  <TableCell className="text-right">{r.hours.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${r.cost.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}