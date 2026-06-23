import { useEffect, useState, useCallback } from 'react';
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
import { TimeClockWidget } from '@/components/pos/TimeClockWidget';
import { type Seat, type PriceTier, type TicketLineItem, buildTicketRows, computeLineItemTotals, computeOrderTotals, computeProcessingFee, TAX_RATE } from '@/lib/booking';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  const { isAdmin, loading: authLoading } = useAuth();
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

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('idle');
  const [squareCheckoutId, setSquareCheckoutId] = useState<string | null>(null);
  const [isSimulated, setIsSimulated] = useState(false);

  const [transactions, setTransactions] = useState<SessionTransaction[]>([]);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundingTx, setRefundingTx] = useState<SessionTransaction | null>(null);
  const [refunding, setRefunding] = useState(false);

  const [dailyStats, setDailyStats] = useState({ revenue: 0, ticketCount: 0, refundCount: 0 });

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
    if (!isAdmin) { navigate('/'); return; }

    loadDailyStats();

    async function loadShowings() {
      const { data } = await supabase
        .from('showings')
        .select('id, start_time, ticket_price, total_seats, requires_seat_selection, movies(title, pass_processing_fee)')
        .eq('is_active', true)
        .gte('start_time', new Date().toISOString())
        .order('start_time');

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
  }, [isAdmin, authLoading, navigate]);

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

      if (currentShowing?.requires_seat_selection) {
        const [seatsRes, ticketsRes] = await Promise.all([
          supabase.from('seats').select('*').order('seat_row').order('seat_number'),
          supabase.from('tickets').select('seat_id').eq('showing_id', selectedShowingId).eq('status', 'confirmed'),
        ]);
        setSeats(seatsRes.data || []);
        setTakenSeatIds(new Set((ticketsRes.data || []).map(t => t.seat_id)));
      } else {
        const { count } = await supabase
          .from('tickets')
          .select('id', { count: 'exact' })
          .eq('showing_id', selectedShowingId)
          .eq('status', 'confirmed');
        setGaTicketsSold(count || 0);
      }
      setLoadingSeats(false);
    }
    loadData();
  }, [selectedShowingId, showings]);

  const selectedShowing = showings.find(s => s.id === selectedShowingId);
  const isAssignedSeating = selectedShowing?.requires_seat_selection;

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

  // Buyer-paid Square processing fee, only when host opted in AND the buyer
  // is paying by card on the Terminal. Cash sales never carry the surcharge.
  const passProcessingFee =
    !!selectedShowing?.pass_processing_fee && paymentMethod === 'card' && total > 0;
  const processingFee = passProcessingFee ? computeProcessingFee(total, 'in_person').fee : 0;
  const grandTotal = Math.round((total + processingFee) * 100) / 100;

  const toggleSeat = (seatId: string) => {
    if (takenSeatIds.has(seatId)) return;
    setSelectedSeats(prev => {
      const next = new Set(prev);
      if (next.has(seatId)) next.delete(seatId);
      else next.add(seatId);
      return next;
    });
  };

  const createTickets = useCallback(async (method: PaymentMethod): Promise<string[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const ticketRows = buildTicketRows({
      lineItems: hasTiers ? lineItems : undefined,
      selectedSeats: !hasTiers ? selectedSeats : undefined,
      quantity: !hasTiers && !isAssignedSeating ? gaQuantity : undefined,
      userId: user.id,
      showingId: selectedShowingId,
      ticketPrice: !hasTiers ? selectedShowing!.ticket_price : undefined,
      paymentMethod: method,
    });

    const { data, error } = await supabase.from('tickets').insert(ticketRows).select('id');
    if (error) throw error;
    return (data || []).map(t => t.id);
  }, [selectedSeats, gaQuantity, isAssignedSeating, selectedShowingId, selectedShowing, hasTiers, lineItems]);

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

  const addTransaction = useCallback((ticketIds: string[], method: PaymentMethod) => {
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
      movieTitle: selectedShowing?.movie_title || 'Unknown',
      seatLabels,
      total,
      paymentMethod: method,
      timestamp: new Date(),
      refunded: false,
    };
    setTransactions(prev => [tx, ...prev]);
  }, [selectedSeats, seats, selectedShowing, total, isAssignedSeating, gaQuantity, hasTiers, lineItems]);

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
    setPaymentStatus('idle');
    setSquareCheckoutId(null);
    setIsSimulated(false);
  }, []);

  const handleCashSale = async () => {
    setSelling(true);
    try {
      const ticketIds = await createTickets('cash');
      addTransaction(ticketIds, 'cash');
      toast.success(`${ticketCount} ticket(s) sold (cash)!`, { duration: 5000 });
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
      const amountCents = Math.round(grandTotal * 100);

      const { data, error } = await supabase.functions.invoke('square-terminal', {
        body: {
          action: 'create_checkout',
          amount_cents: amountCents,
          note: `${selectedShowing!.movie_title} — ${ticketCount} ticket(s)`,
          idempotency_key: idempotencyKey,
        },
      });

      if (error) throw new Error(error.message || 'Failed to create checkout');

      const checkoutId = data.checkout?.id;
      setSquareCheckoutId(checkoutId);
      setIsSimulated(data.simulated || false);

      if (data.simulated || data.checkout?.status === 'COMPLETED') {
        setPaymentStatus('completed');
        const ticketIds = await createTickets('card');
        addTransaction(ticketIds, 'card');
        toast.success(
          `${ticketCount} ticket(s) sold (card)! ${data.simulated ? '(Sandbox simulation)' : ''}`,
          { duration: 5000 }
        );
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
          const ticketIds = await createTickets('card');
          addTransaction(ticketIds, 'card');
          toast.success(`Payment complete! ${ticketCount} ticket(s) sold.`);
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
  }, [createTickets, addTransaction, resetForm, refreshAfterSale, ticketCount]);

  const handleSell = () => {
    if (!selectedShowingId || ticketCount === 0) {
      toast.error('Select a showing and at least one ticket');
      return;
    }
    if (!patronEmail && !patronPhone) {
      toast.error('Enter patron email or phone for digital ticket delivery');
      return;
    }

    if (paymentMethod === 'cash') {
      handleCashSale();
    } else {
      handleCardSale();
    }
  };

  const handleRefund = async () => {
    if (!refundingTx) return;
    setRefunding(true);
    try {
      const { error } = await supabase
        .from('tickets')
        .update({ status: 'refunded' })
        .in('id', refundingTx.ticketIds);

      if (error) throw error;

      setTransactions(prev =>
        prev.map(tx => tx.id === refundingTx.id ? { ...tx, refunded: true } : tx)
      );

      toast.success(`Refunded ${refundingTx.seatLabels.length} ticket(s) — $${refundingTx.total.toFixed(2)}`);
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
        <TabsList className="grid w-full grid-cols-3 max-w-sm">
          <TabsTrigger value="tickets"><ShoppingCart className="h-4 w-4 mr-1" /> Tickets</TabsTrigger>
          <TabsTrigger value="concessions"><UtensilsCrossed className="h-4 w-4 mr-1" /> Concessions</TabsTrigger>
          <TabsTrigger value="film-passes"><Ticket className="h-4 w-4 mr-1" /> Film Passes</TabsTrigger>
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
              <Select value={selectedShowingId} onValueChange={setSelectedShowingId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a showing..." />
                </SelectTrigger>
                <SelectContent>
                  {showings.map(s => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.movie_title} — {format(new Date(s.start_time), 'MMM d, h:mm a')} — ${Number(s.ticket_price).toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

          <TransactionHistory
            transactions={transactions}
            onRefund={(tx) => { setRefundingTx(tx); setRefundDialogOpen(true); }}
          />
        </div>

        {/* Right: Patron info + Payment + Order summary */}
        <div className="space-y-6">
          <Card className="glass sticky top-20">
            <CardHeader>
              <CardTitle className="font-display text-lg flex items-center gap-2">
                <User className="h-5 w-5 text-primary" /> Patron Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="patron-email">Email</Label>
                <Input
                  id="patron-email"
                  type="email"
                  placeholder="patron@email.com"
                  value={patronEmail}
                  onChange={e => setPatronEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="patron-phone">Phone (optional)</Label>
                <Input
                  id="patron-phone"
                  type="tel"
                  placeholder="(208) 555-1234"
                  value={patronPhone}
                  onChange={e => setPatronPhone(e.target.value)}
                />
              </div>
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
                    {selectedShowing && format(new Date(selectedShowing.start_time), 'MMM d, yyyy h:mm a')}
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
                    <div className="flex justify-between font-bold text-base pt-1">
                      <span>Total</span>
                      <span className="text-primary">${total.toFixed(2)}</span>
                    </div>
                  </div>

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
                          ? `Sell ${ticketCount} Ticket(s) — Cash`
                          : `Charge $${total.toFixed(2)} on Terminal`
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

        <TabsContent value="concessions">
          <ConcessionPOS onSaleComplete={loadDailyStats} />
        </TabsContent>

        <TabsContent value="film-passes">
          <FilmPassPOS />
        </TabsContent>
      </Tabs>

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
