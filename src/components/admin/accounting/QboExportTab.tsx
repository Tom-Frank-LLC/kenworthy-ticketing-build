import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollapsibleSection } from '../CollapsibleSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Download, Loader2, FileText, Link2, Unlink, CheckCircle2 } from 'lucide-react';
import QboSyncStatus from './QboSyncStatus';
import { type Journal, journalCsv, journalIif, previousMonth, toDollars } from '@/lib/qboJournal';

type Account = { id: string; code: string; qbo_account_name: string; account_type: string };
function download(name: string, content: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function QboExportTab() {
  // A month's summary is the common case, so the range opens on last month.
  const [from, setFrom] = useState(() => previousMonth(new Date()).start);
  const [to, setTo] = useState(() => previousMonth(new Date()).end);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Journal | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [qbo, setQbo] = useState<{ connected: boolean; environment: string; realm_id?: string | null; token_expires_at?: string | null; configured: boolean; redirect_uri?: string | null } | null>(null);
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


  // The journal comes from Square's reports, through the same function and gate
  // as the Overview — not from this build's tables, most of which never see the
  // theatre's money. See supabase/functions/_shared/square-journal.ts.
  async function fetchJournal(): Promise<Journal> {
    if (!from || !to || from > to) throw new Error('Choose a start date on or before the end date.');
    const { data, error } = await supabase.functions.invoke('square-analytics', {
      body: { mode: 'journal', range: 'custom', start: from, end: to },
    });
    const msg = (data as { error?: string } | null)?.error;
    if (error || msg) throw new Error(msg || error?.message || 'Could not read Square.');
    const j = data as Journal;
    // Never hand the accountant a file built on a partial read.
    if (j.truncated) throw new Error('Square returned more Uncategorized items than one read covers. Choose a shorter range.');
    return j;
  }

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('chart_of_accounts' as any)
        .select('id,code,qbo_account_name,account_type')
        .eq('is_active', true)
        .order('sort_order');
      if (error) toast.error(error.message);
      setAccounts((data as any) || []);
    })();
  }, []);

  async function runPreview() {
    setBusy(true);
    try { setPreview(await fetchJournal()); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function exportFile(kind: 'csv' | 'iif') {
    setBusy(true);
    try {
      const j = await fetchJournal();
      setPreview(j);
      if (kind === 'csv') download(`kenworthy-qbo-journal-${from}-to-${to}.csv`, journalCsv(j));
      else download(`kenworthy-qbo-${from}-to-${to}.iif`, journalIif(j), 'application/octet-stream');
      toast.success(j.unmapped || j.totals.unreconciledCents
        ? `${kind.toUpperCase()} downloaded — it has lines to review before posting`
        : `${kind.toUpperCase()} downloaded`);
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  /**
   * Map one Square category (or one Uncategorized item) to an account, then
   * re-read the journal so the preview shows the effect. An item maps by
   * name, so "Theater Rental" can go to rentals while the rest of
   * Uncategorized goes elsewhere.
   */
  async function mapSource(kind: 'category' | 'item', key: string, accountId: string) {
    const source_type = kind === 'item' ? 'square_item' : 'square_category';
    const source_key = key === 'Uncategorized (not itemised)' ? 'Uncategorized' : key;
    setSavingKey(`${kind}:${key}`);
    try {
      const { data, error } = await supabase
        .from('account_mappings' as any)
        .upsert({ source_type, source_key, account_id: accountId, is_default: false }, { onConflict: 'source_type,source_key' })
        .select('id');
      if (error) throw error;
      // A blocked write returns no error and no row.
      if (!data || (data as unknown[]).length !== 1) throw new Error('The mapping was not saved.');
      setPreview(await fetchJournal());
    } catch (e: any) { toast.error(e.message || 'The mapping was not saved.'); }
    finally { setSavingKey(null); }
  }

  const unmappedSources = preview?.sources.filter(s => !s.accountId) ?? [];
  const unmappedCents = unmappedSources.reduce((n, s) => n + s.grossCents - s.discountCents, 0);
  const totalDebit = preview?.lines.reduce((n, l) => n + l.debitCents, 0) ?? 0;
  const totalCredit = preview?.lines.reduce((n, l) => n + l.creditCents, 0) ?? 0;

  return (
    <div className="space-y-4">
      <CollapsibleSection id="accounting.qbo.connection" title="QuickBooks Connection" icon={Link2}>
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
            <Button
              variant="outline"
              size="sm"
              onClick={disconnectQbo}
              disabled
              title="Disabled while the QuickBooks API side is unfinished."
              className="ml-auto"
            >
              <Unlink className="h-4 w-4 mr-1" /> Disconnect
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">Not connected</Badge>
              <span className="text-sm text-muted-foreground">Environment: {qbo.environment}</span>
              {/* Left visible but inert on purpose. The OAuth half of qbo-sync
                  works, but nothing is ever sent to or read from the
                  QuickBooks API, and the function is deployed nowhere.
                  Connecting would only enable a payroll path that reports a
                  push it never makes. Export the CSV/IIF below instead. See
                  docs/briefs/FINDINGS-quickbooks-integration-state.md */}
              <Button
                onClick={connectQbo}
                disabled
                title="Connecting is not available yet — export the CSV or IIF below and import it into QuickBooks by hand."
                className="ml-auto"
              >
                {qboBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Link2 className="h-4 w-4 mr-1" />}
                Connect QuickBooks
              </Button>
            </div>
            {qbo.redirect_uri && (
              <div className="rounded-md border border-border/50 bg-muted/30 p-3 text-xs">
                <p className="font-medium mb-1">Redirect URI registered in Intuit must match exactly:</p>
                <code className="block break-all font-mono text-muted-foreground">{qbo.redirect_uri}</code>
              </div>
            )}
          </div>
        )}
      </CollapsibleSection>

      <QboSyncStatus />

      <CollapsibleSection id="accounting.qbo.export" title="QuickBooks Export" icon={FileText} defaultOpen>
        <p className="text-sm text-muted-foreground">
          One journal entry for the range, read from Square's own reports — the same source as the Overview — so it
          covers the stand, Square Online, invoices and the till as well as this website. Income is booked by Square
          category, net of discounts; tax, tips and returns get their own lines; the money side goes to Undeposited Funds.
          Dates are Moscow calendar days.
        </p>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div><Label>From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><Label>To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runPreview} disabled={busy} variant="outline">
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Preview
          </Button>
          <Button onClick={() => exportFile('csv')} disabled={busy}>
            <Download className="h-4 w-4 mr-1" /> Journal CSV
          </Button>
          <Button onClick={() => exportFile('iif')} disabled={busy} variant="outline">
            <Download className="h-4 w-4 mr-1" /> IIF
          </Button>
        </div>

        {preview && unmappedSources.length > 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <strong>{unmappedSources.length}</strong> Square {unmappedSources.length === 1 ? 'category or item has' : 'categories or items have'} no
            account yet, totaling <strong>${toDollars(unmappedCents)}</strong>. They export as UNMAPPED lines. Pick an
            account for each below; the choice is saved and used for every later export.
          </div>
        )}

        {preview && preview.totals.unreconciledCents !== 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            Square's total collected (${toDollars(preview.totals.collectedCents)}) differs from its item sales less
            discounts and returns, plus tax and tips, by <strong>${toDollars(Math.abs(preview.totals.unreconciledCents))}</strong>.
            The file carries that as an "Unreconciled — review before posting" line rather than hiding it. Gift card
            sales and service charges are the usual causes.
          </div>
        )}

        {preview && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="text-left text-xs uppercase text-muted-foreground pb-2">Journal entry</caption>
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 pr-2">Code</th>
                    <th className="text-left py-2 pr-2">QBO Account</th>
                    <th className="text-right py-2 pr-2">Debit</th>
                    <th className="text-right py-2">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((l, i) => (
                    <tr key={`${l.code}-${l.name}-${i}`} className="border-b border-border/40">
                      <td className="py-2 pr-2">{l.code && <Badge variant="outline" className="text-xs">{l.code}</Badge>}</td>
                      <td className="py-2 pr-2">{l.name}</td>
                      <td className="py-2 pr-2 text-right font-mono">{l.debitCents ? `$${toDollars(l.debitCents)}` : ''}</td>
                      <td className="py-2 text-right font-mono">{l.creditCents ? `$${toDollars(l.creditCents)}` : ''}</td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td className="py-2 pr-2" />
                    <td className="py-2 pr-2">Total</td>
                    <td className="py-2 pr-2 text-right font-mono">${toDollars(totalDebit)}</td>
                    <td className="py-2 text-right font-mono">${toDollars(totalCredit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="text-left text-xs uppercase text-muted-foreground pb-2">
                  Square categories and Uncategorized items · {preview.totals.orders} orders
                </caption>
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 pr-2">Square</th>
                    <th className="text-right py-2 pr-2">Gross</th>
                    <th className="text-right py-2 pr-2">Discounts</th>
                    <th className="text-right py-2 pr-2">Returns</th>
                    <th className="text-left py-2">Account</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sources.map(s => {
                    const k = `${s.kind}:${s.key}`;
                    return (
                      <tr key={k} className="border-b border-border/40">
                        <td className="py-2 pr-2">
                          {s.kind === 'item' && <span className="text-muted-foreground">Uncategorized · </span>}
                          {s.key}
                        </td>
                        <td className="py-2 pr-2 text-right font-mono">${toDollars(s.grossCents)}</td>
                        <td className="py-2 pr-2 text-right font-mono">{s.discountCents ? `$${toDollars(s.discountCents)}` : ''}</td>
                        <td className="py-2 pr-2 text-right font-mono">{s.returnsCents ? `$${toDollars(s.returnsCents)}` : ''}</td>
                        <td className="py-2 min-w-56">
                          <select
                            aria-label={`Account for ${s.key}`}
                            value={s.kind === 'item' && s.mappedBy !== 'square_item' ? '' : (s.accountId ?? '')}
                            disabled={savingKey !== null}
                            onChange={e => e.target.value && void mapSource(s.kind, s.key, e.target.value)}
                            className={`w-full h-9 rounded border bg-background px-2 text-sm ${s.accountId ? '' : 'border-destructive'}`}
                          >
                            <option value="">
                              {s.kind === 'item' && s.accountId
                                ? `As Uncategorized: ${accounts.find(a => a.id === s.accountId)?.qbo_account_name ?? '…'}`
                                : 'UNMAPPED — choose an account'}
                            </option>
                            {accounts.map(a => (
                              <option key={a.id} value={a.id}>{a.code} — {a.qbo_account_name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CollapsibleSection>
    </div>
  );
}
