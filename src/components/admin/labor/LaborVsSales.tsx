import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, startOfWeek, endOfWeek, subWeeks } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, ComposedChart } from 'recharts';

interface SeriesRow { day: string; hours: number; labor_cost: number; revenue: number; labor_pct: number | null; ticket_revenue: number; concession_revenue: number }

export function LaborVsSales() {
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [totals, setTotals] = useState<{ labor_cost: number; revenue: number; labor_pct: number | null; hours: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<'this_week' | 'last_week' | 'last_30'>('this_week');

  const load = useCallback(async () => {
    setLoading(true);
    let begin: Date, end: Date;
    const now = new Date();
    if (range === 'this_week') { begin = startOfWeek(now, { weekStartsOn: 1 }); end = endOfWeek(now, { weekStartsOn: 1 }); }
    else if (range === 'last_week') { const lw = subWeeks(now, 1); begin = startOfWeek(lw, { weekStartsOn: 1 }); end = endOfWeek(lw, { weekStartsOn: 1 }); }
    else { begin = new Date(now.getTime() - 30 * 86400_000); end = now; }

    const { data, error } = await supabase.functions.invoke('square-labor', {
      body: { action: 'labor_summary', begin: begin.toISOString(), end: end.toISOString() },
    });
    if (error) { toast.error(error.message); setLoading(false); return; }
    setSeries(data?.series || []);
    setTotals(data?.totals || null);
    setLoading(false);
  }, [range]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 flex flex-wrap items-center gap-2">
          {(['this_week', 'last_week', 'last_30'] as const).map((r) => (
            <Button key={r} size="sm" variant={range === r ? 'default' : 'outline'} onClick={() => setRange(r)}>
              {r === 'this_week' ? 'This week' : r === 'last_week' ? 'Last week' : 'Last 30 days'}
            </Button>
          ))}
          <div className="ml-auto flex gap-4 text-sm">
            <span>Hours: <strong>{totals?.hours.toFixed(1) ?? '—'}</strong></span>
            <span>Labor: <strong>${totals?.labor_cost.toFixed(2) ?? '—'}</strong></span>
            <span>Revenue: <strong>${totals?.revenue.toFixed(2) ?? '—'}</strong></span>
            <span>Labor %: <strong>{totals?.labor_pct != null ? `${totals.labor_pct}%` : '—'}</strong></span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="font-display">Labor cost vs sales</CardTitle></CardHeader>
        <CardContent className="h-[360px]">
          {loading ? <div className="py-10 text-center text-muted-foreground"><Loader2 className="h-4 w-4 inline animate-spin mr-2" />Loading…</div> :
          series.length === 0 ? <div className="py-10 text-center text-muted-foreground">No data in range yet.</div> :
          (<ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" tickFormatter={(d) => format(new Date(d), 'MMM d')} />
              <YAxis yAxisId="left" tickFormatter={(v) => `$${v}`} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="ticket_revenue" stackId="rev" name="Ticket revenue" fill="hsl(var(--primary))" />
              <Bar yAxisId="left" dataKey="concession_revenue" stackId="rev" name="Concessions" fill="hsl(var(--accent))" />
              <Bar yAxisId="left" dataKey="labor_cost" name="Labor cost" fill="hsl(var(--muted-foreground))" />
              <Line yAxisId="right" type="monotone" dataKey="labor_pct" name="Labor %" stroke="hsl(var(--destructive))" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>)}
        </CardContent>
      </Card>
    </div>
  );
}