import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeFunction } from '@/lib/functions';
import { SquareCardForm, type SquareCardFormHandle } from '@/components/SquareCardForm';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Film, Calendar, Clock, Check, Minus, Plus, MapPin, Sparkles, Music, CreditCard } from 'lucide-react';
import { SeatMap } from '@/components/SeatMap';
import { GuestCheckoutForm } from '@/components/GuestCheckoutForm';
import { DonationPrompt } from '@/components/DonationPrompt';
import { type Seat, type PriceTier, computeSeatTotals, computeOrderTotals, computeLineItemTotals, computeProcessingFee, type TicketLineItem } from '@/lib/booking';
import { ProductionMedia, ProductionMetaBadges } from '@/components/ProductionMedia';
import { SEO } from '@/components/SEO';
import { syncMailchimpProfile, subscribeToMailchimp } from '@/lib/mailchimp';
import { ticketPagePath } from '@/lib/tickets';
import { fetchShowingAvailability } from '@/lib/availability';
import { formatShowtime } from '@/lib/datetime';
import {
  NO_TICKET_REQUIRED_MESSAGE,
  SHOWING_PASSED_MESSAGE,
  isPast,
  needsNoTicket,
} from '@/lib/purchasable';
import { SITE_URL } from '@/lib/site';
import { htmlToPlainText, toMetaDescription } from '@/lib/richText';
import { RichText } from '@/components/RichText';

type ProductionType = 'movie' | 'event' | 'concert';

function getProductionMeta(type: ProductionType) {
  switch (type) {
    case 'movie': return { icon: Film, label: 'Movie' };
    case 'event': return { icon: Sparkles, label: 'Event' };
    case 'concert': return { icon: Music, label: 'Concert' };
  }
}

/**
 * Shown in place of the ticket picker once there is nothing left to pick.
 *
 * The reopening note is not a hedge: checkout writes rows as pending before
 * charging, and an abandoned pending row stops holding its seat after
 * ticket_hold_window(), so capacity genuinely can come back.
 */
function SoldOutNotice({ assigned }: { assigned: boolean }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center"
    >
      <p className="font-display text-base font-semibold text-destructive">Sold Out</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {assigned
          ? 'Every seat for this showing has been taken.'
          : 'All tickets for this showing have been sold.'}{' '}
        Seats occasionally reopen when an unfinished checkout expires, so it is worth checking back —
        or ask the box office about availability.
      </p>
    </div>
  );
}

/**
 * Shown in place of the entire buy flow once the showing is over.
 *
 * Replaces the ticket picker, the seat map and the order summary rather than
 * disabling them — you cannot buy a ticket to something that has already
 * happened, and a greyed-out button invites the reader to work out why. The
 * page above it stays: title, poster, showtime, cast. Past programming is
 * worth keeping readable at a theatre with a hundred years of it.
 *
 * The rule is src/lib/purchasable.ts. The server refuses the sale
 * independently — see supabase/functions/_shared/pricing.ts — so this is
 * presentation, not enforcement.
 */
function PassedNotice({ startTime }: { startTime: string }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-border bg-secondary/40 p-6 text-center"
    >
      <p className="font-display text-lg font-semibold">This showing has passed.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        It played on {formatShowtime(startTime, "EEEE, MMMM d, yyyy 'at' h:mm a")}. Tickets are no
        longer available.
      </p>
      <Button variant="outline" className="mt-4" asChild>
        <Link to="/">See what&rsquo;s playing now</Link>
      </Button>
    </div>
  );
}

/**
 * A free showing that issues no ticket — doors open, walk in.
 *
 * Keeps the two-column shape of the buy flow rather than replacing it with a
 * notice (Tom, 2026-08-27). The quantity stepper is gone because there is no
 * number to pick, no seat to hold and no capacity to count down; the order
 * summary is open from the start because there is nothing to add to it, so
 * "add tickets to continue" would be an instruction with nothing to follow.
 * It states the one fact it has, which is Free.
 *
 * The donation here is a real payment rather than a link away, and it cannot
 * reuse the mechanism the paid page uses. There, DonationPrompt is a cart
 * add-on: it sets an amount that rides on the ticket charge, and the server
 * bundles it into the same Square payment. There is no charge on this page for
 * it to ride on, so choosing an amount opens the standalone path /donate uses
 * (`square-donation`) — which needs a name, an email for the receipt, and its
 * own card. Those fields stay hidden until somebody actually chooses to give,
 * so a visitor who only wants the showtime is never asked for anything.
 */
