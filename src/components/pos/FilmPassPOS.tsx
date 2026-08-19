import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  CreditCard, DollarSign, Search, ScanLine, Package, Mail, Store, Loader2, Check,
} from 'lucide-react';
import { PaymentMethodSelector, type PaymentMethod } from './PaymentMethodSelector';
import { QrScanner } from '@/components/admin/QrScanner';
import { invokeFunction } from '@/lib/functions';
import { formatShowtime } from '@/lib/datetime';
import {
  formatMailingAddress,
  passOrderBuyerLabel,
  type QueuedPassOrder as QueuedOrder,
  type AwaitingPostOrder,
} from '@/lib/passOrders';
import { MailQueueCard } from '@/components/admin/MailQueueCard';

/**
 * Film passes at the counter.
 *
 * The model this screen serves: a pass does not exist until a sticker is
 * scanned in front of the patron. Before that there is only a printed blank
 * worth nothing, and possibly an order saying the theatre owes somebody one.
 * So there is no "sell a pass" button that quietly creates a balance — there is
 * a sale, and then a scan, and the scan is what hands over value.
 *
 * Three things happen here:
 *
 *   Waiting        orders paid for online and not yet handed over. Every row is
 *                  a person owed a pass; without this list that debt has no
 *                  reminder attached and gets forgotten.
 *   Activate       scan a blank sticker — against an order, or as a walk-in
 *                  sale taken in the room.
 *   Look up        what is on a pass, for "why won't this work" at the counter.
 */

interface PassType {
  id: string;
  name: string;
  price: number;
  initial_balance: number;
  redemption_price: number;
  expiration_days: number | null;
}

interface PassSummary {
  id: string;
  qr_code: string | null;
  status: string;
  remaining_balance: number | null;
  admissions_left: number | null;
  redemption_price: number | null;
  expires_at: string | null;
  activated_at: string | null;
  pass_type_name: string;
  holder_name: string | null;
  holder_email: string | null;
  bearer: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  unassigned: 'Blank — not activated',
  active: 'Active',
  depleted: 'Used up',
  expired: 'Expired',
  void: 'Cancelled',
  pending: 'Awaiting payment',
  failed: 'Payment failed',
  refunded: 'Refunded',
};

