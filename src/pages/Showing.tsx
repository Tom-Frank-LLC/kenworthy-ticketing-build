import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeFunction } from '@/lib/functions';
import { SquareCardForm, type SquareCardFormHandle } from '@/components/SquareCardForm';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Film, Calendar, Clock, DollarSign, Check, Minus, Plus, MapPin, Sparkles, Music, CreditCard } from 'lucide-react';
import { SeatMap } from '@/components/SeatMap';
import { GuestCheckoutForm } from '@/components/GuestCheckoutForm';
import { type Seat, type PriceTier, computeSeatTotals, computeOrderTotals, computeLineItemTotals, computeProcessingFee, type TicketLineItem } from '@/lib/booking';
import { PreviouslyScreened } from '@/components/PreviouslyScreened';
import { ProductionMedia, ProductionMetaBadges } from '@/components/ProductionMedia';
import { SEO } from '@/components/SEO';
import { syncMailchimpProfile } from '@/lib/mailchimp';
import { ticketPagePath } from '@/lib/tickets';
import { fetchShowingAvailability } from '@/lib/availability';
import { formatShowtime } from '@/lib/datetime';
import { SITE_URL } from '@/lib/site';

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

  // Card payment for signed-in buyers. Guests get their own card form inside
  // GuestCheckoutForm, alongside the contact fields they still have to fill in.
  const cardRef = useRef<SquareCardFormHandle>(null);
  const [cardReady, setCardReady] = useState(false);

  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);
  const [tierQuantities, setTierQuantities] = useState<Record<string, number>>({});
  const [selectedTierId, setSelectedTierId] = useState<string>('');

  // Per-seat tier mapping for assigned seating: seats.id -> tier (with color)
  const [seatTierMap, setSeatTierMap] = useState<Record<string, { tierId: string; tierName: string; price: number; color: string }>>({});

  // Film Pass state
  const [userPasses, setUserPasses] = useState<any[]>([]);
  const [selectedPassId, setSelectedPassId] = useState<string>('');
  const [useFilmPass, setUseFilmPass] = useState(false);

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

  // Load user's film passes
  useEffect(() => {
    if (!user) return;
    async function loadPasses() {
      // Only active passes are spendable: a pass row now exists from the moment
      // checkout starts, and one whose charge failed must never be redeemable.
      const { data } = await supabase
        .from('user_film_passes')
        .select('*, film_pass_types!user_film_passes_pass_type_id_fkey(name)')
        .eq('user_id', user!.id)
        .eq('status', 'active')
        .gt('remaining_balance', 0);

      const valid = (data || []).filter((p: any) =>
        !p.expires_at || new Date(p.expires_at) > new Date()
      ).map((p: any) => ({ ...p, pass_type_name: p.film_pass_types?.name || 'Film Pass' }));

      setUserPasses(valid);
      if (valid.length > 0) setSelectedPassId(valid[0].id);
    }
    loadPasses();
  }, [user]);

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
  // Film-pass redemptions never run through Square, so they never surcharge.
  const passProcessingFee = !!production?.pass_processing_fee && !useFilmPass && total > 0;
  const processingFee = passProcessingFee ? computeProcessingFee(total, 'online').fee : 0;
  const grandTotal = Math.round((total + processingFee) * 100) / 100;
  // A free ($0) showing has no card step: Square rejects a $0 charge, and the
  // server skips it, so the browser must not ask for a card or send a token.
  const isFree = !useFilmPass && grandTotal <= 0;

  // Film pass: check if selected pass covers the total
  const selectedPass = userPasses.find((p: any) => p.id === selectedPassId);
  const passCoversTotal = useFilmPass && selectedPass && Number(selectedPass.remaining_balance) >= subtotal;

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
    passId?: string;
    guest?: { name: string; email: string; phone: string };
  }) => {
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
        payment_method: opts.passId ? 'film_pass' : 'card',
        source_id: opts.sourceId,
        pass_id: opts.passId,
        idempotency_key: idempotencyKeyRef.current,
        name: opts.guest?.name,
        email: opts.guest?.email || undefined,
        phone: opts.guest?.phone || undefined,
      });

      if (!data?.success) throw new Error('Checkout failed');

      toast.success(
        `${data.ticket_count} ticket(s) ${opts.passId ? 'redeemed with Film Pass' : 'purchased'}!`,
      );

      // Fire-and-forget Mailchimp profile sync for signed-in buyers (the order
      // itself is recorded server-side by the checkout function).
      if (user) {
        try {
          const kind = productionType === 'movie' ? 'Films' : productionType === 'event' ? 'Special Events' : 'Live Performances';
          void syncMailchimpProfile({
            extraTags: ['ticket-buyer'],
            source: 'showing-checkout',
            addInterests: [kind as any],
          });
        } catch { /* noop */ }
      }

      // Land the buyer on the tickets they just bought. Delivery is
      // fire-and-forget, so this is the one moment we can be certain they can
      // see them — and it is the answer to "a guest account was created
      // silently and they have no way to reach it".
      if (!user && data.order_token) navigate(ticketPagePath(data.order_token));
      else navigate('/my-tickets');
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
    guestInfo: { name: string; email: string; phone: string },
    sourceId: string,
  ) => {
    if (ticketCount === 0) { toast.error('Please select at least one ticket'); return; }
    void submitPurchase({ sourceId, guest: guestInfo });
  };

  const handlePurchase = async () => {
    if (!user) { navigate('/auth?redirect=' + encodeURIComponent(window.location.pathname + window.location.search)); return; }
    if (ticketCount === 0) { toast.error('Please select at least one ticket'); return; }

    if (useFilmPass) {
      if (!selectedPass) { toast.error('Please select a film pass'); return; }
      if (!passCoversTotal) {
        toast.error(`Insufficient pass balance. Need $${subtotal.toFixed(2)}, have $${Number(selectedPass.remaining_balance).toFixed(2)}`);
        return;
      }
      await submitPurchase({ passId: selectedPassId });
      return;
    }

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
  // Trailer/poster come from the production row we already fetched — no extra
  // query. When neither exists we keep the small type-icon tile instead of
  // reserving a media column for nothing.
  const hasMedia = !!(production?.trailer_url || production?.poster_url);

  // Price display: show range if tiers, otherwise single price
  const priceDisplay = hasTiers
    ? `$${Math.min(...priceTiers.map(t => t.price)).toFixed(2)}–$${Math.max(...priceTiers.map(t => t.price)).toFixed(2)}`
    : `$${Number(showing.ticket_price).toFixed(2)} per ticket`;

  return (
    // Extra bottom padding on mobile clears the sticky order bar below.
    <div className="container py-8 px-4 max-w-5xl pb-28 lg:pb-8">
      <SEO
        title={`${production?.title ?? 'Showing'} — ${formatShowtime(showing.start_time, 'MMM d, yyyy')} at The Kenworthy`}
        description={
          production?.description?.slice(0, 160) ??
          `Tickets for ${production?.title ?? 'this showing'} at The Kenworthy Performing Arts Centre in Moscow, Idaho on ${formatShowtime(showing.start_time, 'MMMM d, yyyy')}.`
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
          description: production?.description || undefined,
          location: {
            "@type": "Place",
            name: venue?.name || "The Kenworthy Performing Arts Centre",
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
            name: "The Kenworthy Performing Arts Centre",
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
              {soldOut && (
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
            {production?.description && (
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{production.description}</p>
            )}
            <div className="flex flex-wrap gap-3 mt-3 text-muted-foreground text-sm">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" /> {formatShowtime(showing.start_time, 'EEEE, MMMM d, yyyy')}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" /> {formatShowtime(showing.start_time, 'h:mm a')}
              </span>
              <span className="flex items-center gap-1">
                <DollarSign className="h-4 w-4" /> {priceDisplay}
              </span>
              {venue && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" /> {venue.name}
                </span>
              )}
            </div>
            {productionType === 'movie' && showing?.movie_id && (
              <PreviouslyScreened movieId={showing.movie_id} />
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Seating Map or GA Quantity */}
        <div className="lg:col-span-2 space-y-6">
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
                    <p className="text-xs text-muted-foreground mt-3">
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
                    <p className="text-xs text-muted-foreground">{gaAvailable} tickets available</p>
                  </div>
                ) : (
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
                      <span className="text-muted-foreground">Tax (6% ID)</span>
                      <span>${tax.toFixed(2)}</span>
                    </div>
                    {processingFee > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Card processing fee</span>
                        <span>${processingFee.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-base pt-1">
                      <span>Total</span>
                      <span className="text-primary">${grandTotal.toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Film Pass option */}
                  {user && userPasses.length > 0 && (
                    <div className="border-t border-border pt-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={useFilmPass}
                            onChange={e => setUseFilmPass(e.target.checked)}
                            className="rounded"
                          />
                          <CreditCard className="h-4 w-4 text-primary" />
                          Use Film Pass
                        </Label>
                      </div>
                      {useFilmPass && (
                        <Select value={selectedPassId} onValueChange={setSelectedPassId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a pass..." />
                          </SelectTrigger>
                          <SelectContent>
                            {userPasses.map((p: any) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.pass_type_name} — ${Number(p.remaining_balance).toFixed(2)} left
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {useFilmPass && selectedPass && !passCoversTotal && (
                        <p className="text-xs text-destructive">
                          Insufficient balance: ${Number(selectedPass.remaining_balance).toFixed(2)} available, ${subtotal.toFixed(2)} needed
                        </p>
                      )}
                    </div>
                  )}

                  {user ? (
                    <>
                      {!useFilmPass && !isFree && (
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
                        disabled={
                          purchasing ||
                          (useFilmPass ? !passCoversTotal : (!isFree && !cardReady))
                        }
                      >
                        {useFilmPass ? (
                          <><CreditCard className="h-4 w-4 mr-1" /> {purchasing ? 'Redeeming...' : `Redeem Film Pass`}</>
                        ) : (
                          <><Check className="h-4 w-4 mr-1" /> {purchasing ? 'Processing...' : isFree ? `Reserve ${ticketCount} Ticket(s)` : `Pay $${grandTotal.toFixed(2)}`}</>
                        )}
                      </Button>
                      <p className="text-xs text-muted-foreground text-center">
                        {useFilmPass
                          ? 'Pass balance will be deducted'
                          : 'Payments are processed securely by Square. Your card details never reach our servers.'}
                      </p>
                    </>
                  ) : (
                    <GuestCheckoutForm
                      ticketCount={ticketCount}
                      total={grandTotal}
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

      {/* Mobile order bar. On phones the summary column stacks below the seat
          map, so the running total and the way to checkout would otherwise be
          a full screen of scrolling away from the seat the buyer just tapped. */}
      {ticketCount > 0 && !soldOut && (
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
              <p className="truncate text-xs text-muted-foreground">
                Total <span className="text-primary font-semibold">${grandTotal.toFixed(2)}</span>
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
