import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Check, X, Loader2 } from 'lucide-react';

interface RequestRow {
  id: string;
  request_type: 'swap' | 'time_off';
  shift_start: string | null;
  shift_end: string | null;
  status: string;
  note: string | null;
  created_at: string;
  requester_id: string;
  target_user_id: string | null;
  requester_name?: string;
  target_name?: string;
}

export function ShiftRequestsInbox() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('shift_requests')
      .select('id, request_type, shift_start, shift_end, status, note, created_at, requester_id, target_user_id')
      .order('created_at', { ascending: false });
    if (error) { toast.error(error.message); setLoading(false); return; }
    const userIds = Array.from(new Set([
      ...(data || []).map((r) => r.requester_id),
      ...(data || []).map((r) => r.target_user_id).filter(Boolean) as string[],
    ]));
    const profileMap = new Map<string, string>();
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from('profiles').select('id, display_name, email').in('id', userIds);
      for (const p of profiles || []) profileMap.set(p.id, p.display_name || p.email || p.id);
    }
    setRows((data || []).map((r) => ({
      ...r,
      request_type: r.request_type as 'swap' | 'time_off',
      requester_name: profileMap.get(r.requester_id),
      target_name: r.target_user_id ? profileMap.get(r.target_user_id) : undefined,
    })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, status: 'approved' | 'denied') => {
    const { error } = await supabase
      .from('shift_requests')
      .update({ status, resolved_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Request ${status}`);
    load();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Shift requests</CardTitle></CardHeader>
      <CardContent>
        {loading ? <div className="py-6 text-center text-muted-foreground"><Loader2 className="h-4 w-4 inline animate-spin mr-2" />Loading…</div> :
        rows.length === 0 ? <div className="py-6 text-center text-muted-foreground">No requests yet.</div> :
        (<div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 border rounded p-3">
              <Badge variant={r.request_type === 'swap' ? 'secondary' : 'outline'}>{r.request_type === 'swap' ? 'Swap' : 'Time off'}</Badge>
              <div className="text-sm">
                <div className="font-medium">{r.requester_name || r.requester_id}</div>
                {r.shift_start && <div className="text-xs text-muted-foreground">
                  {format(new Date(r.shift_start), 'EEE MMM d, h:mm a')}{r.shift_end ? ` – ${format(new Date(r.shift_end), 'h:mm a')}` : ''}
                </div>}
                {r.note && <div className="text-xs text-muted-foreground italic">"{r.note}"</div>}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Badge variant={r.status === 'pending' ? 'default' : r.status === 'approved' ? 'secondary' : 'outline'}>{r.status}</Badge>
                {r.status === 'pending' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => decide(r.id, 'approved')}><Check className="h-4 w-4" /></Button>
                    <Button size="sm" variant="outline" onClick={() => decide(r.id, 'denied')}><X className="h-4 w-4" /></Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>)}
      </CardContent>
    </Card>
  );
}