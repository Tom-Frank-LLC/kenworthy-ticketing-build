import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { CollapsibleSection } from './CollapsibleSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import { Heart, RefreshCw, Loader2, CheckCircle2, AlertCircle, PauseCircle } from 'lucide-react';
import { format } from 'date-fns';

/**
 * Admin control panel for the Little Green Light integration.
 *
 * LGL is the fundraising CRM. Every completed donation is auto-synced from
 * the square-donation edge function (constituent + gift). This tab is for:
 *   - Manually re-syncing a single donation
 *   - Backfilling everything that hasn't hit LGL yet (e.g. after a network
 *     hiccup or before the integration existed)
 *   - Seeing at a glance which donations synced and which failed
 */
export default function LglTab() {
  const { isSuperadmin } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [paused, setPaused] = useState<boolean | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);

  async function load() {
    setLoading(true);
    const [donRes, cfgRes] = await Promise.all([
      supabase.from('donations')
        .select('id, donor_name, donor_email, amount_cents, status, created_at, source, lgl_gift_id, lgl_constituent_id, lgl_synced_at, lgl_sync_error, confirmation_sent_at, confirmation_error, notify_email, notify_sent_at, notify_error')
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('app_config').select('value').eq('key', 'lgl_sync_paused').maybeSingle(),
    ]);
    setRows(donRes.data || []);
    setPaused(((cfgRes.data?.value as any)?.paused) === true);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function togglePause(next: boolean) {
    setPauseBusy(true);
    const { error } = await supabase.from('app_config')
      .upsert({ key: 'lgl_sync_paused', value: { paused: next }, updated_at: new Date().toISOString() });
    setPauseBusy(false);
    if (error) { toast.error(error.message); return; }
    setPaused(next);
    toast.success(next ? 'LGL sync paused — no gifts will post to Little Green Light.' : 'LGL sync resumed.');
  }

  async function syncOne(id: string, force = false) {
    setBusy(id);
    try {
      const { data, error } = await supabase.functions.invoke('lgl-sync-donation', { body: { donationId: id, force } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success('Synced to LGL');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Sync failed');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Re-send the donor receipt and, when the gift has one, the tribute notice.
   *
   * Both are dispatched fire-and-forget at the time of the gift, so this is how
   * an operator recovers the case the row already tells them about: a receipt
   * with a confirmation_error on it, and a donor who is still waiting for the
   * tax record the thank-you screen promised them.
   */
  async function resendEmails(id: string) {
    setBusy(id);
    try {
      const { data, error } = await supabase.functions.invoke('lgl-sync-donation', {
        body: { action: 'resend_emails', donationId: id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const errors: string[] = (data as any)?.emails?.errors || [];
      if (errors.length) toast.error(errors.join('; '));
      else toast.success('Receipt sent');
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not send the receipt');
    } finally {
      setBusy(null);
    }
  }

  async function backfill() {
    const unsynced = rows.filter(r => !r.lgl_gift_id);
    if (unsynced.length === 0) { toast.info('Everything is already synced.'); return; }
    if (!confirm(`Sync ${unsynced.length} donation(s) to Little Green Light?`)) return;
    setBackfilling(true);
    setProgress({ done: 0, total: unsynced.length });
    for (let i = 0; i < unsynced.length; i++) {
      try {
        await supabase.functions.invoke('lgl-sync-donation', { body: { donationId: unsynced[i].id } });
      } catch { /* logged server-side */ }
      setProgress({ done: i + 1, total: unsynced.length });
    }
    setBackfilling(false);
    setProgress(null);
    toast.success('Backfill complete');
    await load();
  }

  const synced = rows.filter(r => r.lgl_gift_id).length;
  const failed = rows.filter(r => !r.lgl_gift_id && r.lgl_sync_error).length;
  const pending = rows.filter(r => !r.lgl_gift_id && !r.lgl_sync_error).length;

  return (
    <div className="space-y-4">
      <CollapsibleSection id="lgl.integration" title="Little Green Light" icon={Heart} defaultOpen>
        <p className="font-serif text-sm text-muted-foreground">
          Completed donations sync automatically. Each donor becomes a constituent (matched
          by email) and each gift is posted with a note referencing the Kenworthy donation id.
          Use the backfill button below if any donations failed to sync in real time.
        </p>
        {isSuperadmin && paused !== null && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 flex items-start gap-3">
            <PauseCircle className="h-5 w-5 text-primary mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <Switch checked={paused} onCheckedChange={togglePause} disabled={pauseBusy} />
                <span className="font-medium text-sm">
                  {paused ? 'LGL sync is PAUSED' : 'LGL sync is LIVE'}
                </span>
              </div>
              <p className="text-xs font-serif text-muted-foreground mt-1">
                Superadmin-only, dev-stage safety toggle. While paused, no constituents or
                gifts are created in the real Little Green Light account — safe for demos and
                test donations. Remove this control once Kenworthy is fully live on the
                platform.
              </p>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="default">{synced} synced</Badge>
          <Badge variant="outline">{pending} pending</Badge>
          {failed > 0 && <Badge variant="destructive">{failed} failed</Badge>}
          {paused && <Badge variant="destructive">Sync paused</Badge>}
        </div>
        <Button onClick={backfill} disabled={backfilling || pending + failed === 0}>
          {backfilling
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Syncing {progress?.done}/{progress?.total}…</>
            : <><RefreshCw className="h-4 w-4 mr-2" /> Sync all unsynced ({pending + failed})</>}
        </Button>
      </CollapsibleSection>

      <CollapsibleSection id="lgl.donations" title="Completed donations" count={rows.length} defaultOpen>
        <div className="grid gap-2">
          {loading ? (
            <p className="text-center py-8 text-muted-foreground font-serif">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground font-serif">No completed donations yet.</p>
          ) : rows.map(r => (
            <Card key={r.id} className="glass">
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">
                    {r.donor_name} <span className="text-muted-foreground font-normal">${(r.amount_cents / 100).toFixed(2)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground font-serif truncate">
                    {r.donor_email} • {format(new Date(r.created_at), 'MMM d, yyyy')}
                  </p>
                  {r.lgl_sync_error && !r.lgl_gift_id && (
                    <p className="text-xs text-destructive font-serif truncate mt-0.5">
                      <AlertCircle className="h-3 w-3 inline mr-1" />{r.lgl_sync_error}
                    </p>
                  )}
                  {r.lgl_synced_at && (
                    <p className="text-xs text-muted-foreground font-serif mt-0.5">
                      <CheckCircle2 className="h-3 w-3 inline mr-1 text-primary" />
                      Synced {format(new Date(r.lgl_synced_at), 'MMM d')} • gift #{r.lgl_gift_id}
                    </p>
                  )}
                  {/* Whether the donor was actually thanked. The receipt is sent
                      fire-and-forget, so this line is the only place a failed
                      send is visible to a human. */}
                  <p className="text-xs font-serif mt-0.5">
                    {r.confirmation_sent_at ? (
                      <span className="text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 inline mr-1 text-primary" />
                        Receipt sent {format(new Date(r.confirmation_sent_at), 'MMM d')}
                        {r.notify_email && (r.notify_sent_at ? ' • tribute notice sent' : ' • tribute notice NOT sent')}
                      </span>
                    ) : r.confirmation_error ? (
                      <span className="text-destructive">
                        <AlertCircle className="h-3 w-3 inline mr-1" />Receipt failed: {r.confirmation_error}
                      </span>
                    ) : r.donor_email ? (
                      <span className="text-muted-foreground">No receipt sent yet</span>
                    ) : (
                      <span className="text-muted-foreground">No email on file — no receipt to send</span>
                    )}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <Button
                    size="sm"
                    variant={r.lgl_gift_id ? 'outline' : 'default'}
                    disabled={busy === r.id}
                    onClick={() => syncOne(r.id, !!r.lgl_gift_id)}
                  >
                    {busy === r.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : r.lgl_gift_id ? 'Re-sync' : 'Sync now'}
                  </Button>
                  {r.donor_email && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === r.id}
                      onClick={() => resendEmails(r.id)}
                    >
                      {r.confirmation_sent_at ? 'Resend receipt' : 'Send receipt'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  );
}