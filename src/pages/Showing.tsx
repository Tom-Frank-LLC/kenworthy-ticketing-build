import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
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
import { type Seat, type PriceTier, TAX_RATE, buildTicketRows, computeOrderTotals, computeLineItemTotals, computeProcessingFee, type TicketLineItem } from '@/lib/booking';
import { PreviouslyScreened } from '@/components/PreviouslyScreened';
import { SEO } from '@/components/SEO';

type ProductionType = 'movie' | 'event' | 'concert';

function getProductionMeta(type: ProductionType) {
  switch (type) {
    case 'movie': return { icon: Film, label: 'Movie' };
    case 'event': return { icon: Sparkles, label: 'Event' };
    case 'concert': return { icon: Music, label: 'Concert' };
  }
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
  const gaAvailable = totalSeats - ticketsSold;

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
        productionPromise = supabase.from('movies').select('*').eq('id', s.movie_id).single();
      }
      setProductionType(type);

      const venuePromise = s.venue_id
        ? supabase.from('venues').select('*').eq('id', s.venue_id).single()
        : Promise.resolve({ data: null });

      if (s.requires_seat_selection) {
        const [prodRes, venueRes, seatsRes, ticketsRes] = await Promise.all([
          productionPromise,
          venuePromise,
          supabase.from('seats').select('*').order('seat_row').order('seat_number'),
          supabase.from('tickets').select('seat_id').eq('showing_id', id).eq('status', 'confirmed'),
        ]);
        setProduction(prodRes.data);
        setVenue(venueRes.data);
        setSeats(seatsRes.data || []);
        setTakenSeatIds(new Set((ticketsRes.data || []).map(t => t.seat_id)));

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
        const [prodRes, venueRes, ticketsRes] = await Promise.all([
          productionPromise,
          venuePromise,
          supabase.from('tickets').select('id', { count: 'exact' }).eq('showing_id', id).eq('status', 'confirmed'),
        ]);
        setProduction(prodRes.data);
        setVenue(venueRes.data);
        setTicketsSold(ticketsRes.count || 0);
      }
      setLoading(false);
    }
    load();
  }, [id, navigate]);

  // Load user's film passes
  useEffect(() => {
    if (!user) return;
    async function loadPasses() {
      const { data } = await supabase
        .from('user_film_passes')
        .select('*, film_pass_types!user_film_passes_pass_type_id_fkey(name)')
        .eq('user_id', user!.id)
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
      let sub = 0;
      for (const seatId of selectedSeats) {
        sub += seatTierMap[seatId]?.price ?? fallback.price;
      }
      subtotal = Math.round(sub * 100) / 100;
      tax = Math.round(subtotal * TAX_RATE * 100) / 100;
      total = Math.round((subtotal + tax) * 100) / 100;
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

  // Optional buyer-paid Square processing fee (per production toggle).
  // Film-pass redemptions don't run through Square, so skip the surcharge.
  const passProcessingFee = !!production?.pass_processing_fee && !useFilmPass && total > 0;
  const processingFee = passProcessingFee ? computeProcessingFee(total, 'online').fee : 0;
  const grandTotal = Math.round((total + processingFee) * 100) / 100;

  // Film pass: check if selected pass covers the total
  const selectedPass = userPasses.find((p: any) => p.id === selectedPassId);
  const passCoversTotal = useFilmPass && selectedPass && Number(selectedPass.remaining_balance) >= subtotal;

  const handleGuestPurchase = async (guestInfo: { name: string; email: string; phone: string }) => {
    if (ticketCount === 0) { toast.error('Please select at least one ticket'); return; }
    setPurchasing(true);
    try {
      // Build ticket descriptors for the edge function
      const ticketDescriptors: any[] = [];

      if (hasTiers) {
        if (isAssignedSeating) {
          const fallback = priceTiers.reduce((m, t) => (t.price < m.price ? t : m), priceTiers[0]);
          for (const seatId of selectedSeats) {
            const tierId = seatTierMap[seatId]?.tierId ?? fallback.id;
            ticketDescriptors.push({ seat_id: seatId, tier_id: tierId });
          }
        } else {
          for (const tier of priceTiers) {
            const qty = tierQuantities[tier.id] || 0;
            for (let i = 0; i < qty; i++) {
              ticketDescriptors.push({ tier_id: tier.id });
            }
          }
        }
      } else {
        if (isAssignedSeating) {
          for (const seatId of selectedSeats) {
            ticketDescriptors.push({ seat_id: seatId });
          }
        } else {
          for (let i = 0; i < gaQuantity; i++) {
            ticketDescriptors.push({});
          }
        }
      }

      const { data, error } = await supabase.functions.invoke('guest-checkout', {
        body: {
          guest_name: guestInfo.name,
          guest_email: guestInfo.email || undefined,
          guest_phone: guestInfo.phone || undefined,
          showing_id: id,
          tickets: ticketDescriptors,
        },
      });

      if (error) throw new Error(error.message || 'Checkout failed');
      if (data?.error) throw new Error(data.error);

      toast.success(`${ticketCount} ticket(s) purchased! Check your email/phone for your QR code(s).`);
      navigate('/');
    } catch (err: any) {
      toast.error(err.message || 'Failed to purchase tickets');
    } finally {
      setPurchasing(false);
    }
  };

  const handlePurchase = async () => {
    if (!user) { navigate('/auth'); return; }
    if (ticketCount === 0) { toast.error('Please select at least one ticket'); return; }

    if (useFilmPass && !selectedPass) {
      toast.error('Please select a film pass');
      return;
    }

    if (useFilmPass && !passCoversTotal) {
      toast.error(`Insufficient pass balance. Need $${subtotal.toFixed(2)}, have $${Number(selectedPass.remaining_balance).toFixed(2)}`);
      return;
    }

    setPurchasing(true);
    try {
      const paymentMethod = useFilmPass ? 'film_pass' : 'online';
      let ticketRows;

      if (hasTiers) {
        if (isAssignedSeating) {
          const fallback = priceTiers.reduce((m, t) => (t.price < m.price ? t : m), priceTiers[0]);
          // Group selected seats by tier so each line item has a single price.
          const grouped = new Map<string, string[]>();
          for (const seatId of selectedSeats) {
            const tierId = seatTierMap[seatId]?.tierId ?? fallback.id;
            const arr = grouped.get(tierId) ?? [];
            arr.push(seatId);
            grouped.set(tierId, arr);
          }
          const lineItems: TicketLineItem[] = [];
          for (const [tierId, seatIds] of grouped) {
            const tier = priceTiers.find(t => t.id === tierId)!;
            lineItems.push({
              tierId,
              tierName: tier.tier_name,
              price: tier.price,
              quantity: seatIds.length,
              seatIds,
            });
          }
          ticketRows = buildTicketRows({
            lineItems,
            userId: user.id,
            showingId: id!,
            paymentMethod,
          });
        } else {
          const items: TicketLineItem[] = priceTiers
            .filter(t => (tierQuantities[t.id] || 0) > 0)
            .map(t => ({ tierId: t.id, tierName: t.tier_name, price: t.price, quantity: tierQuantities[t.id] }));
          ticketRows = buildTicketRows({
            lineItems: items,
            userId: user.id,
            showingId: id!,
            paymentMethod,
          });
        }
      } else {
        ticketRows = buildTicketRows({
          selectedSeats: isAssignedSeating ? selectedSeats : new Set<string>(),
          quantity: isAssignedSeating ? undefined : gaQuantity,
          userId: user.id,
          showingId: id!,
          ticketPrice: showing.ticket_price,
          paymentMethod,
        });
      }

      const { data: ticketData, error } = await supabase.from('tickets').insert(ticketRows).select('id');
      if (error) throw error;

      // Redeem film pass for each ticket
      if (useFilmPass && ticketData) {
        for (const ticket of ticketData) {
          const perTicketAmount = Math.round((subtotal / ticketCount) * 100) / 100;
          const { error: redeemError } = await supabase.rpc('redeem_film_pass', {
            p_pass_id: selectedPassId,
            p_ticket_id: ticket.id,
            p_amount: perTicketAmount,
          });
          if (redeemError) throw redeemError;
        }
      }

      toast.success(`${ticketCount} ticket(s) ${useFilmPass ? 'redeemed with Film Pass' : 'purchased'}!`);
      navigate('/my-tickets');
    } catch (err: any) {
      toast.error(err.message || 'Failed to purchase tickets');
    } finally {
      setPurchasing(false);
    }
  };

  if (loading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  const meta = getProductionMeta(productionType);
  const Icon = meta.icon;

  // Price display: show range if tiers, otherwise single price
  const priceDisplay = hasTiers
    ? `$${Math.min(...priceTiers.map(t => t.price)).toFixed(2)}–$${Math.max(...priceTiers.map(t => t.price)).toFixed(2)}`
    : `$${Number(showing.ticket_price).toFixed(2)} per ticket`;

  return (
    <div className="container py-8 px-4 max-w-5xl">
      <SEO
        title={`${production?.title ?? 'Showing'} — ${format(new Date(showing.start_time), 'MMM d, yyyy')} at The Kenworthy`}
        description={
          production?.description?.slice(0, 160) ??
          `Tickets for ${production?.title ?? 'this showing'} at The Kenworthy Performing Arts Centre in Moscow, Idaho on ${format(new Date(showing.start_time), 'MMMM d, yyyy')}.`
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
            url: "https://kenworthy-ticketing.lovable.app/",
          },
        }}
      />
      {/* Production info */}
      <div className="mb-8">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="mb-4">← Back</Button>
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 rounded-lg bg-secondary flex items-center justify-center shrink-0">
            <Icon className="h-8 w-8 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-3xl font-bold">{production?.title}</h1>
              <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full font-medium">
                {meta.label}
              </span>
            </div>
            {production?.description && (
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{production.description}</p>
            )}
            <div className="flex flex-wrap gap-3 mt-2 text-muted-foreground text-sm">
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" /> {format(new Date(showing.start_time), 'EEEE, MMMM d, yyyy')}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" /> {format(new Date(showing.start_time), 'h:mm a')}
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
                <CardContent>
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
                {hasTiers ? (
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
        <div>
          <Card className="glass sticky top-20">
            <CardHeader>
              <CardTitle className="font-display text-lg">Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {ticketCount === 0 ? (
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
                    <div className="flex justify-between font-bold text-base pt-1">
                      <span>Total</span>
                      <span className="text-primary">${total.toFixed(2)}</span>
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
                      <Button
                        className="w-full"
                        size="lg"
                        onClick={handlePurchase}
                        disabled={purchasing || (useFilmPass && !passCoversTotal)}
                      >
                        {useFilmPass ? (
                          <><CreditCard className="h-4 w-4 mr-1" /> {purchasing ? 'Redeeming...' : `Redeem Film Pass`}</>
                        ) : (
                          <><Check className="h-4 w-4 mr-1" /> {purchasing ? 'Processing...' : `Purchase ${ticketCount} Ticket(s)`}</>
                        )}
                      </Button>
                      <p className="text-xs text-muted-foreground text-center">
                        {useFilmPass ? 'Pass balance will be deducted' : 'Simulated checkout — no real charge'}
                      </p>
                    </>
                  ) : (
                    <GuestCheckoutForm
                      ticketCount={ticketCount}
                      total={total}
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
    </div>
  );
}
