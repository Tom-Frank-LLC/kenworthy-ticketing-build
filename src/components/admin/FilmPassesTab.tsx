import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  Plus, Trash2, CreditCard, DollarSign, Printer, Loader2, Ban, QrCode,
  Package, Mail, Store, ScanLine,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { invokeFunction } from '@/lib/functions';
import { StickerSheet, type StickerPassType } from './StickerSheet';
import { formatShowtime } from '@/lib/datetime';
import {
  formatMailingAddress,
  passOrderBuyerLabel,
  type QueuedPassOrder,
  type AwaitingPostOrder,
} from '@/lib/passOrders';
import { MailQueueCard } from './MailQueueCard';

interface FilmPassType {
  id: string;
  name: string;
  price: number;
  initial_balance: number;
  redemption_price: number;
  expiration_days: number | null;
  is_active: boolean;
}

interface UserPass {
  id: string;
  qr_code: string | null;
  status: string;
  remaining_balance: number | null;
  payment_method: string;
  purchased_at: string;
  activated_at: string | null;
  expires_at: string | null;
  user_id: string | null;
  profile: { display_name: string | null } | null;
  pass_type: { name: string } | null;
}

interface BatchSummary {
  batch_id: string;
  pass_type_name: string;
  created_at: string;
  total: number;
  unassigned: number;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  unassigned: 'outline',
  depleted: 'secondary',
  expired: 'destructive',
  void: 'destructive',
};

const STATUS_LABEL: Record<string, string> = {
  unassigned: 'Blank',
  active: 'Active',
  depleted: 'Used up',
  expired: 'Expired',
  void: 'Cancelled',
  pending: 'Awaiting payment',
  failed: 'Payment failed',
  refunded: 'Refunded',
};

