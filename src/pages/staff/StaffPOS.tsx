import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  ShoppingCart, Film, User, Loader2, CheckCircle2, AlertTriangle,
  RotateCcw, Banknote, CreditCard, Minus, Plus, UtensilsCrossed, Ticket,
  ScanLine, Send, History, CalendarDays,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { SeatMap } from '@/components/SeatMap';
import { DailySalesSummary } from '@/components/pos/DailySalesSummary';
import { TransactionHistory, type SessionTransaction } from '@/components/pos/TransactionHistory';
import { PaymentMethodSelector, type PaymentMethod } from '@/components/pos/PaymentMethodSelector';
import { ConcessionPOS } from '@/components/pos/ConcessionPOS';
import { FilmPassPOS } from '@/components/pos/FilmPassPOS';
import { TodaysPresales } from '@/components/pos/TodaysPresales';
import { TimeClockWidget } from '@/components/pos/TimeClockWidget';
import { SearchableSelect } from '@/components/ui/searchable-select';
import TransactionsTab from '@/components/admin/TransactionsTab';
import { type Seat, type PriceTier, type TicketLineItem, buildTicketRows, computeLineItemTotals, computeOrderTotals, computeProcessingFee, newOrderToken, TAX_RATE } from '@/lib/booking';
import { DonationPrompt } from '@/components/DonationPrompt';
import { invokeFunction } from '@/lib/functions';
import { fetchShowingAvailability } from '@/lib/availability';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { COLLECT_PHONE, CONCESSION_POS_ENABLED } from '@/lib/flags';
import { formatShowtime } from '@/lib/datetime';
import TicketScanner from './TicketScanner';

interface ShowingOption {
  id: string;
  start_time: string;
  ticket_price: number;
  movie_title: string;
  requires_seat_selection: boolean;
  total_seats: number;
  pass_processing_fee: boolean;
}

type PaymentStatus = 'idle' | 'processing' | 'completed' | 'failed';

