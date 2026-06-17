import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Clock, Coffee, LogIn, LogOut, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

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
      const data = await invoke('current_shift');
      setShift(data.shift);
      setLinked(data.linked !== false);
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
        Your account isn’t linked to a Square team member yet. Ask an admin to link you in the Labor tab.
      </CardContent></Card>
    );
  }

  const onBreak = shift?.breaks?.some((b) => !b.end_at);

  return (
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
        </div>
      </CardContent>
    </Card>
  );
}