export default function FilmPassesTab() {
  const [passTypes, setPassTypes] = useState<FilmPassType[]>([]);
  const [userPasses, setUserPasses] = useState<UserPass[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', price: '60', initial_balance: '60', redemption_price: '6', expiration_days: '',
  });

  // Outstanding orders — paid online, physical pass not yet handed over
  const [queue, setQueue] = useState<QueuedPassOrder[]>([]);
  const [awaitingPost, setAwaitingPost] = useState<AwaitingPostOrder[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Printing
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchTypeId, setBatchTypeId] = useState('');
  const [batchQuantity, setBatchQuantity] = useState('30');
  const [minting, setMinting] = useState(false);
  const [sheet, setSheet] = useState<
    { codes: string[]; passType: StickerPassType; batchId: string } | null
  >(null);

  const loadData = useCallback(async () => {
    const [typesRes, passesRes] = await Promise.all([
      supabase.from('film_pass_types').select('*').order('created_at', { ascending: false }),
      supabase
        .from('user_film_passes')
        .select(
          '*, profiles!user_film_passes_user_id_fkey(display_name), film_pass_types!user_film_passes_pass_type_id_fkey(name)',
        )
        // Blanks are inventory, not passes: a batch of 300 would bury every real
        // pass in this list. They are counted under Print Runs instead.
        .neq('status', 'unassigned')
        .order('purchased_at', { ascending: false })
        .limit(50),
    ]);
    const types = (typesRes.data || []) as FilmPassType[];
    setPassTypes(types);
    if (types.length > 0 && !batchTypeId) setBatchTypeId(types[0].id);
    setUserPasses(
      (passesRes.data || []).map((p: any) => ({
        ...p,
        profile: p.profiles,
        pass_type: p.film_pass_types,
      })),
    );
  }, [batchTypeId]);

  const loadBatches = useCallback(async () => {
    try {
      const data = await invokeFunction<{ batches: BatchSummary[] }>('film-pass-batch', {
        action: 'batches',
      });
      setBatches(data.batches || []);
    } catch {
      // Not fatal: print runs are a convenience list, and failing to load them
      // must not take the pass-type editor down with it.
    }
  }, []);

  /**
   * The same `queue` action the box office reads, shown here as oversight.
   *
   * Unlike the print-run list above, a failure here is surfaced rather than
   * swallowed: this section exists to answer "is anything outstanding?", and
   * an empty list that is really a failed fetch answers it wrongly, which is
   * the exact failure this section is meant to catch.
   */
  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const data = await invokeFunction<{
        orders: QueuedPassOrder[];
        awaiting_post: AwaitingPostOrder[];
      }>('film-pass-checkout', { action: 'queue' });
      setQueue(data.orders || []);
      setAwaitingPost(data.awaiting_post || []);
      setQueueError(null);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : 'Could not load outstanding orders');
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  const markPosted = useCallback(async (orderId: string) => {
    let data: { result: string; notice?: string };
    try {
      data = await invokeFunction<{ result: string; notice?: string }>('film-pass-checkout', {
        action: 'mark_posted',
        order_id: orderId,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not mark that order posted');
      return; // Leave the row where it is — nothing was recorded.
    }

    if (data.result === 'already_posted') {
      toast.info('Somebody already marked that one posted.');
    } else if (data.notice === 'failed') {
      // The order is posted either way — only the email fell over. Say so, or
      // staff will re-click looking for the confirmation that never sent.
      toast.warning('Marked posted, but the email to the buyer did not send.');
    } else if (data.notice === 'no_email') {
      toast.success('Marked posted. No email on file for this buyer.');
    } else {
      toast.success('Marked posted — the buyer has been emailed.');
    }
    await loadQueue();
  }, [loadQueue]);

  useEffect(() => { loadData(); loadBatches(); loadQueue(); }, [loadData, loadBatches, loadQueue]);

  async function handleCreateType() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    const { error } = await supabase.from('film_pass_types').insert({
      name: form.name.trim(),
      price: parseFloat(form.price) || 60,
      initial_balance: parseFloat(form.initial_balance) || 60,
      redemption_price: parseFloat(form.redemption_price) || 6,
      expiration_days: form.expiration_days ? parseInt(form.expiration_days) : null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('Pass type created');
    setForm({ name: '', price: '60', initial_balance: '60', redemption_price: '6', expiration_days: '' });
    setShowForm(false);
    loadData();
  }

  async function toggleActive(id: string, isActive: boolean) {
    const { error } = await supabase.from('film_pass_types').update({ is_active: !isActive }).eq('id', id);
    if (error) toast.error(error.message);
    else loadData();
  }

  async function deleteType(id: string) {
    if (!confirm('Delete this pass type?')) return;
    const { error } = await supabase.from('film_pass_types').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Deleted'); loadData(); }
  }

  async function handleMint() {
    const quantity = parseInt(batchQuantity, 10);
    if (!batchTypeId) { toast.error('Choose a pass type'); return; }
    if (!Number.isFinite(quantity) || quantity < 1) { toast.error('How many stickers?'); return; }

    setMinting(true);
    try {
      const data = await invokeFunction<{
        batch_id: string;
        quantity: number;
        pass_type: StickerPassType;
        passes: { qr_code: string }[];
      }>('film-pass-batch', {
        action: 'create',
        pass_type_id: batchTypeId,
        quantity,
      });

      setSheet({
        codes: data.passes.map(p => p.qr_code),
        passType: data.pass_type,
        batchId: data.batch_id,
      });
      toast.success(`${data.quantity} blank stickers ready to print`);
      loadBatches();
    } catch (err: any) {
      toast.error(err.message || 'Could not create the batch');
    } finally {
      setMinting(false);
    }
  }

  async function reprintBatch(batchId: string) {
    try {
      const data = await invokeFunction<{
        batch_id: string;
        pass_type: StickerPassType | null;
        passes: { qr_code: string; status: string }[];
      }>('film-pass-batch', { action: 'list', batch_id: batchId });

      if (!data.pass_type) { toast.error('That batch has no pass type'); return; }
      // Reprinting only the blanks, never the activated ones. A second sticker
      // carrying a code already stuck to somebody's pass is a duplicate pass.
      const blanks = data.passes.filter(p => p.status === 'unassigned').map(p => p.qr_code);
      if (blanks.length === 0) {
        toast.info('Every sticker in that batch has already been activated.');
        return;
      }
      setSheet({ codes: blanks, passType: data.pass_type, batchId: data.batch_id });
    } catch (err: any) {
      toast.error(err.message || 'Could not load that batch');
    }
  }

  async function voidPass(pass: UserPass) {
    const label = pass.profile?.display_name || pass.qr_code || 'this pass';
    if (!confirm(
      `Cancel ${label}?\n\nThe pass stops working immediately. Any balance on it is lost — refund from the till separately if that is the agreement.`,
    )) return;

    try {
      await invokeFunction('film-pass-checkout', { action: 'void', pass_id: pass.id });
      toast.success('Pass cancelled');
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Could not cancel that pass');
    }
  }

  return (
    <div className="space-y-6">
      {/* Rendered alongside the tab rather than instead of it: StickerSheet
          portals itself to <body>, which is what its print rule requires, and
          returning it in place here would put it back inside #root — the bug
          that printed a blank page. */}
      {sheet && (
        <StickerSheet
          codes={sheet.codes}
          passType={sheet.passType}
          batchId={sheet.batchId}
          onDone={() => setSheet(null)}
        />
      )}

      {/* ---- Waiting to be handed over ----
          A mirror of the box office queue (FilmPassPOS), read-only. Activation
          needs a blank sticker under a scanner, which is a counter job — but a
          paid order that nobody has posted or handed over is an open
          obligation, and the admin dashboard is where someone thinks to look
          for it. Both views read the same `queue` action, so they cannot
          disagree about what is outstanding. */}
      <Card className="glass">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-display text-xl font-bold flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" /> Waiting to be handed over
              {queue.length > 0 && <Badge variant="default">{queue.length}</Badge>}
            </h2>
            {queue.length > 0 && (
              <Button size="sm" variant="outline" asChild className="w-full sm:w-auto">
                <Link to="/admin/pos">
                  <ScanLine className="h-4 w-4 mr-1" /> Activate at the counter
                </Link>
              </Button>
            )}
          </div>

          {loadingQueue ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : queueError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                Could not load outstanding orders — {queueError}
              </p>
              <p className="text-xs text-muted-foreground">
                This is not the same as "nothing outstanding". Retry, and check the box
                office queue before assuming there is nothing to post.
              </p>
              <Button size="sm" variant="outline" onClick={loadQueue}>Retry</Button>
            </div>
          ) : queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing outstanding — every paid pass has been handed over or posted.
            </p>
          ) : (
            <div className="space-y-3">
              {queue.map(o => {
                const address = formatMailingAddress(o.mailing_address);
                return (
                  <div key={o.id} className="p-4 rounded-lg bg-secondary/50 space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-sm flex items-center gap-1.5">
                          {o.fulfillment === 'mail' ? (
                            <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <Store className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span className="truncate">{passOrderBuyerLabel(o)}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {o.quantity} × {o.pass_type_name} · ${o.amount_paid.toFixed(2)} paid ·{' '}
                          {formatShowtime(o.created_at, 'MMM d')}
                        </p>
                        {o.buyer_email && (
                          <p className="text-xs text-muted-foreground break-all">{o.buyer_email}</p>
                        )}
                        {o.buyer_phone && (
                          <p className="text-xs text-muted-foreground">{o.buyer_phone}</p>
                        )}
                        {/* Shown in full: posting is a manual job and this is the
                            label the staff member has to write. */}
                        {o.fulfillment === 'mail' && (
                          address ? (
                            <p className="text-xs text-muted-foreground mt-1">Post to: {address}</p>
                          ) : (
                            <p className="text-xs text-destructive mt-1">
                              Mail order with no address on file — contact the buyer before posting.
                            </p>
                          )
                        )}
                      </div>
                      <Badge variant={o.fulfillment === 'mail' ? 'default' : 'secondary'} className="shrink-0 self-start">
                        {o.fulfillment === 'mail' ? 'To post' : 'Pickup'}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Always visible here, empty state included: an admin opening this tab
          is asking "is anything outstanding?", and a silent absence is not an
          answer. The counter hides it when empty instead. */}
      <MailQueueCard
        orders={awaitingPost}
        loading={loadingQueue}
        error={queueError}
        onRetry={loadQueue}
        onMarkPosted={markPosted}
      />

      {/* Pass Types */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-xl font-bold">Film Pass Types</h2>
        <Button size="sm" className="w-full sm:w-auto" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-1" /> Add Pass Type
        </Button>
      </div>

      {showForm && (
        <Card className="glass">
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. 10-Film Pass" />
              </div>
              <div className="space-y-2">
                <Label>Sale Price ($)</Label>
                <Input type="number" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Initial Balance ($)</Label>
                <Input type="number" step="0.01" value={form.initial_balance} onChange={e => setForm(f => ({ ...f, initial_balance: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Cost Per Admission ($)</Label>
                <Input type="number" step="0.01" value={form.redemption_price} onChange={e => setForm(f => ({ ...f, redemption_price: e.target.value }))} />
                <p className="text-xs text-muted-foreground">
                  Deducted at the door. Balance ÷ this is how many films the pass is worth.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Expiration (days, blank = none)</Label>
                <Input type="number" value={form.expiration_days} onChange={e => setForm(f => ({ ...f, expiration_days: e.target.value }))} placeholder="365" />
                <p className="text-xs text-muted-foreground">Counted from activation, not from purchase.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreateType}>Create</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {passTypes.map(pt => (
          <Card key={pt.id} className="glass">
            <CardContent className="p-4 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <CreditCard className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{pt.name}</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">${Number(pt.price).toFixed(2)} sale price</Badge>
                    <Badge variant="outline" className="text-xs">${Number(pt.initial_balance).toFixed(2)} balance</Badge>
                    <Badge variant="outline" className="text-xs">
                      ${Number(pt.redemption_price).toFixed(2)} per film ·{' '}
                      {Math.floor(Number(pt.initial_balance) / Number(pt.redemption_price || 1))} films
                    </Badge>
                    {pt.expiration_days && <Badge variant="secondary" className="text-xs">{pt.expiration_days} day expiry</Badge>}
                    <Badge variant={pt.is_active ? 'default' : 'secondary'} className="text-xs">
                      {pt.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={pt.is_active} onCheckedChange={() => toggleActive(pt.id, pt.is_active)} />
                <Button variant="ghost" size="sm" onClick={() => deleteType(pt.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {passTypes.length === 0 && <p className="text-muted-foreground text-center py-8">No film pass types configured.</p>}
      </div>

      {/* Print runs */}
      <h2 className="font-display text-xl font-bold pt-4">Sticker Print Runs</h2>
      <Card className="glass">
        <CardContent className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Stickers are printed blank and worth nothing until a staff member scans one at the
            counter. Print a sheet, stick them on the paper passes, and keep them behind the desk.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-2">
              <Label>Pass type</Label>
              <Select value={batchTypeId} onValueChange={setBatchTypeId}>
                <SelectTrigger><SelectValue placeholder="Choose a pass type..." /></SelectTrigger>
                <SelectContent>
                  {passTypes.filter(p => p.is_active).map(pt => (
                    <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-qty">How many</Label>
              <Input
                id="batch-qty"
                type="number"
                min={1}
                max={500}
                className="sm:w-28"
                value={batchQuantity}
                onChange={e => setBatchQuantity(e.target.value)}
              />
            </div>
            <Button onClick={handleMint} disabled={minting || !batchTypeId}>
              {minting ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Minting…</>
              ) : (
                <><QrCode className="h-4 w-4 mr-1" /> Generate</>
              )}
            </Button>
          </div>

          {batches.length > 0 && (
            <div className="space-y-2 pt-2 border-t">
              {batches.map(b => (
                <div key={b.batch_id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{b.pass_type_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatShowtime(b.created_at, 'MMM d, yyyy')} · {b.unassigned} of {b.total}{' '}
                      still blank
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={b.unassigned === 0}
                    onClick={() => reprintBatch(b.batch_id)}
                  >
                    <Printer className="h-4 w-4 mr-1" /> Reprint blanks
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Issued passes */}
      <h2 className="font-display text-xl font-bold pt-4">Issued Passes</h2>
      <div className="space-y-3">
        {userPasses.map(up => (
          <Card key={up.id} className="glass">
            <CardContent className="p-4 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <DollarSign className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {up.profile?.display_name || (up.user_id ? 'Unknown user' : 'Bearer pass')}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">{up.pass_type?.name}</Badge>
                    {up.remaining_balance !== null && (
                      <Badge variant="secondary" className="text-xs">
                        ${Number(up.remaining_balance).toFixed(2)} remaining
                      </Badge>
                    )}
                    <Badge variant={STATUS_VARIANT[up.status] ?? 'secondary'} className="text-xs">
                      {STATUS_LABEL[up.status] ?? up.status}
                    </Badge>
                    <Badge variant="outline" className="text-xs">{up.payment_method}</Badge>
                    {up.expires_at && (
                      <Badge
                        variant={new Date(up.expires_at) < new Date() ? 'destructive' : 'secondary'}
                        className="text-xs"
                      >
                        {new Date(up.expires_at) < new Date()
                          ? 'Expired'
                          : `Expires ${formatShowtime(up.expires_at, 'MMM d, yyyy')}`}
                      </Badge>
                    )}
                  </div>
                  {up.qr_code && (
                    <p className="text-[11px] font-mono text-muted-foreground break-all mt-1">
                      {up.qr_code}
                    </p>
                  )}
                </div>
              </div>
              {up.status !== 'void' && (
                <Button variant="ghost" size="sm" onClick={() => voidPass(up)} title="Cancel this pass">
                  <Ban className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
        {userPasses.length === 0 && (
          <p className="text-muted-foreground text-center py-8">No passes issued yet.</p>
        )}
      </div>
    </div>
  );
}
