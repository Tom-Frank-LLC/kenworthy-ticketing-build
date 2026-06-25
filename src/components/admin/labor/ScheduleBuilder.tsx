import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { addDays, addWeeks, endOfWeek, format, parseISO, startOfWeek, subWeeks } from 'date-fns';
import { ChevronLeft, ChevronRight, Loader2, Plus, Send, Trash2 } from 'lucide-react';

interface Member { id: string; given_name?: string; family_name?: string }
interface ScheduledShift {
  id: string;
  team_member_id: string;
  start_at: string;
  end_at: string;
  notes?: string | null;
  draft?: boolean;
}

const fullName = (m?: Member) => m ? [m.given_name, m.family_name].filter(Boolean).join(' ') || m.id : 'Unknown';

export function ScheduleBuilder() {
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [members, setMembers] = useState<Member[]>([]);
  const [shifts, setShifts] = useState<ScheduledShift[]>([]);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<ScheduledShift> | null>(null);

  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [team, scheduled] = await Promise.all([
        supabase.functions.invoke('square-labor', { body: { action: 'list_team' } }),
        supabase.functions.invoke('square-labor', {
          body: {
            action: 'list_scheduled_shifts',
            begin: weekStart.toISOString(),
            end: weekEnd.toISOString(),
          },
        }),
      ]);
      setMembers(team.data?.team_members || []);
      setShifts(scheduled.data?.scheduled_shifts || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => { load(); }, [load]);

  const saveShift = async () => {
    if (!editing?.team_member_id || !editing?.start_at || !editing?.end_at) {
      toast.error('Pick a staff member and start/end time.');
      return;
    }
    const { error } = await supabase.functions.invoke('square-labor', {
      body: {
        action: 'upsert_scheduled_shift',
        id: editing.id,
        team_member_id: editing.team_member_id,
        start_at: editing.start_at,
        end_at: editing.end_at,
        notes: editing.notes,
        draft: true,
      },
    });
    if (error) { toast.error(error.message); return; }
    toast.success(editing.id ? 'Shift updated' : 'Draft shift added');
    setDialogOpen(false);
    setEditing(null);
    load();
  };

  const removeShift = async (id: string) => {
    if (!confirm('Remove this shift?')) return;
    const { error } = await supabase.functions.invoke('square-labor', {
      body: { action: 'delete_scheduled_shift', id },
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Shift removed');
    load();
  };

  const publishWeek = async () => {
    setPublishing(true);
    try {
      const { data, error } = await supabase.functions.invoke('square-labor', {
        body: {
          action: 'publish_week',
          begin: weekStart.toISOString(),
          end: weekEnd.toISOString(),
        },
      });
      if (error) throw error;
      toast.success(`Published ${data?.published ?? 0} shifts`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const openNew = (memberId: string, day: Date) => {
    const start = new Date(day); start.setHours(17, 0, 0, 0);
    const end = new Date(day); end.setHours(22, 0, 0, 0);
    setEditing({ team_member_id: memberId, start_at: start.toISOString(), end_at: end.toISOString() });
    setDialogOpen(true);
  };

  const shiftsByCell = useMemo(() => {
    const m = new Map<string, ScheduledShift[]>();
    for (const s of shifts) {
      const key = `${s.team_member_id}|${s.start_at.slice(0, 10)}`;
      const arr = m.get(key) || []; arr.push(s); m.set(key, arr);
    }
    return m;
  }, [shifts]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekStart(subWeeks(weekStart, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="font-medium">{format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}</div>
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addWeeks(weekStart, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>This week</Button>
          <div className="ml-auto flex gap-2">
            <Button onClick={publishWeek} disabled={publishing}>
              {publishing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              Publish week
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="font-display">Week schedule</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <div className="py-8 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…</div>
          ) : members.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No team members found in Square sandbox yet.</div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left p-2 border-b w-40">Staff</th>
                  {days.map((d) => (
                    <th key={d.toISOString()} className="text-left p-2 border-b min-w-[140px]">
                      <div className="font-medium">{format(d, 'EEE')}</div>
                      <div className="text-xs text-muted-foreground">{format(d, 'MMM d')}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b">
                    <td className="p-2 font-medium">{fullName(m)}</td>
                    {days.map((d) => {
                      const key = `${m.id}|${format(d, 'yyyy-MM-dd')}`;
                      const cellShifts = shiftsByCell.get(key) || [];
                      return (
                        <td key={d.toISOString()} className="p-2 align-top">
                          <div className="space-y-1">
                            {cellShifts.map((s) => (
                              <div key={s.id} className="rounded border bg-muted/40 px-2 py-1 text-xs flex items-center gap-1">
                                <span className="flex-1">
                                  {format(parseISO(s.start_at), 'h:mm a')}–{format(parseISO(s.end_at), 'h:mm a')}
                                </span>
                                {s.draft && <Badge variant="outline" className="text-[10px]">draft</Badge>}
                                <button className="text-muted-foreground hover:text-destructive" onClick={() => removeShift(s.id)}>
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                            <Button variant="ghost" size="sm" className="h-6 text-xs w-full" onClick={() => openNew(m.id, d)}>
                              <Plus className="h-3 w-3 mr-1" /> Add
                            </Button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit shift' : 'New shift'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Staff</Label>
              <Select value={editing?.team_member_id} onValueChange={(v) => setEditing({ ...(editing || {}), team_member_id: v })}>
                <SelectTrigger><SelectValue placeholder="Pick staff" /></SelectTrigger>
                <SelectContent>
                  {members.map((m) => <SelectItem key={m.id} value={m.id}>{fullName(m)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start</Label>
                <Input type="datetime-local"
                  value={editing?.start_at ? format(parseISO(editing.start_at), "yyyy-MM-dd'T'HH:mm") : ''}
                  onChange={(e) => setEditing({ ...(editing || {}), start_at: new Date(e.target.value).toISOString() })} />
              </div>
              <div>
                <Label>End</Label>
                <Input type="datetime-local"
                  value={editing?.end_at ? format(parseISO(editing.end_at), "yyyy-MM-dd'T'HH:mm") : ''}
                  onChange={(e) => setEditing({ ...(editing || {}), end_at: new Date(e.target.value).toISOString() })} />
              </div>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={editing?.notes || ''} onChange={(e) => setEditing({ ...(editing || {}), notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveShift}>Save draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}