export function FilmPassPOS() {
  const [passTypes, setPassTypes] = useState<PassType[]>([]);
  const [queue, setQueue] = useState<QueuedOrder[]>([]);
  const [awaitingPost, setAwaitingPost] = useState<AwaitingPostOrder[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);

  // Activation
  const [order, setOrder] = useState<QueuedOrder | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [patronEmail, setPatronEmail] = useState('');
  const [patronName, setPatronName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [stickerCode, setStickerCode] = useState('');
  const [activating, setActivating] = useState(false);
  const [justActivated, setJustActivated] = useState<Record<string, any> | null>(null);
  const stickerRef = useRef<HTMLInputElement>(null);

  // Lookup
  const [lookupTerm, setLookupTerm] = useState('');
  const [foundPasses, setFoundPasses] = useState<PassSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const selectedType = passTypes.find(t => t.id === selectedTypeId);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const data = await invokeFunction<{
        orders: QueuedOrder[];
        awaiting_post: AwaitingPostOrder[];
      }>('film-pass-checkout', { action: 'queue' });
      setQueue(data.orders || []);
      setAwaitingPost(data.awaiting_post || []);
      setQueueError(null);
    } catch (err: any) {
      toast.error(err.message || 'Could not load the pickup queue');
      setQueueError(err?.message || 'Could not load the queue');
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
    } catch (err: any) {
      toast.error(err?.message || 'Could not mark that order posted');
      return; // Leave the row where it is — nothing was recorded.
    }

    if (data.result === 'already_posted') {
      toast.info('Somebody already marked that one posted.');
    } else if (data.notice === 'failed') {
      toast.warning('Marked posted, but the email to the buyer did not send.');
    } else if (data.notice === 'no_email') {
      toast.success('Marked posted. No email on file for this buyer.');
    } else {
      toast.success('Marked posted — the buyer has been emailed.');
    }
    await loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    supabase
      .from('film_pass_types')
      .select('id, name, price, initial_balance, redemption_price, expiration_days')
      .eq('is_active', true)
      .order('price')
      .then(({ data }) => {
        const types = (data || []) as PassType[];
        setPassTypes(types);
        if (types.length > 0) setSelectedTypeId(types[0].id);
      });
    loadQueue();
  }, [loadQueue]);

  /**
   * Take a card on the Square Terminal and wait for it to complete.
   *
   * The sequencing is the point: the sticker is not activated until Square says
   * COMPLETED, so a pass that was never paid for never carries a balance.
   */
  async function collectTerminalPayment(amountCents: number, note: string): Promise<string | null> {
    const created = await invokeFunction<{
      simulated?: boolean;
      checkout?: { id?: string; status?: string };
    }>('square-terminal', {
      action: 'create_checkout',
      amount_cents: amountCents,
      note,
      idempotency_key: crypto.randomUUID(),
    });

    if (created.simulated) return null;

    const checkoutId = created.checkout?.id;
    if (!checkoutId) throw new Error('The terminal did not start a payment.');

    for (let attempt = 0; attempt < 60; attempt++) {
      const status = await invokeFunction<{
        checkout?: { status?: string };
        payment_id?: string | null;
      }>('square-terminal', { action: 'get_checkout', checkout_id: checkoutId });
      const state = status.checkout?.status;
      if (state === 'COMPLETED') return status.payment_id ?? null;
      if (state === 'CANCELED' || state === 'CANCEL_REQUESTED') {
        throw new Error('Payment was canceled on the terminal.');
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Payment timed out. Check the terminal.');
  }

  function startOrder(o: QueuedOrder) {
    setOrder(o);
    setJustActivated(null);
    setStickerCode('');
    // Focus the scan field: a handheld scanner types into whatever has focus,
    // and hunting for the box with a patron waiting is where mis-scans happen.
    setTimeout(() => stickerRef.current?.focus(), 0);
  }

  function clearActivation() {
    setOrder(null);
    setStickerCode('');
    setPatronEmail('');
    setPatronName('');
    setJustActivated(null);
  }

  /**
   * `scanned` is passed by the camera, which cannot wait for a state update:
   * setStickerCode is async, so activating straight off the decoded value is
   * the difference between one tap and a sticker that silently activates the
   * previous code.
   */
  async function handleActivate(scanned?: string) {
    const code = (scanned ?? stickerCode).trim();
    if (!code) { toast.error('Scan the sticker on the pass'); return; }
    if (!code.startsWith('PASS:')) {
      toast.error('That is a ticket code, not a film pass sticker.');
      return;
    }
    if (!order && !selectedType) { toast.error('Choose a pass type'); return; }

    setActivating(true);
    try {
      // Walk-in card sales take the money first. An order has already been paid
      // for online, so there is nothing to collect here.
      let squarePaymentId: string | null = null;
      if (!order && paymentMethod === 'card' && selectedType) {
        squarePaymentId = await collectTerminalPayment(
          Math.round(selectedType.price * 100),
          `${selectedType.name} film pass`,
        );
      }

      const result = await invokeFunction<Record<string, any>>('film-pass-checkout', {
        action: 'activate',
        qr_code: code,
        order_id: order?.id,
        pass_type_id: order ? undefined : selectedType!.id,
        payment_method: order ? undefined : paymentMethod,
        square_payment_id: squarePaymentId,
        name: order ? undefined : patronName.trim() || undefined,
        email: order ? undefined : patronEmail.trim() || undefined,
      });

      setJustActivated(result);
      toast.success(
        `${result.pass_type_name} activated — $${Number(result.remaining_balance).toFixed(2)} (${
          result.admissions
        } films)`,
      );
      setStickerCode('');
      setPatronEmail('');
      setPatronName('');
      if (order) { setOrder(null); loadQueue(); }
    } catch (err: any) {
      toast.error(err.message || 'Could not activate that sticker');
    } finally {
      setActivating(false);
    }
  }

  async function handleLookup() {
    const term = lookupTerm.trim();
    if (!term) return;
    setSearching(true);
    setSearched(true);
    try {
      const isCode = term.startsWith('PASS:');
      const data = await invokeFunction<{
        pass: PassSummary | null;
        passes: PassSummary[];
      }>('film-pass-checkout', {
        action: 'lookup',
        qr_code: isCode ? term : undefined,
        email: isCode ? undefined : term.includes('@') ? term : undefined,
        phone: isCode || term.includes('@') ? undefined : term,
      });

      setFoundPasses(data.pass ? [data.pass] : data.passes || []);
    } catch (err: any) {
      setFoundPasses([]);
      toast.error(err.message || 'Lookup failed');
    } finally {
      setSearching(false);
    }
  }

  const money = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="space-y-6">
      {/* ---- Waiting to be handed over ---- */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" /> Waiting to be handed over
            {queue.length > 0 && <Badge variant="default">{queue.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingQueue ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing outstanding — every paid pass has been handed over or posted.
            </p>
          ) : (
            queue.map(o => (
              <div
                key={o.id}
                className={`p-4 rounded-lg bg-secondary/50 space-y-2 ${
                  order?.id === o.id ? 'ring-2 ring-primary' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm flex items-center gap-1.5">
                      {o.fulfillment === 'mail' ? (
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <Store className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {passOrderBuyerLabel(o)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {o.quantity} × {o.pass_type_name} · {money(o.amount_paid)} paid ·{' '}
                      {formatShowtime(o.created_at, 'MMM d')}
                    </p>
                    {o.buyer_email && (
                      <p className="text-xs text-muted-foreground">{o.buyer_email}</p>
                    )}
                    {o.fulfillment === 'mail' && formatMailingAddress(o.mailing_address) && (
                      // Shown in full: posting is a manual job and this is the
                      // label the staff member has to write.
                      <p className="text-xs text-muted-foreground mt-1">
                        Post to: {formatMailingAddress(o.mailing_address)}
                      </p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => startOrder(o)}>
                    <ScanLine className="h-4 w-4 mr-1" /> Activate
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* ---- Activated, still to go in the post ----
          Hidden when empty: the counter is a working screen and an always-on
          "nothing to post" is noise between a queue and a scanner. The admin
          tab keeps it visible instead, where absence is the answer. */}
      <MailQueueCard
        orders={awaitingPost}
        loading={loadingQueue}
        error={queueError}
        onRetry={loadQueue}
        onMarkPosted={markPosted}
        hideWhenEmpty
      />

      <div className="grid lg:grid-cols-2 gap-6">
        {/* ---- Activate a sticker ---- */}
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-primary" />
              {order ? 'Hand over an order' : 'Sell a pass'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {order ? (
              <div className="p-4 rounded-lg bg-primary/10 border border-primary/30 space-y-1">
                <p className="text-sm font-medium">
                  {order.buyer_name || order.buyer_email || 'Unnamed buyer'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {order.quantity} × {order.pass_type_name} · already paid
                </p>
                <Button variant="ghost" size="sm" className="px-0 h-auto" onClick={clearActivation}>
                  Cancel — sell to someone else instead
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Pass Type</Label>
                  <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a pass..." />
                    </SelectTrigger>
                    <SelectContent>
                      {passTypes.map(pt => (
                        <SelectItem key={pt.id} value={pt.id}>
                          {pt.name} — {money(Number(pt.price))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="pass-patron-name">Name (optional)</Label>
                    <Input
                      id="pass-patron-name"
                      placeholder="Jane Doe"
                      value={patronName}
                      onChange={e => setPatronName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pass-patron-email">Email (optional)</Label>
                    <Input
                      id="pass-patron-email"
                      type="email"
                      placeholder="patron@email.com"
                      value={patronEmail}
                      onChange={e => setPatronEmail(e.target.value)}
                    />
                  </div>
                </div>
                {/* Contact is genuinely optional. A paper pass works like cash:
                    whoever holds it can use it. Taking details only buys the
                    ability to cancel and reissue a lost one. */}
                <p className="text-xs text-muted-foreground -mt-1">
                  Leave blank for a bearer pass — whoever holds the card can use it, and a
                  lost pass cannot be replaced.
                </p>

                <PaymentMethodSelector paymentMethod={paymentMethod} onSelect={setPaymentMethod} />

                {selectedType && (
                  <div className="p-4 rounded-lg bg-secondary/50 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>{selectedType.name}</span>
                      <span className="font-bold">{money(Number(selectedType.price))}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Loads</span>
                      <span>
                        {money(Number(selectedType.initial_balance))} ·{' '}
                        {Math.floor(
                          Number(selectedType.initial_balance) /
                            Number(selectedType.redemption_price || 1),
                        )}{' '}
                        films at {money(Number(selectedType.redemption_price))} each
                      </span>
                    </div>
                    {selectedType.expiration_days && (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Valid for</span>
                        <span>{selectedType.expiration_days} days from now</span>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="sticker-code">Scan the sticker</Label>

              {/* Three ways in, because the counter is not one kind of device.
                  A handheld reader types into the focused field and sends
                  Enter; a phone or tablet has only its camera; and a scuffed
                  sticker has to be typed from the code printed under its QR. */}
              <QrScanner
                onScan={(text) => {
                  const code = text.trim();
                  setStickerCode(code);
                  // Straight through on a good scan — at a counter with someone
                  // waiting, "scan then press a button" is a step too many.
                  if (code.startsWith('PASS:') && !activating) void handleActivate(code);
                }}
                startLabel="Scan with camera"
                stopLabel="Stop camera"
                className="space-y-2"
              />

              <Input
                id="sticker-code"
                ref={stickerRef}
                placeholder="PASS:… (or scan with a handheld reader)"
                value={stickerCode}
                onChange={e => setStickerCode(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleActivate(); } }}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                The pass has no value until this scan. Stick it on the card first, then scan.
              </p>
            </div>

            <Button
              className="w-full"
              size="lg"
              // Wrapped, not passed directly: handleActivate takes an optional
              // scanned code, and onClick would hand it a MouseEvent.
              onClick={() => handleActivate()}
              disabled={activating || !stickerCode.trim() || (!order && !selectedTypeId)}
            >
              {activating ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Activating…</>
              ) : (
                <>
                  <CreditCard className="h-4 w-4 mr-1" />
                  {order
                    ? 'Activate and hand over'
                    : `Activate — ${money(Number(selectedType?.price ?? 0))}`}
                </>
              )}
            </Button>

            {justActivated && (
              <div className="p-4 rounded-lg bg-[hsl(var(--success))]/15 border border-[hsl(var(--success))]/40 space-y-1">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Check className="h-4 w-4" /> {justActivated.pass_type_name} activated
                </p>
                <p className="text-xs text-muted-foreground">
                  {money(Number(justActivated.remaining_balance))} ·{' '}
                  {justActivated.admissions} films
                  {justActivated.expires_at &&
                    ` · expires ${formatShowtime(justActivated.expires_at, 'MMM d, yyyy')}`}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---- Look up a pass ---- */}
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" /> Look Up a Pass
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Scan a pass, or search email / phone…"
                value={lookupTerm}
                onChange={e => setLookupTerm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLookup()}
                autoComplete="off"
              />
              <Button onClick={handleLookup} disabled={searching}>
                <Search className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3">
              {foundPasses.map(pass => (
                <div key={pass.id} className="p-4 rounded-lg bg-secondary/50 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{pass.pass_type_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {pass.bearer ? 'Bearer pass — no account' : pass.holder_name || pass.holder_email}
                      </p>
                    </div>
                    <Badge variant={pass.status === 'active' ? 'default' : 'secondary'}>
                      {pass.remaining_balance !== null && (
                        <DollarSign className="h-3 w-3 mr-0.5" />
                      )}
                      {pass.remaining_balance !== null
                        ? Number(pass.remaining_balance).toFixed(2)
                        : STATUS_LABEL[pass.status] ?? pass.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {STATUS_LABEL[pass.status] ?? pass.status}
                    {pass.admissions_left !== null &&
                      pass.status === 'active' &&
                      ` · ${pass.admissions_left} ${
                        pass.admissions_left === 1 ? 'film' : 'films'
                      } left`}
                    {pass.expires_at &&
                      ` · expires ${formatShowtime(pass.expires_at, 'MMM d, yyyy')}`}
                  </p>
                  {pass.qr_code && (
                    <p className="text-xs font-mono text-muted-foreground break-all">
                      {pass.qr_code}
                    </p>
                  )}
                </div>
              ))}
              {searched && foundPasses.length === 0 && !searching && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nothing found for that.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