function FreeAdmissionPanel({
  startTime,
  venueName,
  donationCents,
  onDonationChange,
  defaultEmail,
}: {
  startTime: string;
  venueName?: string | null;
  donationCents: number;
  onDonationChange: (cents: number) => void;
  defaultEmail?: string | null;
}) {
  const cardRef = useRef<SquareCardFormHandle>(null);
  const [cardReady, setCardReady] = useState(false);
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState(defaultEmail ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [thankedCents, setThankedCents] = useState<number | null>(null);

  const giving = donationCents > 0;
  const amount = (donationCents / 100).toFixed(2);

  const handleDonate = async () => {
    if (!donorName.trim() || !donorEmail.trim()) {
      toast.error('Your name and email are required for the receipt.');
      return;
    }
    if (!cardRef.current) {
      toast.error('Card form is not ready yet — give it a moment.');
      return;
    }

    setSubmitting(true);
    try {
      let token: string;
      try {
        token = await cardRef.current.tokenize();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Please check your card details.');
        return;
      }

      const data = await invokeFunction<{ success: boolean; receiptUrl: string | null }>(
        'square-donation',
        {
          action: 'create_payment',
          sourceId: token,
          amountCents: donationCents,
          donorName: donorName.trim(),
          donorEmail: donorEmail.trim(),
          donorPhone: null,
          dedicationType: null,
          dedicateTo: null,
          notifyName: null,
          notifyEmail: null,
          message: null,
        },
      );

      if (!data?.success) {
        toast.error('Donation could not be processed.');
        return;
      }

      setThankedCents(donationCents);
      onDonationChange(0);
      toast.success(`Thank you for your $${amount} gift!`);
    } catch (err) {
      console.error('Donation submit error:', err);
      toast.error(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6 min-w-0">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display text-lg">Admission</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="font-display text-2xl text-success">Free — no ticket needed</p>
            <p className="text-sm text-muted-foreground">
              Admission is free and open to everyone. There is nothing to buy or reserve —
              just come to the theatre and find a seat. Seating is first-come,
              first-served.
            </p>
            <div className="flex flex-col gap-1.5 text-sm border-t border-border pt-4">
              <span className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-accent" />
                {formatShowtime(startTime, "EEEE, MMMM d, yyyy 'at' h:mm a")}
              </span>
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-accent" />
                {venueName || 'Kenworthy Performing Arts Centre'} · 508 S Main St, Moscow, ID
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div id="order-summary" className="scroll-mt-24">
        <Card className="glass lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle className="font-display text-lg">Order Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Admission</span>
                <span className="text-success font-medium">Free</span>
              </div>
              {giving && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Donation (not taxed)</span>
                  <span>${amount}</span>
                </div>
              )}
            </div>

            <div className="border-t border-border pt-3">
              <div className="flex justify-between font-bold text-base">
                <span>Total</span>
                <span className={giving ? 'text-primary' : 'text-success'}>
                  {giving ? `$${amount}` : 'Free'}
                </span>
              </div>
            </div>

            {thankedCents !== null && !giving && (
              <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
                Thank you for your ${(thankedCents / 100).toFixed(2)} gift — a receipt is on
                its way.
              </p>
            )}

            <DonationPrompt
              valueCents={donationCents}
              onChange={onDonationChange}
              disabled={submitting}
            />

            {giving ? (
              <>
                {/* Only once somebody has chosen to give. A walk-in visitor who
                    just wants the showtime is never asked for a name, an email
                    or a card. */}
                <div className="border-t border-border pt-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="free-donor-name">Your name</Label>
                    <Input
                      id="free-donor-name"
                      value={donorName}
                      onChange={(e) => setDonorName(e.target.value)}
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="free-donor-email">Email (for receipt)</Label>
                    <Input
                      id="free-donor-email"
                      type="email"
                      value={donorEmail}
                      onChange={(e) => setDonorEmail(e.target.value)}
                      disabled={submitting}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-3 flex items-center gap-1">
                      <CreditCard className="h-4 w-4" /> Payment
                    </p>
                    <SquareCardForm
                      ref={cardRef}
                      source="square-donation"
                      onReadyChange={setCardReady}
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleDonate}
                  disabled={submitting || !cardReady}
                >
                  <Check className="h-4 w-4 mr-1" />
                  {submitting ? 'Processing...' : `Donate $${amount}`}
                </Button>
                <p className="text-sm text-muted-foreground text-center">
                  Payments are processed securely by Square. Your card details never reach
                  our servers.
                </p>
              </>
            ) : (
              <>
                {/* Where the Reserve button would be. Deliberately not a
                    disabled button: there is no action being withheld, so
                    something greyed out would read as a step the visitor has
                    failed to unlock rather than as the answer. */}
                <div className="w-full rounded-md border border-success/40 bg-success/10 py-3 text-center">
                  <p className="font-display text-lg text-success">Free</p>
                  <p className="text-sm text-muted-foreground">Nothing to pay — just turn up.</p>
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  Nights like this one are paid for by people who give. Add a gift above, or{' '}
                  <Link
                    to="/donate"
                    className="text-primary underline underline-offset-4 hover:no-underline"
                  >
                    give another way
                  </Link>
                  .
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function Showing() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [showing, setShowing] = useState<any>(null);
  const [production, setProduction] = useState<any>(null);
  const [productionType, setProductionType] = useState<ProductionType>('movie');
  const [venue, setVenue] = useState<any>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [takenSeatIds, setTakenSeatIds] = useState<Set<string>>(new Set());
  const [selectedSeats, setSelectedSeats] = useState<Set<string>>(new Set());
  const [gaQuantity, setGaQuantity] = useState(0);
  const [ticketsSold, setTicketsSold] = useState(0);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  // Optional gift added to this purchase. Zero unless the buyer says otherwise;
  // it rides on the same card charge and is never taxed.
  const [donationCents, setDonationCents] = useState(0);

  // Card payment for signed-in buyers. Guests get their own card form inside
  // GuestCheckoutForm, alongside the contact fields they still have to fill in.
  const cardRef = useRef<SquareCardFormHandle>(null);
  const [cardReady, setCardReady] = useState(false);

  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [tierQuantities, setTierQuantities] = useState<Record<string, number>>({});
  const [selectedTierId, setSelectedTierId] = useState<string>('');

  // Per-seat tier mapping for assigned seating: seats.id -> tier (with color)
  const [seatTierMap, setSeatTierMap] = useState<Record<string, { tierId: string; tierName: string; price: number; color: string }>>({});

  const hasTiers = priceTiers.length > 0;
  const isAssignedSeating = showing?.requires_seat_selection;
  const totalSeats = showing?.total_seats || 200;
  const gaAvailable = Math.max(0, totalSeats - ticketsSold);

  // Sold out is a different question for each seating model: general admission
  // runs out of capacity, assigned seating runs out of unclaimed seats. Guard on
  // seats.length so an assigned showing whose seat map has not loaded yet does
  // not read as sold out for a moment.
  const soldOut = isAssignedSeating
    ? seats.length > 0 && seats.every(s => takenSeatIds.has(s.id))
    : gaAvailable <= 0;

  useEffect(() => {
    async function load() {
      if (!id) return;
      const [showingRes, tiersRes] = await Promise.all([
        supabase.from('showings').select('*').eq('id', id).single(),
        supabase.from('showing_price_tiers').select('*').eq('showing_id', id).eq('is_active', true).order('display_order'),
      ]);

      const s = showingRes.data;
      if (!s) { navigate('/'); return; }
      setShowing(s);

      const tiers: PriceTier[] = (tiersRes.data || []).map((t: any) => ({
        id: t.id,
        tier_name: t.tier_name,
        price: Number(t.price),
        display_order: t.display_order,
        color: t.color || null,
      }));
      setPriceTiers(tiers);
      if (tiers.length > 0) {
        setSelectedTierId(tiers[0].id);
        const initial: Record<string, number> = {};
        tiers.forEach(t => initial[t.id] = 0);
        setTierQuantities(initial);
      }

      let type: ProductionType = 'movie';
      let productionPromise;
      if (s.event_id) {
        type = 'event';
        productionPromise = supabase.from('events').select('*').eq('id', s.event_id).single();
      } else if (s.live_performance_id) {
        type = 'concert';
        productionPromise = supabase.from('live_performances').select('*').eq('id', s.live_performance_id).single();
      } else {
        productionPromise = supabase
          .from('movies')
          .select('id,title,description,poster_url,duration_minutes,rating,genre,is_active,created_at,updated_at,trailer_url,is_featured,release_year,release_label,pass_processing_fee')
          .eq('id', s.movie_id)
          .single();
      }
      setProductionType(type);

      const venuePromise = s.venue_id
        ? supabase.from('venues').select('*').eq('id', s.venue_id).single()
        : Promise.resolve({ data: null });

      if (s.requires_seat_selection) {
        const [prodRes, venueRes, seatsRes, availability] = await Promise.all([
          productionPromise,
          venuePromise,
          supabase.from('seats').select('*').order('seat_row').order('seat_number'),
          fetchShowingAvailability(id),
        ]);
        setProduction(prodRes.data);
        setVenue(venueRes.data);
        setSeats(seatsRes.data || []);
        if (availability) {
          setTakenSeatIds(availability.takenSeatIds);
          setTicketsSold(availability.held);
        }

        // Resolve per-seat tier mapping. showing_seat_tiers links venue_seats
        // to showing_price_tiers. The customer seat picker uses the global
        // `seats` table — match by row+section+number so we can overlay each
        // seat's tier name, price, and color.
        const tierRows = (tiersRes.data || []) as any[];
        if (tierRows.length > 0) {
          const tierById = new Map<string, { tier_name: string; price: number; color: string }>();
          for (const t of tierRows) {
            tierById.set(t.id, { tier_name: t.tier_name, price: Number(t.price), color: t.color || 'hsl(var(--primary))' });
          }
          const { data: seatTiers } = await supabase
            .from('showing_seat_tiers')
            .select('tier_id, venue_seats!showing_seat_tiers_venue_seat_id_fkey(seat_row, seat_number, section)')
            .eq('showing_id', id);

          const seatByKey = new Map<string, string>();
          for (const seat of (seatsRes.data || []) as any[]) {
            const sec = (seat.section || 'center').toLowerCase();
            seatByKey.set(`${seat.seat_row}|${sec}|${seat.seat_number}`, seat.id);
          }
          const map: Record<string, { tierId: string; tierName: string; price: number; color: string }> = {};
          for (const row of (seatTiers || []) as any[]) {
            const vs = row.venue_seats;
            if (!vs) continue;
            const sec = (vs.section || 'center').toLowerCase();
            const seatId = seatByKey.get(`${vs.seat_row}|${sec}|${vs.seat_number}`);
            const meta = tierById.get(row.tier_id);
            if (seatId && meta) {
              map[seatId] = { tierId: row.tier_id, tierName: meta.tier_name, price: meta.price, color: meta.color };
            }
          }
          setSeatTierMap(map);
        }
      } else {
        const [prodRes, venueRes, availability] = await Promise.all([
          productionPromise,
          venuePromise,
          fetchShowingAvailability(id),
        ]);
        setProduction(prodRes.data);
        setVenue(venueRes.data);
        if (availability) setTicketsSold(availability.held);
      }
      setLoading(false);
    }
    load();
  }, [id, navigate]);

  const toggleSeat = (seatId: string) => {
    if (takenSeatIds.has(seatId)) return;
    setSelectedSeats(prev => {
      const next = new Set(prev);
      if (next.has(seatId)) next.delete(seatId);
      else next.add(seatId);
      return next;
    });
  };

  const updateTierQty = (tierId: string, delta: number) => {
    setTierQuantities(prev => {
      const current = prev[tierId] || 0;
      const next = Math.max(0, Math.min(gaAvailable, current + delta));
      return { ...prev, [tierId]: next };
    });
  };

  // Compute totals
  let ticketCount = 0;
  let subtotal = 0;
  let tax = 0;
  let total = 0;

  if (hasTiers) {
    if (isAssignedSeating) {
      // Assigned seating + tiers: each seat is priced by its own tier
      // mapping. Seats with no mapping fall back to the lowest tier so we
      // never give away a free ticket.
      const fallback = priceTiers.reduce((m, t) => (t.price < m.price ? t : m), priceTiers[0]);
      ticketCount = selectedSeats.size;
      const seatPrices = Array.from(selectedSeats).map(
        seatId => seatTierMap[seatId]?.price ?? fallback.price,
      );
      const result = computeSeatTotals(seatPrices);
      subtotal = result.subtotal;
      tax = result.tax;
      total = result.total;
    } else {
      // GA + tiers: per-tier quantities
      const items: TicketLineItem[] = priceTiers
        .filter(t => (tierQuantities[t.id] || 0) > 0)
        .map(t => ({ tierId: t.id, tierName: t.tier_name, price: t.price, quantity: tierQuantities[t.id] }));
      const result = computeLineItemTotals(items);
      ticketCount = result.totalCount;
      subtotal = result.subtotal;
      tax = result.tax;
      total = result.total;
    }
  } else {
    // No tiers — legacy single price
    ticketCount = isAssignedSeating ? selectedSeats.size : gaQuantity;
    const result = computeOrderTotals(ticketCount, showing?.ticket_price || 0);
    subtotal = result.subtotal;
    tax = result.tax;
    total = result.total;
  }

  // Standard ticket sales carry no processing fee — the buyer pays ticket price
  // plus tax and the theatre absorbs Square's cut. This stays only for the
  // rental exception, where a promoter has agreed their buyers carry the fee;
  // `pass_processing_fee` is false on every production unless someone sets it.
  const passProcessingFee = !!production?.pass_processing_fee && total > 0;
  const processingFee = passProcessingFee ? computeProcessingFee(total, 'online').fee : 0;
  const grandTotal = Math.round((total + processingFee) * 100) / 100;
  // The gift is added to the charge after tax and is never taxed — the tax line
  // above is computed from ticket rows alone and this does not touch it. The
  // server does the same arithmetic and its answer is the one that is charged.
  const chargeTotal = Math.round(grandTotal * 100 + donationCents) / 100;
  // A free ($0) showing has no card step: Square rejects a $0 charge, and the
  // server skips it, so the browser must not ask for a card or send a token.
  // A free showing with a gift attached does have money to move, so it does.
  const isFree = chargeTotal <= 0;

  /**
   * What the buyer asked for, as seats and tiers — never as prices.
   *
   * The server re-derives every amount from these descriptors, so tampering
   * with this list can only change *which* tickets are bought, not what they
   * cost. The client's totals below are for display.
   */
  const buildTicketDescriptors = () => {
    const descriptors: { seat_id?: string; tier_id?: string }[] = [];

    if (hasTiers) {
      if (isAssignedSeating) {
        const fallback = priceTiers.reduce((m, t) => (t.price < m.price ? t : m), priceTiers[0]);
        for (const seatId of selectedSeats) {
          descriptors.push({ seat_id: seatId, tier_id: seatTierMap[seatId]?.tierId ?? fallback.id });
        }
      } else {
        for (const tier of priceTiers) {
          const qty = tierQuantities[tier.id] || 0;
          for (let i = 0; i < qty; i++) descriptors.push({ tier_id: tier.id });
        }
      }
    } else if (isAssignedSeating) {
      for (const seatId of selectedSeats) descriptors.push({ seat_id: seatId });
    } else {
      for (let i = 0; i < gaQuantity; i++) descriptors.push({});
    }

    return descriptors;
  };

  // One key per purchase attempt. Kept across a repeated submit so the server
  // returns the order it already made instead of charging twice; replaced after
  // a failure, because Square replays the *original* response for a reused key
  // — which would mean a corrected card getting the old decline back.
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  const submitPurchase = async (opts: {
    sourceId?: string;
    guest?: {
      name: string;
      email: string;
      phone: string;
      newsletter: boolean;
      smsConsent: boolean;
    };
  }) => {
    // A tab left open across the end of the show still holds a rendered buy
    // button: `hasPassed` is computed at render time and nothing re-renders on
    // a timer. The server refuses this anyway (see _shared/pricing.ts), so
    // this exists only to give that case the same sentence as the page rather
    // than a checkout error.
    if (isPast(showing, production)) {
      toast.error(SHOWING_PASSED_MESSAGE);
      return;
    }

    // The same stale-tab case for the walk-in state: an admin flips a free
    // screening to "no ticket needed" while this page is open, and the
    // rendered Reserve button outlives the change. The server refuses it
    // anyway (_shared/pricing.ts) and so does the trigger; this is here so
    // that case gets the page's own sentence rather than a checkout error.
    if (needsNoTicket(showing)) {
      toast.error(NO_TICKET_REQUIRED_MESSAGE);
      return;
    }

    setPurchasing(true);
    try {
      const data = await invokeFunction<{
        success: boolean;
        order_token: string;
        ticket_count: number;
      }>('ticket-checkout', {
        action: 'create_purchase',
        showing_id: id,
        tickets: buildTicketDescriptors(),
        payment_method: 'card',
        donation_cents: donationCents,
        source_id: opts.sourceId,
        idempotency_key: idempotencyKeyRef.current,
        name: opts.guest?.name,
        email: opts.guest?.email || undefined,
        phone: opts.guest?.phone || undefined,
        // Sent as its own field rather than inferred from `phone` being
        // present. A number typed into the box and not consented to must not be
        // texted, and there is no way for the server to tell those apart from
        // the number alone. A signed-in staff purchase sends no guest block at
        // all, so this is undefined there and the server treats it as no
        // consent given.
        sms_consent: opts.guest?.smsConsent === true,
      });

      if (!data?.success) throw new Error('Checkout failed');

      // "1 ticket" / "2 tickets", not "ticket(s)". This was the last place on
      // the site that punted on the plural with parentheses.
      const bought = data.ticket_count === 1 ? '1 ticket' : `${data.ticket_count} tickets`;
      toast.success(
        donationCents > 0
          ? `${bought} purchased — and thank you for your $${(donationCents / 100).toFixed(2)} gift!`
          : `${bought} purchased!`,
      );

      // Fire-and-forget marketing sync (the order itself is recorded
      // server-side by the checkout function).
      //
      // Two paths, because there are two kinds of buyer. A signed-in one has a
      // profile we can enrich — lifetime spend, favourite genre, interest
      // groups — and `syncMailchimpProfile` reads all of it under their own
      // session. A guest has none of that: no session to read a profile with,
      // and `app_config.mailchimp_interests` is not anonymously readable, so
      // the interest-group IDs cannot be resolved either. What a guest does
      // have is the address they just typed and an explicit answer about
      // whether they want email, so they get a plain tagged subscribe.
      //
      // This branch is why the checkbox exists. Before, tagging rode on the
      // signed-in buyer's `marketing_opt_in`; with no patron logins that
      // condition is never true and ticket buyers stopped reaching Mailchimp at
      // all. Consent lives in Mailchimp rather than `profiles.marketing_opt_in`
      // — the same place the footer NewsletterSignup form puts an anonymous
      // visitor's, since neither has a session to write a profile row with.
      const kind =
        productionType === 'movie' ? 'Films'
        : productionType === 'event' ? 'Special Events'
        : 'Live Performances';
      try {
        if (user) {
          void syncMailchimpProfile({
            extraTags: ['ticket-buyer'],
            source: 'showing-checkout',
            addInterests: [kind as any],
          });
        } else if (opts.guest?.newsletter && opts.guest.email) {
          const [first, ...rest] = opts.guest.name.trim().split(/\s+/);
          void subscribeToMailchimp({
            email: opts.guest.email,
            first_name: first ?? '',
            last_name: rest.join(' '),
            // Interests need IDs a guest cannot read, so the production type
            // rides along as a tag instead — same signal, anonymous-safe.
            tags: ['ticket-buyer', kind.toLowerCase().replace(/\s+/g, '-')],
            source: 'showing-checkout',
          });
        }
      } catch { /* noop — marketing must never fail a purchase */ }

      // Land the buyer on the tickets they just bought. Delivery is
      // fire-and-forget, so this is the one moment we can be certain they can
      // see them.
      //
      // Always the public token page, signed in or not. Patrons have no login,
      // so `/my-tickets` would be a page they can never open; and a staff
      // member testing a purchase wants to see the ticket they just made, not
      // their own empty list. One destination, no session required — the same
      // page the confirmation email links to.
      if (data.order_token) navigate(ticketPagePath(data.order_token));
    } catch (err: any) {
      // A failed attempt must not reuse its key.
      idempotencyKeyRef.current = crypto.randomUUID();
      toast.error(err.message || 'Failed to purchase tickets');

      // Every rejection on availability grounds — a seat taken a moment ago, or
      // the last tickets going to someone else — means this page is now showing
      // stale availability. Re-read it so the seat map greys out the seat that
      // was just lost and the quantity ceiling drops, instead of leaving the
      // buyer to retry the identical order and be refused identically.
      const availability = await fetchShowingAvailability(id!);
      if (availability) {
        setTakenSeatIds(availability.takenSeatIds);
        setTicketsSold(availability.held);
        setSelectedSeats(prev => {
          const next = new Set(prev);
          for (const seatId of prev) {
            if (availability.takenSeatIds.has(seatId)) next.delete(seatId);
          }
          return next;
        });
        setGaQuantity(q => Math.min(q, availability.available));
        setTierQuantities(prev => {
          // Trim the tier spread down to what is actually left, largest tiers
          // first, so the running total can never exceed the new ceiling.
          let budget = availability.available;
          const next: Record<string, number> = {};
          for (const tier of priceTiers) {
            const want = prev[tier.id] || 0;
            const give = Math.min(want, budget);
            next[tier.id] = give;
            budget -= give;
          }
          return next;
        });
      }
    } finally {
      setPurchasing(false);
    }
  };

  const handleGuestPurchase = (
    guestInfo: {
      name: string;
      email: string;
      phone: string;
      newsletter: boolean;
      smsConsent: boolean;
    },
    sourceId: string,
  ) => {
    if (ticketCount === 0) { toast.error('Please select at least one ticket'); return; }
    void submitPurchase({ sourceId, guest: guestInfo });
  };

  const handlePurchase = async () => {
    if (!user) { navigate('/auth?redirect=' + encodeURIComponent(window.location.pathname + window.location.search)); return; }
    if (ticketCount === 0) { toast.error('Please select at least one ticket'); return; }

    if (isFree) { await submitPurchase({}); return; }

    if (!cardRef.current) { toast.error('The card form is not ready yet.'); return; }

    let sourceId: string;
    try {
      sourceId = await cardRef.current.tokenize();
    } catch (err: any) {
      toast.error(err.message || 'Please check your card details.');
      return;
    }

    await submitPurchase({ sourceId });
  };

  if (loading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  const meta = getProductionMeta(productionType);
  const Icon = meta.icon;

  // Whether this page can still sell anything. Computed after the loading
  // guard above so the film's runtime is in hand: the cutoff is the end of the
  // show, and for a film that end depends on production.duration_minutes.
  const hasPassed = isPast(showing, production);
  // Free and open: no purchase panel at all. Read from the showing row rather
  // than inferred from a $0 price — a $0 showing with this false is still
  // ticketed, and the reserve flow it gets is the correct one. See
  // src/lib/purchasable.ts.
  const noTicket = needsNoTicket(showing);
  // Trailer/poster come from the production row we already fetched — no extra
  // query. When neither exists we keep the small type-icon tile instead of
  // reserving a media column for nothing.
  const hasMedia = !!(production?.trailer_url || production?.poster_url);

  // What the meta line says this costs.
  //
  // "$0.00 per ticket" is a true sentence about a walk-in night and a useless
  // one — it describes a ticket that does not exist. Tiers are unreachable
  // here: the flag requires ticket_price = 0 and the tier trigger refuses a
  // priced tier, so this branch is checked first rather than merged into the
  // ternary below.
  const priceDisplay = noTicket
    ? 'Free — no ticket needed'
    : hasTiers
      ? `$${Math.min(...priceTiers.map(t => t.price)).toFixed(2)}–$${Math.max(...priceTiers.map(t => t.price)).toFixed(2)}`
      : `$${Number(showing.ticket_price).toFixed(2)} per ticket`;

  return (
    // Extra bottom padding on mobile clears the sticky order bar below.
    <div className="container py-8 px-4 max-w-5xl pb-28 lg:pb-8">
      <SEO
        title={`${production?.title ?? 'Showing'} — ${formatShowtime(showing.start_time, 'MMM d, yyyy')} at Kenworthy`}
        description={
          // Must be plain text. A meta description containing <p> is a bug —
          // it is what a search result and a shared link preview print.
          toMetaDescription(production?.description) ||
          `Tickets for ${production?.title ?? 'this showing'} at Kenworthy Performing Arts Centre in Moscow, Idaho on ${formatShowtime(showing.start_time, 'MMMM d, yyyy')}.`
        }
        ogType="event"
        image={production?.poster_url || undefined}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Event",
          name: production?.title,
          startDate: showing.start_time,
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          image: production?.poster_url || undefined,
          // Structured data, read by crawlers rather than rendered — markup
          // here would be indexed as part of the description text.
          description: htmlToPlainText(production?.description) || undefined,
          location: {
            "@type": "Place",
            name: venue?.name || "Kenworthy Performing Arts Centre",
            address: {
              "@type": "PostalAddress",
              streetAddress: "508 S Main St",
              addressLocality: "Moscow",
              addressRegion: "ID",
              postalCode: "83843",
              addressCountry: "US",
            },
          },
          organizer: {
            "@type": "Organization",
            name: "Kenworthy Performing Arts Centre",
            url: `${SITE_URL}/`,
          },
        }}
      />
      {/* Production info */}
      <div className="mb-8">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="mb-4">← Back</Button>
        <div className={hasMedia ? 'grid gap-6 md:grid-cols-[minmax(0,26rem)_1fr] md:items-start' : 'flex items-start gap-4'}>
          {hasMedia ? (
            <ProductionMedia
              title={production?.title ?? meta.label}
              type={productionType}
              posterUrl={production?.poster_url}
              trailerUrl={production?.trailer_url}
              aspect="auto"
              fallback="none"
              className="rounded-lg overflow-hidden border border-border"
            />
          ) : (
            <div className="h-16 w-16 rounded-lg bg-secondary flex items-center justify-center shrink-0">
              <Icon className="h-8 w-8 text-primary" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-3xl font-bold">{production?.title}</h1>
              <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full font-medium">
                {meta.label}
              </span>
              {/* Not on a walk-in night. `soldOut` is a capacity answer and
                  capacity is not what limits a showing that sells nothing —
                  an old row still flagged for assigned seating would otherwise
                  print "Sold Out" over a screening anyone can walk into. */}
              {soldOut && !noTicket && (
                <span className="text-xs bg-destructive/15 text-destructive px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide">
                  Sold Out
                </span>
              )}
            </div>
            <ProductionMetaBadges
              rating={production?.rating}
              genre={production?.genre}
              durationMinutes={production?.duration_minutes}
              className="mt-2"
            />
            <RichText
              html={production?.description}
              className="text-sm text-muted-foreground mt-2 max-w-2xl"
            />
            <div className="flex flex-wrap gap-3 mt-3 text-muted-foreground text-sm">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" /> {formatShowtime(showing.start_time, 'EEEE, MMMM d, yyyy')}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" /> {formatShowtime(showing.start_time, 'h:mm a')}
              </span>
              {/* No icon here on purpose: priceDisplay already starts with a
                  "$", and a DollarSign glyph in front of it rendered
                  "$ $10.00 per ticket". The currency symbol in the string is
                  the one that has to stay — it is what every other price in
                  the app is formatted with. */}
              <span className="flex items-center gap-1">{priceDisplay}</span>
              {venue && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" /> {venue.name}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Everything below is the buy flow, and a past showing has none. The
          block is left at its original indentation rather than shifted a level
          to keep this change legible as the one-line rule it is. */}
      {hasPassed ? (
        <PassedNotice startTime={showing.start_time} />
      ) : noTicket ? (
        <FreeAdmissionPanel
          startTime={showing.start_time}
          venueName={venue?.name}
          donationCents={donationCents}
          onDonationChange={setDonationCents}
          defaultEmail={user?.email}
        />
      ) : (
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Seating Map or GA Quantity */}
        {/* min-w-0: a grid item defaults to min-width:auto, so this column
            refused to shrink below the seat map's intrinsic width and dragged
            the whole page sideways on a phone (~740px of horizontal overflow).
            It also starved SeatMap's fit-to-container zoom, which measures this
            element -- given an unconstrained width it never scaled down. */}
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {isAssignedSeating ? (
            <>
              {hasTiers && (
                <Card className="glass">
                  <CardHeader>
                    <CardTitle className="font-display text-lg">Seating Tiers</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-3 text-sm">
                      {priceTiers.map(tier => {
                        const t: any = (tier as any);
                        const color = t.color || 'hsl(var(--primary))';
                        return (
                          <div key={tier.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                            <span className="h-4 w-4 rounded-sm border border-border" style={{ backgroundColor: color }} />
                            <span className="font-medium">{tier.tier_name}</span>
                            <span className="text-muted-foreground">${tier.price.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-sm text-muted-foreground mt-3">
                      Each seat is colored by its tier. Hover or tap a seat to see its tier and price.
                    </p>
                  </CardContent>
                </Card>
              )}
              <Card className="glass">
                <CardHeader>
                  <CardTitle className="font-display text-lg">Select Your Seats</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* The map stays visible when full: seeing every seat greyed
                      out explains the state better than hiding it does. */}
                  {soldOut && <SoldOutNotice assigned />}
                  <SeatMap
                    seats={seats}
                    takenSeatIds={takenSeatIds}
                    selectedSeats={selectedSeats}
                    onToggleSeat={toggleSeat}
                    seatTierMeta={hasTiers ? Object.fromEntries(
                      Object.entries(seatTierMap).map(([seatId, t]) => [
                        seatId,
                        { color: t.color, tierName: t.tierName, price: t.price },
                      ]),
                    ) : undefined}
                  />
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="glass">
              <CardHeader>
                <CardTitle className="font-display text-lg">General Admission</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  This is a general admission event — seating is first-come, first-served.
                </p>
                {soldOut ? (
                  <SoldOutNotice assigned={false} />
                ) : hasTiers ? (
                  <div className="space-y-3">
                    {priceTiers.map(tier => (
                      <div key={tier.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                        <div>
                          <p className="font-medium">{tier.tier_name}</p>
                          <p className="text-sm text-muted-foreground">${tier.price.toFixed(2)}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Button variant="outline" size="icon" onClick={() => updateTierQty(tier.id, -1)} disabled={(tierQuantities[tier.id] || 0) === 0}>
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="text-xl font-bold w-8 text-center">{tierQuantities[tier.id] || 0}</span>
                          <Button variant="outline" size="icon" onClick={() => updateTierQty(tier.id, 1)} disabled={ticketCount >= gaAvailable}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {/* The remaining-count line is deliberately not rendered.
                        gaAvailable still caps the steppers below and still
                        drives `soldOut`, so the limit is enforced — patrons
                        just aren't shown how thin the house is. */}
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/50">
                    <div>
                      <p className="font-medium">Tickets</p>
                      {/* Remaining count hidden — see the note in the tiered
                          branch above. */}
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
              </CardContent>
            </Card>
          )}
        </div>

        {/* Checkout */}
        <div id="order-summary" className="scroll-mt-24">
          <Card className="glass lg:sticky lg:top-20">
            <CardHeader>
              <CardTitle className="font-display text-lg">Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {soldOut ? (
                <SoldOutNotice assigned={!!isAssignedSeating} />
              ) : ticketCount === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {isAssignedSeating ? 'Select seats to continue' : 'Add tickets to continue'}
                </p>
              ) : (
                <>
                  <div className="space-y-2 text-sm">
                    {hasTiers ? (
                      isAssignedSeating ? (
                        <>
                          {Array.from(selectedSeats).map(seatId => {
                            const seat = seats.find(s => s.id === seatId);
                            if (!seat) return null;
                            const fallback = priceTiers.reduce((m, t) => (t.price < m.price ? t : m), priceTiers[0]);
                            const meta = seatTierMap[seatId] ?? {
                              tierName: fallback.tier_name,
                              price: fallback.price,
                              color: 'hsl(var(--primary))',
                            };
                            return (
                              <div key={seatId} className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="h-3 w-3 rounded-sm border border-border shrink-0"
                                    style={{ backgroundColor: meta.color }}
                                    aria-hidden
                                  />
                                  <span className="truncate">
                                    Row {seat.seat_row}, Seat {seat.seat_number}
                                    <span className="text-muted-foreground"> · {meta.tierName}</span>
                                  </span>
                                </span>
                                <span className="tabular-nums">${meta.price.toFixed(2)}</span>
                              </div>
                            );
                          })}
                        </>
                      ) : (
                        priceTiers
                          .filter(t => (tierQuantities[t.id] || 0) > 0)
                          .map(tier => (
                            <div key={tier.id} className="flex justify-between">
                              <span>{tier.tier_name} × {tierQuantities[tier.id]}</span>
                              <span>${(tier.price * tierQuantities[tier.id]).toFixed(2)}</span>
                            </div>
                          ))
                      )
                    ) : (
                      isAssignedSeating ? (
                        Array.from(selectedSeats).map(seatId => {
                          const seat = seats.find(s => s.id === seatId);
                          return seat ? (
                            <div key={seatId} className="flex justify-between">
                              <span>Row {seat.seat_row}, Seat {seat.seat_number}</span>
                              <span>${Number(showing.ticket_price).toFixed(2)}</span>
                            </div>
                          ) : null;
                        })
                      ) : (
                        <div className="flex justify-between">
                          <span>General Admission × {gaQuantity}</span>
                          <span>${(gaQuantity * Number(showing.ticket_price)).toFixed(2)}</span>
                        </div>
                      )
                    )}
                  </div>
                  <div className="border-t border-border pt-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>${subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Idaho sales tax (6%)</span>
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
                    valueCents={donationCents}
                    onChange={setDonationCents}
                    disabled={purchasing}
                  />

                  {/* No film-pass option here, by design. A pass is a physical
                      card redeemed at the door by a staff scan — it cannot buy
                      a ticket online, and the server refuses the attempt. */}

                  {user ? (
                    <>
                      {!isFree && (
                        <div className="border-t border-border pt-3">
                          <p className="text-sm font-medium mb-3 flex items-center gap-1">
                            <CreditCard className="h-4 w-4" /> Payment
                          </p>
                          <SquareCardForm ref={cardRef} source="ticket-checkout" onReadyChange={setCardReady} />
                        </div>
                      )}
                      <Button
                        className="w-full"
                        size="lg"
                        onClick={handlePurchase}
                        disabled={purchasing || (!isFree && !cardReady)}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        {purchasing
                          ? 'Processing...'
                          : isFree
                            ? `Reserve ${ticketCount} Ticket(s)`
                            : `Pay $${chargeTotal.toFixed(2)}`}
                      </Button>
                      <p className="text-sm text-muted-foreground text-center">
                        Payments are processed securely by Square. Your card details never reach our servers.
                      </p>
                    </>
                  ) : (
                    <GuestCheckoutForm
                      ticketCount={ticketCount}
                      total={chargeTotal}
                      purchasing={purchasing}
                      onPurchase={handleGuestPurchase}
                    />
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      )}

      {/* Mobile order bar. On phones the summary column stacks below the seat
          map, so the running total and the way to checkout would otherwise be
          a full screen of scrolling away from the seat the buyer just tapped. */}
      {ticketCount > 0 && !soldOut && !hasPassed && !noTicket && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-accent/20 glass px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 lg:hidden">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {ticketCount} {ticketCount === 1 ? 'ticket' : 'tickets'}
                {isAssignedSeating && (
                  <span className="text-muted-foreground">
                    {' · '}
                    {Array.from(selectedSeats)
                      .map(seatId => {
                        const seat = seats.find(s => s.id === seatId);
                        return seat ? `${seat.seat_row}${seat.seat_number}` : null;
                      })
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                )}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                Total <span className="text-primary font-semibold">${chargeTotal.toFixed(2)}</span>
              </p>
            </div>
            <Button
              size="lg"
              className="h-12 shrink-0"
              onClick={() =>
                document.getElementById('order-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            >
              Continue
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
