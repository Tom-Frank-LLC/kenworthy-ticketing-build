import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Download, Loader2, FileText } from 'lucide-react';

type Aggregated = { account_id: string | null; code: string; qbo_account_name: string; account_type: string; amount: number; count: number; };

function csvEscape(v: any) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function download(name: string, content: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function QboExportTab() {
  const [from, setFrom] = useState(() => new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Aggregated[] | null>(null);

  async function aggregate(): Promise<Aggregated[]> {
    const fromIso = new Date(from).toISOString();
    const toIso = new Date(new Date(to).getTime() + 86400000).toISOString();

    const [accountsRes, mappingsRes, ticketsRes, concRes, donRes, passRes, ptypesRes, showingsRes] = await Promise.all([
      supabase.from('chart_of_accounts' as any).select('id,code,qbo_account_name,account_type'),
      supabase.from('account_mappings' as any).select('source_type,source_key,account_id,is_default'),
      supabase.from('tickets').select('total_price,price,tax_amount,created_at,showing_id,status').gte('created_at', fromIso).lt('created_at', toIso).eq('status', 'confirmed'),
      supabase.from('concession_sales').select('total,tax_amount,created_at').gte('created_at', fromIso).lt('created_at', toIso),
      supabase.from('donations').select('amount_cents,created_at,status').gte('created_at', fromIso).lt('created_at', toIso).eq('status', 'completed'),
      supabase.from('user_film_passes').select('pass_type_id,purchased_at').gte('purchased_at', fromIso).lt('purchased_at', toIso),
      supabase.from('film_pass_types').select('id,name,price'),
      supabase.from('showings').select('id,movie_id,event_id,live_performance_id'),
    ]);

    const accounts = (accountsRes.data || []) as any[];
    const mappings = (mappingsRes.data || []) as any[];
    const accountById = new Map(accounts.map(a => [a.id, a]));
    function resolve(source_type: string, source_key: string): string | null {
      const exact = mappings.find(m => m.source_type === source_type && m.source_key === source_key);
      if (exact) return exact.account_id;
      const def = mappings.find(m => m.source_type === source_type && m.is_default);
      return def?.account_id ?? null;
    }

    const totals = new Map<string, Aggregated>();
    function add(accountId: string | null, amount: number) {
      if (!accountId) accountId = '__UNMAPPED__';
      const a = accountById.get(accountId);
      const key = accountId;
      const row = totals.get(key) || {
        account_id: accountId === '__UNMAPPED__' ? null : accountId,
        code: a?.code || 'UNMAPPED',
        qbo_account_name: a?.qbo_account_name || 'UNMAPPED — needs review',
        account_type: a?.account_type || 'income',
        amount: 0, count: 0,
      };
      row.amount += amount;
      row.count += 1;
      totals.set(key, row);
    }

    // Tickets — classify by showing type
    const showings = new Map((showingsRes.data || []).map((s: any) => [s.id, s]));
    for (const t of ticketsRes.data || []) {
      const s: any = showings.get(t.showing_id);
      let key = 'film';
      if (s?.event_id) key = 'live_event';
      else if (s?.live_performance_id) key = 'live_event';
      const acct = resolve('ticket_type', key);
      add(acct, Number(t.price) || 0);
      const taxAcct = resolve('sales_tax', 'collected');
      if (Number(t.tax_amount)) add(taxAcct, Number(t.tax_amount));
    }
    // Concessions
    for (const c of concRes.data || []) {
      const net = Number(c.total) - Number(c.tax_amount || 0);
      add(resolve('concession_category', '_all'), net);
      if (Number(c.tax_amount)) add(resolve('sales_tax', 'collected'), Number(c.tax_amount));
    }
    // Donations
    for (const d of donRes.data || []) add(resolve('donation_designation', 'individual'), Number(d.amount_cents) / 100);
    // Passes
    const ptypes = new Map((ptypesRes.data || []).map((p: any) => [p.id, p]));
    for (const p of passRes.data || []) {
      const pt: any = ptypes.get(p.pass_type_id);
      const price = Number(pt?.price || 0);
      let key = 'film_pass';
      const nm = (pt?.name || '').toLowerCase();
      if (nm.includes('met')) key = 'met_live_pass';
      else if (nm.includes('gift')) key = 'movie_night_gift';
      else if (nm.includes('silent')) key = 'silent_film_fest';
      add(resolve('pass_type', key), price);
    }

    return Array.from(totals.values()).sort((a, b) => a.code.localeCompare(b.code));
  }

  async function runPreview() {
    setBusy(true);
    try { setPreview(await aggregate()); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function exportCsv() {
    setBusy(true);
    try {
      const rows = await aggregate();
      const header = ['Date Range', 'QBO Account', 'Account Code', 'Account Type', 'Debit', 'Credit', 'Memo', 'Txn Count'];
      const lines = [header.map(csvEscape).join(',')];
      const range = `${from} to ${to}`;
      for (const r of rows) {
        const isIncome = r.account_type.includes('income');
        const isContra = r.account_type.startsWith('contra');
        const debit = !isIncome || isContra ? r.amount.toFixed(2) : '';
        const credit = isIncome && !isContra ? r.amount.toFixed(2) : '';
        lines.push([range, r.qbo_account_name, r.code, r.account_type, debit, credit, `Kenworthy app — ${r.count} txn(s)`, r.count].map(csvEscape).join(','));
      }
      download(`kenworthy-qbo-journal-${from}-to-${to}.csv`, lines.join('\n'));
      toast.success('CSV downloaded');
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function exportIif() {
    setBusy(true);
    try {
      const rows = await aggregate();
      const lines: string[] = [];
      lines.push('!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO');
      lines.push('!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO');
      lines.push('!ENDTRNS');
      const date = to.split('-').reverse().join('/');
      const total = rows.reduce((s, r) => s + (r.account_type.includes('income') && !r.account_type.startsWith('contra') ? r.amount : -r.amount), 0);
      lines.push(['TRNS', '', 'GENERAL JOURNAL', date, 'Undeposited Funds', total.toFixed(2), `Kenworthy ${from} to ${to}`].join('\t'));
      for (const r of rows) {
        const isIncome = r.account_type.includes('income') && !r.account_type.startsWith('contra');
        const signed = isIncome ? -r.amount : r.amount;
        lines.push(['SPL', '', 'GENERAL JOURNAL', date, r.qbo_account_name, signed.toFixed(2), `${r.count} txn(s)`].join('\t'));
      }
      lines.push('ENDTRNS');
      download(`kenworthy-qbo-${from}-to-${to}.iif`, lines.join('\n'), 'application/octet-stream');
      toast.success('IIF downloaded');
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  const unmapped = preview?.find(p => !p.account_id);

  return (
    <div className="space-y-4">
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2"><FileText className="h-5 w-5" /> QuickBooks Export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Aggregates app transactions (tickets, concessions, donations, passes) by QBO account for the selected range.
            Import the CSV into QBO via a Journal Entry, or use the IIF for desktop/Online import tools.
          </p>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={runPreview} disabled={busy} variant="outline">
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Preview
            </Button>
            <Button onClick={exportCsv} disabled={busy}>
              <Download className="h-4 w-4 mr-1" /> Journal CSV
            </Button>
            <Button onClick={exportIif} disabled={busy} variant="outline">
              <Download className="h-4 w-4 mr-1" /> IIF
            </Button>
          </div>

          {unmapped && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
              <strong>{unmapped.count}</strong> transaction(s) totaling <strong>${unmapped.amount.toFixed(2)}</strong> have no account mapping.
              Set defaults in <Badge variant="outline">Mappings</Badge> before exporting.
            </div>
          )}

          {preview && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr><th className="text-left py-2 pr-2">Code</th><th className="text-left py-2 pr-2">QBO Account</th><th className="text-left py-2 pr-2">Type</th><th className="text-right py-2 pr-2">Amount</th><th className="text-right py-2">Txns</th></tr>
                </thead>
                <tbody>
                  {preview.map(r => (
                    <tr key={r.code} className="border-b border-border/40">
                      <td className="py-2 pr-2"><Badge variant="outline" className="text-xs">{r.code}</Badge></td>
                      <td className="py-2 pr-2">{r.qbo_account_name}</td>
                      <td className="py-2 pr-2 text-muted-foreground text-xs">{r.account_type}</td>
                      <td className="py-2 pr-2 text-right font-mono">${r.amount.toFixed(2)}</td>
                      <td className="py-2 text-right text-muted-foreground">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}