export default function StaffPOS() {
  const { isAdmin, isStaff, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [showings, setShowings] = useState<ShowingOption[]>([]);
  const [selectedShowingId, setSelectedShowingId] = useState('');
  const [seats, setSeats] = useState<Seat[]>([]);
  const [takenSeatIds, setTakenSeatIds] = useState<Set<string>>(new Set());
  const [selectedSeats, setSelectedSeats] = useState<Set<string>>(new Set());
  const [patronEmail, setPatronEmail] = useState('');
  const [patronPhone, setPatronPhone] = useState('');
  const [selling, setSelling] = useState(false);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [gaQuantity, setGaQuantity] = useState(0);
  const [gaTicketsSold, setGaTicketsSold] = useState(0);

  // Tiered pricing state
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [tierQuantities, setTierQuantities] = useState<Record<string, number>>({});
  const [selectedTierId, setSelectedTierId] = useState(''); // for assigned seating

  const hasTiers = priceTiers.length > 0;

  // A gift the patron adds at the counter. It rides on the same payment — one
  // combined amount to the terminal, or one handful of cash — and is recorded
  // as contribution income, untaxed, exactly like the online path.
  const [donationCents, setDonationCents] = useState(0);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('idle');
  const [squareCheckoutId, setSquareCheckoutId] = useState<string | null>(null);
  const [isSimulated, setIsSimulated] = useState(false);

  const [transactions, setTransactions] = useState<SessionTransaction[]>([]);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundingTx, setRefundingTx] = useState<SessionTransaction | null>(null);
  const [refunding, setRefunding] = useState(false);

  // Resending is how a mistyped address is recovered, so the dialog carries its
  // own editable copy of the contact rather than replaying what was sold with.
  const [resendDialogOpen, setResendDialogOpen] = useState(false);
  const [resendingTx, setResendingTx] = useState<SessionTransaction | null>(null);
  const [resendEmail, setResendEmail] = useState('');
  const [resendPhone, setResendPhone] = useState('');
  const [resending, setResending] = useState(false);

  const [dailyStats, setDailyStats] = useState({ revenue: 0, ticketCount: 0, refundCount: 0 });

  // The door, without leaving the till.
  //
  // An overlay rather than a fourth tab, and rather than a link to
  // /staff/scanner. A tab would box the camera inside the page furniture, which
  // is the thing the scanner was just rebuilt to stop doing; a link would throw
  // away a half-rung sale — selected seats, patron details, a donation the
  // patron just agreed to — every time someone at the counter is handed a
  // ticket to check. Unmounting is what stops the camera, so closing this
  // releases the device exactly as navigating away used to.
  const [scannerOpen, setScannerOpen] = useState(false);

  const loadDailyStats = useCallback(async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('tickets')
      .select('total_price, status')
      .gte('purchased_at', todayStart.toISOString());
    if (data) {
      const confirmed = data.filter(t => t.status === 'confirmed');
      const refunded = data.filter(t => t.status === 'refunded');
      setDailyStats({
        revenue: confirmed.reduce((sum, t) => sum + Number(t.total_price), 0),
        ticketCount: confirmed.length,
        refundCount: refunded.length,
      });
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isStaff) { navigate('/'); return; }

    loadDailyStats();

    async function loadShowings() {
      // Paged, because PostgREST caps a select at 1000 rows with no error and
      // no warning. A truncated list here does not look like a bug — it looks
      // like the showing simply is not on the schedule, and the counter has a
      // patron waiting while it is not there.
      const { data } = await fetchAllRows<any, unknown>((from, to) =>
        supabase
          .from('showings')
          .select('id, start_time, ticket_price, total_seats, requires_seat_selection, movies(title, pass_processing_fee)')
          .eq('is_active', true)
          .gte('start_time', new Date().toISOString())
          .order('start_time')
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: any[] | null; error: unknown }>,
      );

      setShowings(
        (data || []).map((s: any) => ({
          id: s.id,
          start_time: s.start_time,
          ticket_price: s.ticket_price,
          movie_title: s.movies?.title || 'Unknown',
          requires_seat_selection: s.requires_seat_selection ?? false,
          total_seats: s.total_seats ?? 200,
          pass_processing_fee: !!s.movies?.pass_processing_fee,
        }))
      );
    }
    loadShowings();
  }, [isStaff, authLoading, navigate]);

  // Load seats + price tiers when showing changes
  useEffect(() => {
    if (!selectedShowingId) return;
    setSelectedSeats(new Set());
    setGaQuantity(0);
    setTierQuantities({});
    setSelectedTierId('');
    setLoadingSeats(true);

    const currentShowing = showings.find(s => s.id === selectedShowingId);

    async function loadData() {
      // Load price tiers
      const { data: tiersData } = await supabase
        .from('showing_price_tiers')
        .select('id, tier_name, price, display_order')
        .eq('showing_id', selectedShowingId)
        .eq('is_active', true)
        .order('display_order');

      const tiers: PriceTier[] = (tiersData || []).map(t => ({
        id: t.id,
        tier_name: t.tier_name,
        price: Number(t.price),
        display_order: t.display_order,
      }));
      setPriceTiers(tiers);

      // Initialize tier quantities to 0
      const initQty: Record<string, number> = {};
      tiers.forEach(t => { initQty[t.id] = 0; });
      setTierQuantities(initQty);

      // Default selected tier for assigned seating
      if (tiers.length > 0) {
        setSelectedTierId(tiers[0].id);
      }

      // Availability comes from the showing_availability RPC, not from querying
      // tickets. The only SELECT policy on tickets is
      // `user_id = auth.uid() OR is_admin()`, and is_admin() reads
      // profiles.role — a different table from the user_roles that has_role()
      // and the staff RLS policies use. So a staff-only account sees none of
      // the sales it just rang up: the seat map showed sold seats as free and
      // gaTicketsSold sat at 0. The RPC also counts unpaid pending holds, which
      // a raw status='confirmed' query missed, so the box office no longer
      // offers a seat an online buyer is mid-checkout on.
      const availability = await fetchShowingAvailability(selectedShowingId);

      if (currentShowing?.requires_seat_selection) {
        const seatsRes = await supabase.from('seats').select('*').order('seat_row').order('seat_number');
        setSeats(seatsRes.data || []);
        setTakenSeatIds(availability?.takenSeatIds ?? new Set());
      } else {
        setGaTicketsSold(availability?.held ?? 0);
      }
      setLoadingSeats(false);
    }
    loadData();
  }, [selectedShowingId, showings]);

  const selectedShowing = showings.find(s => s.id === selectedShowingId);
  const isAssignedSeating = selectedShowing?.requires_seat_selection;

  /**
   * Options for the showing picker.
   *
   * The title is the label and the showtime is the hint, so two screenings of
   * the same film are told apart on the trigger as well as in the list — the
   * old dropdown crammed all three into one line and every row of a long run
   * looked the same.
   *
   * Both halves are searched, which is why the date is spelled out with its
   * weekday: staff say "the Friday one".
   */
  const showingOptions = useMemo(
    () =>
      showings.map(s => ({
        value: s.id,
        label: s.movie_title,
        hint: `${formatShowtime(s.start_time, 'EEE d MMM, h:mm a')} · $${Number(s.ticket_price).toFixed(2)}`,
      })),
    [showings],
  );

  // Build line items from current selection
  const lineItems: TicketLineItem[] = (() => {
    if (!selectedShowing) return [];

    if (hasTiers) {
      if (isAssignedSeating) {
        // All selected seats use the chosen tier
        const tier = priceTiers.find(t => t.id === selectedTierId);
        if (!tier || selectedSeats.size === 0) return [];
        return [{
          tierId: tier.id,
          tierName: tier.tier_name,
          price: tier.price,
          quantity: selectedSeats.size,
          seatIds: Array.from(selectedSeats),
        }];
      } else {
        // GA with tiers — one line item per tier with quantity > 0
        return priceTiers
          .filter(t => (tierQuantities[t.id] || 0) > 0)
          .map(t => ({
            tierId: t.id,
            tierName: t.tier_name,
            price: t.price,
            quantity: tierQuantities[t.id],
          }));
      }
    }

    // No tiers — legacy single price
    return [];
  })();

  const ticketCount = hasTiers
    ? lineItems.reduce((sum, li) => sum + (li.seatIds ? li.seatIds.length : li.quantity), 0)
    : (isAssignedSeating ? selectedSeats.size : gaQuantity);

  const gaAvailable = (selectedShowing?.total_seats || 200) - gaTicketsSold;

  const { subtotal, tax, total } = hasTiers
    ? computeLineItemTotals(lineItems)
    : computeOrderTotals(ticketCount, selectedShowing?.ticket_price || 0);

  // Standard sales carry no processing fee; the theatre absorbs Square's cut.
  // Only a rental production whose agreement says otherwise sets
  // pass_processing_fee, and even then only a card sale can carry it — cash
  // never does, because no card was processed.
  const passProcessingFee =
    !!selectedShowing?.pass_processing_fee && paymentMethod === 'card' && total > 0;
  const processingFee = passProcessingFee ? computeProcessingFee(total, 'in_person').fee : 0;
  const grandTotal = Math.round((total + processingFee) * 100) / 100;
  // Tax was computed from the ticket lines above; the gift is added after it
  // and is never part of it. This is the number the terminal is handed.
  const chargeTotal = Math.round(grandTotal * 100 + donationCents) / 100;

  const toggleSeat = (seatId: string) => {
    if (takenSeatIds.has(seatId)) return;
    setSelectedSeats(prev => {
      const next = new Set(prev);
      if (next.has(seatId)) next.delete(seatId);
      else next.add(seatId);
      return next;
    });
  };

  const createTickets = useCallback(async (
    method: PaymentMethod,
    squarePaymentId: string | null = null,
  ): Promise<{ ticketIds: string[]; orderToken: string }> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Generated here rather than left to buildTicketRows so a donation taken
    // with this sale can be filed against the same order.
    const orderToken = newOrderToken();

    const ticketRows = buildTicketRows({
      orderToken,
      lineItems: hasTiers ? lineItems : undefined,
      selectedSeats: !hasTiers ? selectedSeats : undefined,
      quantity: !hasTiers && !isAssignedSeating ? gaQuantity : undefined,
      userId: user.id,
      showingId: selectedShowingId,
      ticketPrice: !hasTiers ? selectedShowing!.ticket_price : undefined,
      paymentMethod: method,
      processingFee: method === 'card' ? processingFee : 0,
      // Recorded so a refund credits the card that paid, rather than only
      // flipping the ticket's status.
      squarePaymentId,
    });

    const { data, error } = await supabase.from('tickets').insert(ticketRows).select('id');
    if (error) throw error;
    return { ticketIds: (data || []).map(t => t.id), orderToken };
  }, [selectedSeats, gaQuantity, isAssignedSeating, selectedShowingId, selectedShowing, hasTiers, lineItems, processingFee]);

  /**
   * File the counter donation, once the sale it rode in on has gone through.
   *
   * Server-side, because the donations table grants INSERT to service_role
   * alone — the POS cannot write the row itself, and should not: the same
   * server action sends the receipt and posts the gift to Little Green Light.
   *
   * A failure here is reported to the staff member and nothing else: the money
   * is already in the till or on the card, so the answer is a note to the
   * manager, not a rolled-back sale.
   */
  const recordDonation = useCallback(async (
    channel: 'cash' | 'terminal',
    squarePaymentId: string | null,
    orderToken: string | null,
  ) => {
    if (donationCents <= 0) return;
    try {
      await invokeFunction('square-donation', {
        action: 'record_in_person',
        amountCents: donationCents,
        paymentChannel: channel,
        donorEmail: patronEmail.trim() || null,
        donorPhone: patronPhone.trim() || null,
        squarePaymentId,
        orderToken,
        showingId: selectedShowingId,
      });
      toast.success(`$${(donationCents / 100).toFixed(2)} donation recorded — thank the patron!`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      toast.error(
        `The sale went through but the $${(donationCents / 100).toFixed(2)} donation was not recorded: ${reason}. Tell a manager.`,
        { duration: 12000 },
      );
    }
  }, [donationCents, patronEmail, patronPhone, selectedShowingId]);

  /**
   * Send the patron their tickets, once the sale that paid for them is done.
   *
   * The counter used to be the one paid path with no digital record: StaffPOS
   * asks for an address, inserts the ticket rows, and — before this — stopped.
   * Online checkout has always called `deliverConfirmation` in-process; this is
   * the same delivery, reached over HTTP.
   *
   * The overrides are the whole point. POS ticket rows are owned by the *staff
   * member* who rang the sale, so with no `email`/`phone` here the server would
   * fall back to the account behind the order and mail the patron's ticket to
   * whoever is signed in at the window. send-ticket-confirmation honours
   * overrides for operators, which now includes signed-in staff.
   *
   * Failure is reported and nothing else, exactly as `recordDonation` does: the
   * money is already in the till or on the card, so an undelivered email is a
   * resend, not a rolled-back sale. The resend button on the transaction row is
   * the recovery path — including for the common case, a mistyped address.
   */
  const deliverPos = useCallback(async (orderToken: string) => {
    const email = patronEmail.trim();
    const phone = patronPhone.trim();
    if (!email && !phone) return;

    // No email means nothing can go out, because the counter cannot text.
    // Online checkout carries an A2P 10DLC opt-in checkbox; a number typed at
    // this window has no consent behind it and no record that anyone asked.
    // Said plainly here rather than sent to the server to fail — and the sale
    // still stands, exactly as it does for any other delivery failure.
    if (!email) {
      toast.warning(
        'Sale complete, but there is no email to send the ticket to — the box office cannot text yet. ' +
        'Take an email and use Resend below.',
        { duration: 12000 },
      );
      return;
    }
    try {
      const result = await invokeFunction<{
        delivered?: boolean;
        channel?: string;
        partial_error?: string;
      }>('send-ticket-confirmation', {
        order_token: orderToken,
        email,
        phone: phone || undefined,
        // Never true from here. See SMS_DELIVERY_LIVE item 5 in @/lib/flags:
        // the counter has no opt-in checkbox, so there is no consent to assert,
        // and a number on a POS sale is a way to reach the patron rather than a
        // delivery address. Flip this only alongside a real counter opt-in.
        sms_consent: false,
      });
      if (result?.delivered) {
        toast.success(`Tickets sent to ${email}.`);
      }
      // Kept even though the counter sends email only: `partial_error` is how
      // deliver.ts reports a channel that was attempted and failed, and a
      // delivered order with something still wrong should never pass silently.
      if (result?.partial_error) {
        toast.warning(
          `Sent, but one channel did not go through: ${result.partial_error}`,
          { duration: 10000 },
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      toast.error(
        `Sale complete, but the ticket confirmation did not send: ${reason}. ` +
        'Resend it from the transaction list below, or take the address again.',
        { duration: 12000 },
      );
    }
  }, [patronEmail, patronPhone]);

  const refreshAfterSale = useCallback(async () => {
    if (isAssignedSeating) {
      const { data: ticketsData } = await supabase
        .from('tickets')
        .select('seat_id')
        .eq('showing_id', selectedShowingId)
        .eq('status', 'confirmed');
      setTakenSeatIds(new Set((ticketsData || []).map(t => t.seat_id)));
    } else {
      const { count } = await supabase
        .from('tickets')
        .select('id', { count: 'exact' })
        .eq('showing_id', selectedShowingId)
        .eq('status', 'confirmed');
      setGaTicketsSold(count || 0);
    }
  }, [selectedShowingId, isAssignedSeating]);

  const addTransaction = useCallback((
    ticketIds: string[],
    method: PaymentMethod,
    orderToken: string,
  ) => {
    const seatLabels = isAssignedSeating
      ? Array.from(selectedSeats).map(seatId => {
          const seat = seats.find(s => s.id === seatId);
          return seat ? `${seat.seat_row}${seat.seat_number}` : '?';
        })
      : hasTiers
        ? lineItems.filter(li => li.quantity > 0).map(li => `${li.tierName} ×${li.seatIds ? li.seatIds.length : li.quantity}`)
        : [`GA ×${gaQuantity}`];

    const tx: SessionTransaction = {
      id: crypto.randomUUID(),
      ticketIds,
      // Kept so the confirmation can be resent from this row: the order token
      // is the only handle send-ticket-confirmation takes, and the address is
      // what a resend is usually correcting.
      orderToken,
      patronEmail: patronEmail.trim(),
      patronPhone: patronPhone.trim(),
      movieTitle: selectedShowing?.movie_title || 'Unknown',
      seatLabels,
      // The ticket total, not the charged total: this row is what the refund
      // button acts on, and a donation is not refundable from the POS — it is a
      // completed gift, reversed by a manager if it ever needs to be.
      total: grandTotal,
      paymentMethod: method,
      timestamp: new Date(),
      refunded: false,
    };
    setTransactions(prev => [tx, ...prev]);
  }, [selectedSeats, seats, selectedShowing, grandTotal, isAssignedSeating, gaQuantity, hasTiers, lineItems, patronEmail, patronPhone]);

  const resetForm = useCallback(() => {
    setSelectedSeats(new Set());
    setGaQuantity(0);
    setTierQuantities(prev => {
      const reset: Record<string, number> = {};
      Object.keys(prev).forEach(k => { reset[k] = 0; });
      return reset;
    });
    setPatronEmail('');
    setPatronPhone('');
    setDonationCents(0);
    setPaymentStatus('idle');
    setSquareCheckoutId(null);
    setIsSimulated(false);
  }, []);

  const handleCashSale = async () => {
    setSelling(true);
    try {
      const { ticketIds, orderToken } = await createTickets('cash');
      addTransaction(ticketIds, 'cash', orderToken);

      // Put the sale into Square as an Order with a CASH tender.
      //
      // Until now a cash ticket never reached Square at all — the rows were
      // written with square_payment_id null and that was the end of it, so the
      // till and the Square dashboard could only be reconciled by hand.
      //
      // The server re-reads the ticket rows and decides the amount; nothing here
      // tells it what was collected. And it runs AFTER the sale is already
      // written and scannable, so a failure costs the Square record and nothing
      // else. The staff member is told, because a missing record is a note to
      // the manager — not a reason to void a sale whose money is in the drawer.
      try {
        const { data: sq, error: sqErr } = await supabase.functions.invoke('square-cash-sale', {
          body: { order_token: orderToken, donation_cents: donationCents },
        });
        if (sqErr || !sq?.ok) {
          console.error('[StaffPOS] cash sale not recorded in Square', sqErr || sq);
          toast.warning('Sale complete, but it was not recorded in Square. Tell a manager.');
        }
      } catch (sqErr) {
        console.error('[StaffPOS] cash sale not recorded in Square', sqErr);
        toast.warning('Sale complete, but it was not recorded in Square. Tell a manager.');
      }
      toast.success(
        donationCents > 0
          ? `${ticketCount} ticket(s) sold (cash) — collect $${chargeTotal.toFixed(2)} including the donation.`
          : `${ticketCount} ticket(s) sold (cash)!`,
        { duration: 5000 },
      );
      await recordDonation('cash', null, orderToken);
      await deliverPos(orderToken);
      resetForm();
      await refreshAfterSale();
      loadDailyStats();
    } catch (err: any) {
      toast.error(err.message || 'Failed to process sale');
    } finally {
      setSelling(false);
    }
  };

  const handleCardSale = async () => {
    setSelling(true);
    setPaymentStatus('processing');

    try {
      const idempotencyKey = crypto.randomUUID();
      // One charge on the reader for tickets, their tax, and the gift. Square's
      // own checkout UI cannot show a donation button — see docs/DONATIONS.md,
      // Part E — so the prompt happens here and the terminal is simply handed
      // the combined amount.
      const amountCents = Math.round(chargeTotal * 100);

      const { data, error } = await supabase.functions.invoke('square-terminal', {
        body: {
          action: 'create_checkout',
          amount_cents: amountCents,
          note: donationCents > 0
            ? `${selectedShowing!.movie_title} — ${ticketCount} ticket(s) + $${(donationCents / 100).toFixed(2)} donation`
            : `${selectedShowing!.movie_title} — ${ticketCount} ticket(s)`,
          idempotency_key: idempotencyKey,
        },
      });

      if (error) throw new Error(error.message || 'Failed to create checkout');

      const checkoutId = data.checkout?.id;
      setSquareCheckoutId(checkoutId);
      setIsSimulated(data.simulated || false);

      if (data.simulated || data.checkout?.status === 'COMPLETED') {
        setPaymentStatus('completed');
        const paymentId = data.checkout?.payment_ids?.[0] ?? null;
        const { ticketIds, orderToken } = await createTickets('card', paymentId);
        addTransaction(ticketIds, 'card', orderToken);
        toast.success(
          `${ticketCount} ticket(s) sold (card)! ${data.simulated ? '(Sandbox simulation)' : ''}`,
          { duration: 5000 }
        );
        await recordDonation('terminal', paymentId, orderToken);
        await deliverPos(orderToken);
        resetForm();
        await refreshAfterSale();
        loadDailyStats();
      } else {
        pollCheckoutStatus(checkoutId);
      }
    } catch (err: any) {
      setPaymentStatus('failed');
      toast.error(err.message || 'Payment failed');
    } finally {
      setSelling(false);
    }
  };

  const pollCheckoutStatus = useCallback(async (checkoutId: string) => {
    const maxAttempts = 60;
    let attempt = 0;

    const poll = async () => {
      attempt++;
      try {
        const { data, error } = await supabase.functions.invoke('square-terminal', {
          body: { action: 'get_checkout', checkout_id: checkoutId },
        });

        if (error) throw error;

        const status = data.checkout?.status;
        if (status === 'COMPLETED') {
          setPaymentStatus('completed');
          const { ticketIds, orderToken } = await createTickets('card', data.payment_id ?? null);
          addTransaction(ticketIds, 'card', orderToken);
          toast.success(`Payment complete! ${ticketCount} ticket(s) sold.`);
          await recordDonation('terminal', data.payment_id ?? null, orderToken);
          await deliverPos(orderToken);
          resetForm();
          loadDailyStats();
          await refreshAfterSale();
          return;
        }
        if (status === 'CANCELED' || status === 'CANCEL_REQUESTED') {
          setPaymentStatus('failed');
          toast.error('Payment was canceled on the terminal.');
          return;
        }
        if (attempt < maxAttempts) {
          setTimeout(poll, 2000);
        } else {
          setPaymentStatus('failed');
          toast.error('Payment timed out. Check the terminal.');
        }
      } catch {
        if (attempt < maxAttempts) {
          setTimeout(poll, 2000);
        } else {
          setPaymentStatus('failed');
          toast.error('Lost connection while checking payment.');
        }
      }
    };

    poll();
  }, [createTickets, addTransaction, resetForm, refreshAfterSale, recordDonation, deliverPos, ticketCount]);

  const handleSell = () => {
    if (!selectedShowingId || ticketCount === 0) {
      toast.error('Select a showing and at least one ticket');
      return;
    }
    // The email is the delivery address: `deliverPos` sends the tickets to
    // whatever is typed here, and nothing else on this screen knows who the
    // patron is (the ticket rows are owned by the staff member ringing the
    // sale). The phone is a contact, not a channel — see the note by the field.
    //
    // Still only a warning, not a block. A walk-in who has no email address
    // should not be turned away at a busy window; the sale goes through, and
    // `deliverPos` says plainly that nothing could be sent.
    if (COLLECT_PHONE ? (!patronEmail && !patronPhone) : !patronEmail) {
      toast.error(
        COLLECT_PHONE
          ? 'Enter a patron email (or at least a phone) before selling'
          : 'Enter a patron email to send the tickets to',
      );
      return;
    }

    if (paymentMethod === 'cash') {
      handleCashSale();
    } else {
      handleCardSale();
    }
  };

  const openResend = (tx: SessionTransaction) => {
    setResendingTx(tx);
    setResendEmail(tx.patronEmail);
    setResendPhone(tx.patronPhone);
    setResendDialogOpen(true);
  };

  /**
   * Resend an order's confirmation, to a corrected address if need be.
   *
   * `force` is required and not optional: the first dispatch stamped
   * `confirmation_sent_at`, and without it the server correctly answers
   * "already sent" and does nothing — which is the guard that stops a double
   * send, and exactly the wrong answer when the first send went to a typo.
   */
  const handleResend = async () => {
    if (!resendingTx) return;
    const email = resendEmail.trim();
    const phone = resendPhone.trim();
    if (!email) {
      toast.error('Enter an email — the box office cannot send a ticket by text yet');
      return;
    }
    setResending(true);
    try {
      const result = await invokeFunction<{
        delivered?: boolean;
        channel?: string;
        partial_error?: string;
      }>('send-ticket-confirmation', {
        order_token: resendingTx.orderToken,
        email: email || undefined,
        phone: phone || undefined,
        // As in deliverPos: no counter opt-in, so no consent to assert.
        sms_consent: false,
        force: true,
      });
      toast.success(`Confirmation resent to ${email}.`);
      if (result?.partial_error) {
        toast.warning(
          `Sent, but one channel did not go through: ${result.partial_error}`,
          { duration: 10000 },
        );
      }
      // So a second resend defaults to the address that worked.
      setTransactions(prev => prev.map(tx =>
        tx.id === resendingTx.id ? { ...tx, patronEmail: email, patronPhone: phone } : tx
      ));
      setResendDialogOpen(false);
      setResendingTx(null);
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      toast.error(`Could not resend: ${reason}`, { duration: 12000 });
    } finally {
      setResending(false);
    }
  };

  const handleRefund = async () => {
    if (!refundingTx) return;
    setRefunding(true);
    try {
      // The refund is issued by the server: it re-reads the authoritative
      // amounts, calls Square's Refunds API against the payment that took the
      // money, and only then marks the tickets refunded. Marking them refunded
      // here — which is all this used to do — would tell the patron they had
      // been refunded while their card was never credited.
      const result = await invokeFunction<{
        refunded_total: number;
        warnings?: string[];
      }>('square-refund', {
        ticket_ids: refundingTx.ticketIds,
        reason: `Box office refund — ${refundingTx.movieTitle}`,
      });

      const refundAmount = Number(result.refunded_total || 0);

      setTransactions(prev =>
        prev.map(tx => tx.id === refundingTx.id ? { ...tx, refunded: true, total: refundAmount } : tx)
      );

      for (const warning of result.warnings || []) toast.warning(warning, { duration: 8000 });

      toast.success(`Refunded ${refundingTx.seatLabels.length} ticket(s) — $${refundAmount.toFixed(2)}`);
      setRefundDialogOpen(false);
      loadDailyStats();
      setRefundingTx(null);

      if (selectedShowingId) {
        await refreshAfterSale();
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to process refund');
    } finally {
      setRefunding(false);
    }
  };

  // Total GA tier quantity for availability check
  const totalTierQuantity = Object.values(tierQuantities).reduce((a, b) => a + b, 0);

  if (authLoading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="container py-8 px-4 max-w-6xl">
      <div className="flex items-center gap-3 mb-2">
        <ShoppingCart className="h-7 w-7 text-primary" />
        <h1 className="font-display text-3xl font-bold">Staff POS</h1>
        <Badge variant="secondary">Box Office</Badge>
        <Button
          variant="secondary"
          className="ml-auto"
          onClick={() => setScannerOpen(true)}
        >
          <ScanLine className="h-4 w-4 mr-2" />
          Open Scanner
        </Button>
      </div>
      <p className="text-muted-foreground mb-6">Sell tickets and concessions to walk-in patrons</p>

      <div className="mb-4">
        <TimeClockWidget />
      </div>

      <DailySalesSummary
        revenue={dailyStats.revenue}
        ticketCount={dailyStats.ticketCount}
        refundCount={dailyStats.refundCount}
      />

      <Tabs defaultValue="tickets" className="space-y-6">
        {/* max-w widens with the tab count: at max-w-sm a fourth tab squeezes
            every label to an ellipsis. Today makes it four or five, hence
            another step up.

            "Today" leads, because it is what the counter reads before it sells
            anything — who is coming tonight and who has walked in. The label is
            one word for the same reason the others are short; the panel's own
            heading carries the full "Today's Presales" and the date.

            The tab *value* stays `presales`. It is not user-visible, and it is
            what TabsContent below is keyed on. */}
        <TabsList
          className={`grid w-full ${
            CONCESSION_POS_ENABLED ? 'grid-cols-5 max-w-3xl' : 'grid-cols-4 max-w-2xl'
          }`}
        >
          <TabsTrigger value="presales"><CalendarDays className="h-4 w-4 mr-1" /> Today</TabsTrigger>
          <TabsTrigger value="tickets"><ShoppingCart className="h-4 w-4 mr-1" /> Tickets</TabsTrigger>
          {CONCESSION_POS_ENABLED && (
            <TabsTrigger value="concessions"><UtensilsCrossed className="h-4 w-4 mr-1" /> Concessions</TabsTrigger>
          )}
          <TabsTrigger value="film-passes"><Ticket className="h-4 w-4 mr-1" /> Film Passes</TabsTrigger>
          <TabsTrigger value="transactions">
            <History className="h-4 w-4 mr-1" /> Transactions
            {transactions.length > 0 && (
              <Badge variant="secondary" className="ml-1.5">{transactions.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tickets">

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Showing selection + Seating/GA + Transactions */}
        <div className="lg:col-span-2 space-y-6">
          {/* Showing selector */}
          <Card className="glass">
            <CardHeader>
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <Film className="h-5 w-5 text-primary" /> Select Showing
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Type-to-search, not a scrolling dropdown. A busy season puts
                  hundreds of future showings in this list, and the box office
                  is looking for one film at one time, usually with a patron
                  waiting. The title, the date and the price are all searchable,
                  so "emily fri" or "aug 24" both land. */}
              <SearchableSelect
                id="pos-showing"
                options={showingOptions}
                value={selectedShowingId}
                onChange={setSelectedShowingId}
                placeholder="Choose a showing…"
                searchPlaceholder="Search by film, date or price…"
                emptyText="No showing matches."
              />
            </CardContent>
          </Card>

          {/* Seating map or GA quantity */}
          {selectedShowingId && (
            isAssignedSeating ? (
              <Card className="glass">
                <CardHeader>
                  <CardTitle className="font-display text-lg">Seating Map</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {hasTiers && (
                    <div className="space-y-2">
                      <Label>Ticket Type</Label>
                      <Select value={selectedTierId} onValueChange={setSelectedTierId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select tier..." />
                        </SelectTrigger>
                        <SelectContent>
                          {priceTiers.map(t => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.tier_name} — ${t.price.toFixed(2)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <SeatMap
                    seats={seats}
                    takenSeatIds={takenSeatIds}
                    selectedSeats={selectedSeats}
                    onToggleSeat={toggleSeat}
                    loading={loadingSeats}
                  />
                </CardContent>
              </Card>
            ) : (
              <Card className="glass">
                <CardHeader>
                  <CardTitle className="font-display text-lg">General Admission</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {hasTiers ? (
                    // Tiered GA — one quantity row per tier
                    priceTiers.map(tier => (
                      <div key={tier.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                        <div>
                          <p className="font-medium">{tier.tier_name}</p>
                          <p className="text-xs text-muted-foreground">${tier.price.toFixed(2)} each</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setTierQuantities(prev => ({ ...prev, [tier.id]: Math.max(0, (prev[tier.id] || 0) - 1) }))}
                            disabled={(tierQuantities[tier.id] || 0) === 0}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="text-xl font-bold w-8 text-center">{tierQuantities[tier.id] || 0}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setTierQuantities(prev => ({ ...prev, [tier.id]: Math.min(gaAvailable - totalTierQuantity + (prev[tier.id] || 0), (prev[tier.id] || 0) + 1) }))}
                            disabled={totalTierQuantity >= gaAvailable}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    // Legacy single-price GA
                    <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                      <div>
                        <p className="font-medium">Tickets</p>
                        <p className="text-xs text-muted-foreground">{gaAvailable} available</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Button variant="outline" size="icon" onClick={() => setGaQuantity(q => Math.max(0, q - 1))} disabled={gaQuantity === 0}>
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="text-xl font-bold w-8 text-center">{gaQuantity}</span>
                        <Button variant="outline" size="icon" onClick={() => setGaQuantity(q => Math.min(gaAvailable, q + 1))} disabled={gaQuantity >= gaAvailable}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground text-right">{gaAvailable} seats available</p>
                </CardContent>
              </Card>
            )
          )}

          {/* Session Transactions used to sit here, under the seating map. It
              lives on the Transactions tab now — the sale in progress and the
              record of finished sales are two different jobs, and stacking them
              pushed the seat picker up the page on a busy night. */}
        </div>

        {/* Right: Patron info + Payment + Order summary */}
        {/* Nothing here is sticky, deliberately. Patron Info alone used to be
            `sticky top-20` while Payment and Order Summary scrolled as ordinary
            siblings beneath it — so it pinned partway down and the two later
            cards then slid over the top of it, because a sticky element is
            painted before siblings that come after it in the same stacking
            context. Making the whole column sticky instead would have traded
            that for a worse bug: a real order (several seat lines, tax, fee,
            donation prompt) is taller than a laptop viewport, so pinning it
            puts the Sell button off-screen with no way to reach it. The counter
            flow is short; it scrolls. */}
        <div className="space-y-6">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <User className="h-5 w-5 text-primary" /> Patron Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="patron-email">Email — where the ticket is sent</Label>
                <Input
                  id="patron-email"
                  type="email"
                  placeholder="patron@email.com"
                  value={patronEmail}
                  onChange={e => setPatronEmail(e.target.value)}
                />
              </div>
              {/* Back with COLLECT_PHONE (see @/lib/flags), and — like the
                  film-pass form, and unlike online checkout — deliberately
                  without an SMS consent line. The counter dispatches by email
                  only, because an A2P 10DLC opt-in cannot be collected by a
                  staff member typing into a field. So this number is a way to
                  reach the patron, not a delivery address, and the hint says
                  so. */}
              {COLLECT_PHONE && (
                <div className="space-y-2">
                  <Label htmlFor="patron-phone">Phone (optional)</Label>
                  <Input
                    id="patron-phone"
                    type="tel"
                    placeholder="(208) 555-1234"
                    value={patronPhone}
                    onChange={e => setPatronPhone(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    A way to reach the patron — tickets are sent by email.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <PaymentMethodSelector paymentMethod={paymentMethod} onSelect={setPaymentMethod} />

          {/* Order Summary */}
          <Card className="glass">
            <CardHeader>
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-primary" /> Order Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {ticketCount === 0 ? (
                <p className="text-muted-foreground text-sm">Select a showing and tickets to continue</p>
              ) : (
                <>
                  <p className="text-sm font-medium">{selectedShowing?.movie_title}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedShowing && formatShowtime(selectedShowing.start_time, 'MMM d, yyyy h:mm a')}
                  </p>
                  <div className="space-y-1 text-sm">
                    {hasTiers ? (
                      // Tiered summary
                      <>
                        {lineItems.map(li => (
                          <div key={li.tierId} className="flex justify-between">
                            <span>{li.tierName} × {li.seatIds ? li.seatIds.length : li.quantity}</span>
                            <span>${((li.seatIds ? li.seatIds.length : li.quantity) * li.price).toFixed(2)}</span>
                          </div>
                        ))}
                        {isAssignedSeating && selectedSeats.size > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Seats: {Array.from(selectedSeats).map(seatId => {
                              const seat = seats.find(s => s.id === seatId);
                              return seat ? `${seat.seat_row}${seat.seat_number}` : '?';
                            }).join(', ')}
                          </p>
                        )}
                      </>
                    ) : isAssignedSeating ? (
                      Array.from(selectedSeats).map(seatId => {
                        const seat = seats.find(s => s.id === seatId);
                        return seat ? (
                          <div key={seatId} className="flex justify-between">
                            <span>Row {seat.seat_row}, Seat {seat.seat_number}</span>
                            <span>${Number(selectedShowing!.ticket_price).toFixed(2)}</span>
                          </div>
                        ) : null;
                      })
                    ) : (
                      <div className="flex justify-between">
                        <span>General Admission × {gaQuantity}</span>
                        <span>${(gaQuantity * Number(selectedShowing!.ticket_price)).toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                  <div className="border-t border-border pt-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>${subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax (6%)</span>
                      <span>${tax.toFixed(2)}</span>
                    </div>
                    {processingFee > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Card processing fee</span>
                        <span>${processingFee.toFixed(2)}</span>
                      </div>
                    )}
                    {donationCents > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Donation (not taxed)</span>
                        <span>${(donationCents / 100).toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-base pt-1">
                      <span>Total</span>
                      <span className="text-primary">${chargeTotal.toFixed(2)}</span>
                    </div>
                  </div>

                  <DonationPrompt
                    variant="staff"
                    valueCents={donationCents}
                    onChange={setDonationCents}
                    disabled={selling || paymentStatus === 'processing'}
                  />

                  {/* Payment status indicator */}
                  {paymentStatus === 'processing' && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/30">
                      <Loader2 className="h-5 w-5 text-primary animate-spin" />
                      <span className="text-sm text-primary font-medium">
                        Waiting for payment on terminal...
                      </span>
                    </div>
                  )}
                  {paymentStatus === 'completed' && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/30">
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                      <span className="text-sm text-primary font-medium">
                        Payment complete!
                      </span>
                    </div>
                  )}
                  {paymentStatus === 'failed' && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      <span className="text-sm text-destructive font-medium">
                        Payment failed — try again
                      </span>
                    </div>
                  )}

                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleSell}
                    disabled={selling || paymentStatus === 'processing'}
                  >
                    {selling || paymentStatus === 'processing' ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        {paymentMethod === 'cash' ? (
                          <Banknote className="h-4 w-4 mr-1" />
                        ) : (
                          <CreditCard className="h-4 w-4 mr-1" />
                        )}
                        {paymentMethod === 'cash'
                          ? `Sell ${ticketCount} Ticket(s) — Cash $${chargeTotal.toFixed(2)}`
                          : `Charge $${chargeTotal.toFixed(2)} on Terminal`
                        }
                      </>
                    )}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
        </TabsContent>

        {/* Hidden, not deleted — the tab takes no payment (see CONCESSION_POS_ENABLED). */}
        {CONCESSION_POS_ENABLED && (
          <TabsContent value="concessions">
            <ConcessionPOS onSaleComplete={loadDailyStats} />
          </TabsContent>
        )}

        <TabsContent value="film-passes">
          <FilmPassPOS />
        </TabsContent>

        {/* The door's list, beside the till. Read-only: check-in is the
            scanner's job, and this is what staff read off while working out
            who is still to arrive. */}
        <TabsContent value="presales">
          <TodaysPresales />
        </TabsContent>

        <TabsContent value="transactions" className="space-y-6">
          {/* This session first: it is what the counter reaches for — the sale
              just taken, to refund it or re-send a confirmation to a mistyped
              address. It is in-memory and empties on reload, which is why it
              says so rather than looking like a day with no sales. */}
          <TransactionHistory
            transactions={transactions}
            onRefund={(tx) => { setRefundingTx(tx); setRefundDialogOpen(true); }}
            onResend={openResend}
          />

          {/* The full Square log is admin-only: `square-transactions` gates on
              has_role(caller,'admin') because it returns the theatre's whole
              revenue history along with buyer names, emails and payment ids.
              Rendering it for staff would only produce a 403 where a table
              should be, so say what is true instead. */}
          {isAdmin
            ? <TransactionsTab />
            : (
              <Card className="glass">
                <CardContent className="p-4 text-sm text-muted-foreground">
                  The full transaction log — every Square sale, searchable, with
                  refunds and reconciliation — is on the admin dashboard under
                  Analytics → Transactions, and needs an admin account.
                </CardContent>
              </Card>
            )}
        </TabsContent>
      </Tabs>

      {/* Mounted only while open, so the camera exists exactly as long as the
          scanner is on screen. The POS underneath keeps its state — the sale in
          progress is still there when staff come back. */}
      {scannerOpen && <TicketScanner onExit={() => setScannerOpen(false)} />}

      {/* Resend the ticket confirmation — the counter's recovery path for a
          mistyped address, and for a send that failed after the money was
          taken. */}
      <Dialog open={resendDialogOpen} onOpenChange={setResendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              Resend Confirmation
            </DialogTitle>
            <DialogDescription>
              Sends the tickets again, to whatever is entered below. Correct the
              address here if the first one was wrong.
            </DialogDescription>
          </DialogHeader>
          {resendingTx && (
            <div className="space-y-4 py-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Movie</span>
                <span className="font-medium">{resendingTx.movieTitle}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Seats</span>
                <span className="font-medium">{resendingTx.seatLabels.join(', ')}</span>
              </div>
              <div className="space-y-2">
                <Label htmlFor="resend-email">Email</Label>
                <Input
                  id="resend-email"
                  type="email"
                  placeholder="patron@example.com"
                  value={resendEmail}
                  onChange={e => setResendEmail(e.target.value)}
                />
              </div>
              {COLLECT_PHONE && (
                <div className="space-y-2">
                  <Label htmlFor="resend-phone">Phone</Label>
                  <Input
                    id="resend-phone"
                    type="tel"
                    placeholder="(208) 555-1234"
                    value={resendPhone}
                    onChange={e => setResendPhone(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Contact only — the resend goes to the email address.
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setResendDialogOpen(false)} disabled={resending}>
              Cancel
            </Button>
            <Button onClick={handleResend} disabled={resending}>
              {resending ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Sending...</>
              ) : (
                <><Send className="h-4 w-4 mr-1" /> Resend</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund confirmation dialog */}
      <Dialog open={refundDialogOpen} onOpenChange={setRefundDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-destructive" />
              Confirm Refund
            </DialogTitle>
            <DialogDescription>
              This will cancel the tickets and free up the seats. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {refundingTx && (
            <div className="space-y-3 py-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Movie</span>
                <span className="font-medium">{refundingTx.movieTitle}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Seats</span>
                <span className="font-medium">{refundingTx.seatLabels.join(', ')}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Payment</span>
                <Badge variant="outline">{refundingTx.paymentMethod === 'cash' ? 'Cash' : 'Card'}</Badge>
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-border pt-2">
                <span>Refund Amount</span>
                <span className="text-destructive">${refundingTx.total.toFixed(2)}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundDialogOpen(false)} disabled={refunding}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRefund} disabled={refunding}>
              {refunding ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing...</>
              ) : (
                <><RotateCcw className="h-4 w-4 mr-1" /> Process Refund</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
