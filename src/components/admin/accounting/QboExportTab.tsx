import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Download, Loader2, FileText, Link2, Unlink, CheckCircle2 } from 'lucide-react';
import QboSyncStatus from './QboSyncStatus';

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
  const [qbo, setQbo] = useState<{ connected: boolean; environment: string; realm_id?: string | null; token_expires_at?: string | null; configured: boolean } | null>(null);
  const [qboBusy, setQboBusy] = useState(false);

  async function loadStatus() {
    const { data, error } = await supabase.functions.invoke('qbo-sync?action=status', { method: 'POST' });
    if (!error && data) setQbo(data as any);
  }
  useEffect(() => { loadStatus(); }, []);

  // After OAuth callback redirects us back with ?qbo=connected, toast and reload.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('qbo');
    if (flag === 'connected') {
      toast.success(`QuickBooks connected${params.get('realm') ? ` (realm ${params.get('realm')})` : ''}`);
      params.delete('qbo'); params.delete('realm');
      const search = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (search ? `?${search}` : ''));
      loadStatus();
    } else if (flag === 'error') {
      toast.error(`QuickBooks connection failed: ${params.get('message') || 'unknown error'}`);
      params.delete('qbo'); params.delete('message');
      const search = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (search ? `?${search}` : ''));
    }
  }, []);

  async function connectQbo() {
    setQboBusy(true);
    try {
      const returnTo = window.location.pathname + window.location.search;
      const { data, error } = await supabase.functions.invoke('qbo-sync?action=oauth_start', {
        method: 'POST', body: { return_to: returnTo },
      });
      if (error) throw error;
      const url = (data as any)?.authorize_url;
      if (!url) throw new Error('No authorize URL returned');
      window.location.href = url;
    } catch (e: any) {
      toast.error(e.message || 'Failed to start QuickBooks connection');
    } finally { setQboBusy(false); }
  }

  async function disconnectQbo() {
    if (!confirm('Disconnect QuickBooks? Tokens will be revoked and cleared.')) return;
    setQboBusy(true);
    try {
      const { error } = await supabase.functions.invoke('qbo-sync?action=disconnect', { method: 'POST' });
      if (error) throw error;
      toast.success('QuickBooks disconnected');
      loadStatus();
    } catch (e: any) {
      toast.error(e.message || 'Failed to disconnect');
    } finally { setQboBusy(false); }
  }

  async function aggregate(): Promise<Aggregated[]> {
    const fromIso = new Date(from).toISOString();
    const toIso = new Date(new Date(to).getTime() + 86400000).toISOString();

    const [accountsRes, mappingsRes, ticketsRes, concRes, donRes, passRes, ptypesRes, showingsRes, rilRes] = await Promise.all([
      supabase.from('chart_of_accounts' as any).select('id,code,qbo_account_name,account_type'),
      supabase.from('account_mappings' as any).select('source_type,source_key,account_id,is_default'),
      supabase.from('tickets').select('total_price,price,tax_amount,purchased_at,showing_id,status').gte('purchased_at', fromIso).lt('purchased_at', toIso).eq('status', 'confirmed'),
      supabase.from('concession_sales').select('total,tax_amount,created_at').gte('created_at', fromIso).lt('created_at', toIso),
      supabase.from('donations').select('amount_cents,created_at,status').gte('created_at', fromIso).lt('created_at', toIso).eq('status', 'completed'),
      supabase.from('user_film_passes').select('pass_type_id,purchased_at').gte('purchased_at', fromIso).lt('purchased_at', toIso),
      supabase.from('film_pass_types').select('id,name,price'),
      supabase.from('showings').select('id,movie_id,event_id,live_performance_id'),
      supabase.from('rental_invoice_lines' as any).select('line_kind,quantity,unit_price,account_id,is_taxable,created_at').gte('created_at', fromIso).lt('created_at', toIso),
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

    // Rental invoice lines — honor per-line account override, else map by line_kind
    for (const r of (rilRes.data as any[]) || []) {
      const amt = Number(r.quantity) * Number(r.unit_price);
      const acct = r.account_id || resolve('rental_line_kind', r.line_kind);
      add(acct, amt);
      if (r.is_taxable) add(resolve('sales_tax', 'collected'), amt * 0.06);
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
          <CardTitle className="font-display flex items-center gap-2">
            <Link2 className="h-5 w-5" /> QuickBooks Connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!qbo ? (
            <p className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Checking status…</p>
          ) : !qbo.configured ? (
            <p className="text-sm text-muted-foreground">QBO credentials are not configured in this environment.</p>
          ) : qbo.connected ? (
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Connected</Badge>
              <span className="text-sm text-muted-foreground">Realm <span className="font-mono">{qbo.realm_id}</span> • {qbo.environment}</span>
              {qbo.token_expires_at && (
                <span className="text-xs text-muted-foreground">Token expires {new Date(qbo.token_expires_at).toLocaleString()}</span>
              )}
              <Button variant="outline" size="sm" onClick={disconnectQbo} disabled={qboBusy} className="ml-auto">
                <Unlink className="h-4 w-4 mr-1" /> Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">Not connected</Badge>
              <span className="text-sm text-muted-foreground">Environment: {qbo.environment}</span>
              <Button onClick={connectQbo} disabled={qboBusy} className="ml-auto">
                {qboBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Link2 className="h-4 w-4 mr-1" />}
                Connect QuickBooks
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <QboSyncStatus />

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