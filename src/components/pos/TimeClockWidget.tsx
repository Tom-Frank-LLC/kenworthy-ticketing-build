import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { Clock, Coffee, LogIn, LogOut, Loader2, CalendarDays, Send } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, format } from 'date-fns';

interface Shift {
  id: string;
  start_at: string;
  end_at?: string | null;
  breaks?: Array<{ start_at: string; end_at?: string | null; name?: string }>;
}

export function TimeClockWidget() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shift, setShift] = useState<Shift | null>(null);
  const [linked, setLinked] = useState(true);
  const [upcoming, setUpcoming] = useState<Array<{ id: string; start_at: string; end_at: string }>>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqType, setReqType] = useState<'swap' | 'time_off'>('time_off');
  const [reqShiftId, setReqShiftId] = useState<string>('');
  const [reqNote, setReqNote] = useState('');
  const [reqStart, setReqStart] = useState('');
  const [reqEnd, setReqEnd] = useState('');

  const invoke = useCallback(async (action: string, body: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke('square-labor', {
      body: { action, ...body },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    try {
      const [cur, up] = await Promise.all([
        invoke('current_shift'),
        invoke('my_upcoming_shifts').catch(() => ({ shifts: [] })),
      ]);
      setShift(cur.shift);
      setLinked(cur.linked !== false);
      setUpcoming((up?.shifts || []).map((s: any) => ({ id: s.id, start_at: s.start_at, end_at: s.end_at })));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [invoke]);

  useEffect(() => { load(); }, [load]);

  const onAction = async (action: string) => {
    setBusy(true);
    try {
      await invoke(action, shift ? { shift_id: shift.id } : {});
      await load();
      toast.success(
        action === 'clock_in' ? 'Clocked in' :
        action === 'clock_out' ? 'Clocked out' :
        action === 'start_break' ? 'Break started' : 'Break ended'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Card><CardContent className="py-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking time clock…
      </CardContent></Card>
    );
  }

  if (!linked) {
    return (
      <Card><CardContent className="py-4 text-sm text-muted-foreground">
        Your account isn’t linked to a Square team member yet. Ask an admin to link you in the Staff tab.
      </CardContent></Card>
    );
  }

  const onBreak = shift?.breaks?.some((b) => !b.end_at);

  const submitRequest = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Not signed in'); return; }
    const matched = upcoming.find((s) => s.id === reqShiftId);
    const payload: Record<string, unknown> = {
      request_type: reqType,
      requester_id: user.id,
      note: reqNote || null,
      shift_id: reqShiftId || null,
      shift_start: matched?.start_at || (reqStart ? new Date(reqStart).toISOString() : null),
      shift_end: matched?.end_at || (reqEnd ? new Date(reqEnd).toISOString() : null),
    };
    const { error } = await supabase.from('shift_requests').insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success('Request submitted');
    setRequestOpen(false);
    setReqNote(''); setReqShiftId(''); setReqStart(''); setReqEnd('');
  };

  return (
    <div className="space-y-3">
    <Card>
      <CardContent className="py-4 flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-accent" />
          {shift ? (
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-primary">On the clock</Badge>
                {onBreak && <Badge variant="secondary">On break</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Since {new Date(shift.start_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                {' · '}
                {formatDistanceToNow(new Date(shift.start_at))}
              </p>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Off the clock</span>
          )}
        </div>
        <div className="flex gap-2">
          {!shift && (
            <Button size="sm" onClick={() => onAction('clock_in')} disabled={busy}>
              <LogIn className="h-4 w-4 mr-1" /> Clock In
            </Button>
          )}
          {shift && !onBreak && (
            <Button size="sm" variant="outline" onClick={() => onAction('start_break')} disabled={busy}>
              <Coffee className="h-4 w-4 mr-1" /> Start Break
            </Button>
          )}
          {shift && onBreak && (
            <Button size="sm" variant="outline" onClick={() => onAction('end_break')} disabled={busy}>
              <Coffee className="h-4 w-4 mr-1" /> End Break
            </Button>
          )}
          {shift && (
            <Button size="sm" variant="destructive" onClick={() => onAction('clock_out')} disabled={busy}>
              <LogOut className="h-4 w-4 mr-1" /> Clock Out
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setRequestOpen(true)}>
            <Send className="h-4 w-4 mr-1" /> Request
          </Button>
        </div>
      </CardContent>
    </Card>

    {upcoming.length > 0 && (
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-2 mb-2 text-sm font-medium">
            <CalendarDays className="h-4 w-4 text-accent" /> Upcoming shifts
          </div>
          <ul className="space-y-1 text-sm">
            {upcoming.slice(0, 5).map((s) => (
              <li key={s.id} className="flex justify-between border-b py-1 last:border-b-0">
                <span>{format(new Date(s.start_at), 'EEE MMM d')}</span>
                <span className="text-muted-foreground">{format(new Date(s.start_at), 'h:mm a')} – {format(new Date(s.end_at), 'h:mm a')}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    )}

    <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Request swap or time off</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Type</Label>
            <Select value={reqType} onValueChange={(v) => setReqType(v as 'swap' | 'time_off')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="time_off">Time off</SelectItem>
                <SelectItem value="swap">Swap a shift</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {upcoming.length > 0 && (
            <div>
              <Label>Which shift? (optional)</Label>
              <Select value={reqShiftId} onValueChange={setReqShiftId}>
                <SelectTrigger><SelectValue placeholder="Pick one" /></SelectTrigger>
                <SelectContent>
                  {upcoming.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {format(new Date(s.start_at), 'EEE MMM d, h:mm a')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {!reqShiftId && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start</Label><Input type="datetime-local" value={reqStart} onChange={(e) => setReqStart(e.target.value)} /></div>
              <div><Label>End</Label><Input type="datetime-local" value={reqEnd} onChange={(e) => setReqEnd(e.target.value)} /></div>
            </div>
          )}
          <div>
            <Label>Note for the manager</Label>
            <Textarea value={reqNote} onChange={(e) => setReqNote(e.target.value)} placeholder="Doctor appointment, family event, etc." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setRequestOpen(false)}>Cancel</Button>
          <Button onClick={submitRequest}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}