import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Activity, AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

type Kind = 'sales_receipt' | 'deposit' | 'time_activity';

interface KindStatus {
  kind: Kind;
  label: string;
  last_success_at: string | null;
  pushed_count: number;
  recent_errors: Array<{ id: string; entity: string; message: string; when: string }>;
}

const SALES_RECEIPT_TABLES = ['sales_receipt', 'tickets', 'ticket', 'concession_sales', 'concession_sale'];
const DEPOSIT_TABLES = ['deposit', 'deposits'];

export default function QboSyncStatus() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<KindStatus[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [jobsRes, payrollRes] = await Promise.all([
        (supabase.from('qbo_sync_jobs' as any) as any)
          .select('id, entry_table, entry_id, status, error_message, synced_at, created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('payroll_exports')
          .select('id, status, totals, error_message, created_at, period_start, period_end')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      const jobs = (jobsRes.data || []) as Array<any>;
      const payroll = (payrollRes.data || []) as Array<any>;

      function bucket(matches: string[], label: string, kind: Kind): KindStatus {
        const mine = jobs.filter((j) => matches.includes(j.entry_table));
        const successes = mine.filter((j) => j.status === 'success');
        const failures = mine.filter((j) => j.status === 'failed' || j.status === 'error');
        return {
          kind,
          label,
          last_success_at: successes[0]?.synced_at || successes[0]?.created_at || null,
          pushed_count: successes.length,
          recent_errors: failures.slice(0, 5).map((j) => ({
            id: j.id,
            entity: `${j.entry_table} ${String(j.entry_id).slice(0, 8)}`,
            message: j.error_message || 'Unknown error',
            when: j.created_at,
          })),
        };
      }

      const salesRow = bucket(SALES_RECEIPT_TABLES, 'Sales Receipts', 'sales_receipt');
      const depositRow = bucket(DEPOSIT_TABLES, 'Deposits', 'deposit');

      const paySuccesses = payroll.filter((p) => p.status === 'success');
      const payFailures = payroll.filter((p) => p.status === 'failed' || p.status === 'error');
      const timeRow: KindStatus = {
        kind: 'time_activity',
        label: 'TimeActivity (Payroll)',
        last_success_at: paySuccesses[0]?.created_at || null,
        pushed_count: paySuccesses.reduce((sum, p) => sum + Number(p.totals?.employees || 0), 0),
        recent_errors: payFailures.slice(0, 5).map((p) => ({
          id: p.id,
          entity: `Payroll ${p.period_start} → ${p.period_end}`,
          message: p.error_message || 'Unknown error',
          when: p.created_at,
        })),
      };

      setRows([salesRow, depositRow, timeRow]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Card className="glass">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="font-display flex items-center gap-2">
          <Activity className="h-5 w-5" /> Background QBO Sync Status
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Rolling 30-day view of records pushed to QuickBooks. Counts and errors update as the background sync runs.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {rows.map((r) => {
            const hasErrors = r.recent_errors.length > 0;
            const healthy = !!r.last_success_at && !hasErrors;
            return (
              <div key={r.kind} className="rounded-lg border border-border/60 p-3 space-y-2 bg-card/40">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{r.label}</span>
                  {healthy ? (
                    <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Healthy</Badge>
                  ) : hasErrors ? (
                    <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Errors</Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> Idle</Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Last success</p>
                    <p className="font-medium">
                      {r.last_success_at
                        ? formatDistanceToNow(new Date(r.last_success_at), { addSuffix: true })
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Pushed (30d)</p>
                    <p className="font-medium font-mono">{r.pushed_count.toLocaleString()}</p>
                  </div>
                </div>
                {hasErrors && (
                  <div className="space-y-1 pt-1 border-t border-border/40">
                    <p className="text-xs font-medium text-destructive">Recent errors</p>
                    {r.recent_errors.map((e) => (
                      <div key={e.id} className="text-xs">
                        <p className="text-muted-foreground truncate">{e.entity}</p>
                        <p className="text-destructive/80 line-clamp-2">{e.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}