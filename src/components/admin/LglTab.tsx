import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Heart, RefreshCw, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
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
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('donations')
      .select('id, donor_name, donor_email, amount_cents, status, created_at, lgl_gift_id, lgl_constituent_id, lgl_synced_at, lgl_sync_error')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(200);
    setRows(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

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
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display uppercase flex items-center gap-2">
            <Heart className="h-5 w-5 text-primary" /> Little Green Light
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="font-serif text-sm text-muted-foreground">
            Completed donations sync automatically. Each donor becomes a constituent (matched
            by email) and each gift is posted with a note referencing the Kenworthy donation id.
            Use the backfill button below if any donations failed to sync in real time.
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="default">{synced} synced</Badge>
            <Badge variant="outline">{pending} pending</Badge>
            {failed > 0 && <Badge variant="destructive">{failed} failed</Badge>}
          </div>
          <Button onClick={backfill} disabled={backfilling || pending + failed === 0}>
            {backfilling
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Syncing {progress?.done}/{progress?.total}…</>
              : <><RefreshCw className="h-4 w-4 mr-2" /> Sync all unsynced ({pending + failed})</>}
          </Button>
        </CardContent>
      </Card>

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
              </div>
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
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}