// Authoritative order pricing.
//
// The amount a customer is charged is computed here, on the server, from the
// showing's own price rows — never from anything the browser sent. The client
// still computes the same numbers for display, but its arithmetic is advisory:
// if the two disagree, the server's number is what Square charges and what the
// ticket rows record.
//
// This mirrors the `enforce_ticket_pricing` DB trigger deliberately and
// exactly, including its rounding: the trigger rounds tax *per ticket row*, so
// the order total is the sum of per-ticket totals, not tax computed once on the
// subtotal. Those differ by a cent on some quantities. Matching the trigger
// means the charged amount always equals SUM(tickets.total_price) for the
// order, which is what the refund path re-reads. Anything else would refund a
// different number than it charged.

export const TAX_RATE = 0.06;

// Square's published rates. Mirrors SQUARE_RATES in src/lib/booking.ts.
//   Online / keyed entry: 2.9% + $0.30
//   In-person (Terminal):  2.6% + $0.10
export const SQUARE_RATES = {
  online: { pct: 0.029, fixed: 0.3 },
  in_person: { pct: 0.026, fixed: 0.1 },
} as const;

export type ProcessingChannel = keyof typeof SQUARE_RATES;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Buyer-paid surcharge, grossed up so the theatre nets the full ticket total
 * after Square takes its cut of the larger charge.
 */
export function computeProcessingFee(netAmount: number, channel: ProcessingChannel) {
  const { pct, fixed } = SQUARE_RATES[channel];
  const total = round2((netAmount + fixed) / (1 - pct));
  return { fee: round2(total - netAmount), total };
}

/** What the client asks for: a seat, a tier, or plain general admission. */
export interface TicketDescriptor {
  seat_id?: string | null;
  tier_id?: string | null;
}

/** What the server decided that ticket costs. */
export interface PricedTicket {
  seat_id: string | null;
  /** Resolved tier — a seat's own tier mapping overrides whatever was asked for. */
  tier_id: string | null;
  price: number;
  tax_amount: number;
  total_price: number;
}

export interface PricedOrder {
  tickets: PricedTicket[];
  subtotal: number;
  tax: number;
  /** subtotal + tax, i.e. SUM(tickets.total_price). */
  total: number;
  /** Buyer-paid Square surcharge, 0 unless the production opted in. */
  processingFee: number;
  /** total + processingFee — the number actually charged. */
  grandTotal: number;
  amountCents: number;
  /** For the Square note / confirmation copy. */
  productionTitle: string;
  /** Films | Special Events | Live Performances — for Mailchimp categories. */
  productionCategory: string;
  /** The showing row, so callers can check capacity without re-reading it. */
  showing: {
    id: string;
    total_seats: number;
    requires_seat_selection: boolean;
    start_time: string;
  };
}

export class PricingError extends Error {}

/**
 * Recompute an order from the database.
 *
 * `channel` decides which Square rate the surcharge uses; pass 'none' for
 * film-pass redemptions, which never touch Square and so carry no surcharge.
 */
export async function priceTicketOrder(
  admin: any,
  showingId: string,
  descriptors: TicketDescriptor[],
  channel: ProcessingChannel | 'none' = 'online',
): Promise<PricedOrder> {
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    throw new PricingError('No tickets requested');
  }

  const { data: showing, error: showingErr } = await admin
    .from('showings')
    .select(
      'id, ticket_price, is_active, requires_seat_selection, total_seats, start_time, movie_id, event_id, live_performance_id',
    )
    .eq('id', showingId)
    .maybeSingle();

  if (showingErr) throw new PricingError('Could not load the showing');
  if (!showing) throw new PricingError('Showing not found');
  if (showing.is_active === false) throw new PricingError('This showing is no longer on sale');

  // Production row carries the title and the buyer-paid-fee opt-in.
  const production = await loadProduction(admin, showing);

  // Active tiers for this showing, and the per-seat tier mapping. Both are
  // read once and matched in memory — the trigger does the same join per row.
  const [{ data: tierRows }, { data: seatTierRows }] = await Promise.all([
    admin
      .from('showing_price_tiers')
      .select('id, tier_name, price, is_active')
      .eq('showing_id', showingId),
    admin
      .from('showing_seat_tiers')
      .select('tier_id, venue_seats!showing_seat_tiers_venue_seat_id_fkey(seat_row, seat_number, section)')
      .eq('showing_id', showingId),
  ]);

  const tierById = new Map<string, { price: number; is_active: boolean }>();
  for (const t of tierRows || []) {
    tierById.set(t.id, { price: Number(t.price), is_active: t.is_active !== false });
  }

  // Seat → tier resolution needs the seat's row/section/number, because the
  // mapping is stored against venue_seats while tickets reference seats.
  const requestedSeatIds = descriptors
    .map((d) => d.seat_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const seatTierBySeatId = new Map<string, string>();
  if (requestedSeatIds.length > 0 && (seatTierRows || []).length > 0) {
    const { data: seatRows } = await admin
      .from('seats')
      .select('id, seat_row, seat_number, section')
      .in('id', requestedSeatIds);

    const tierByKey = new Map<string, string>();
    for (const row of seatTierRows || []) {
      const vs = row.venue_seats;
      if (!vs) continue;
      tierByKey.set(seatKey(vs.seat_row, vs.section, vs.seat_number), row.tier_id);
    }
    for (const seat of seatRows || []) {
      const tierId = tierByKey.get(seatKey(seat.seat_row, seat.section, seat.seat_number));
      if (tierId) seatTierBySeatId.set(seat.id, tierId);
    }
  }

  // Carries the integer-cent working values; they are stripped from the result.
  type WorkingTicket = PricedTicket & { priceCents: number; taxCents: number };

  const tickets: WorkingTicket[] = descriptors.map((d) => {
    const seatId = d.seat_id || null;

    // A seat's own tier mapping wins over whatever tier the client asked for.
    // This is the trigger's rule, and it is what stops a buyer from claiming a
    // front-row seat at the back-row price.
    let tierId: string | null = seatId ? seatTierBySeatId.get(seatId) ?? null : null;
    if (!tierId && d.tier_id) tierId = d.tier_id;

    let price: number;
    if (tierId) {
      const tier = tierById.get(tierId);
      if (!tier) throw new PricingError('Invalid ticket tier for this showing');
      if (!tier.is_active) throw new PricingError('That ticket tier is no longer on sale');
      price = tier.price;
    } else {
      price = Number(showing.ticket_price);
    }

    if (!Number.isFinite(price) || price < 0) {
      throw new PricingError('This showing has no valid price configured');
    }

    // Integer cents, not floating-point dollars. In doubles,
    // `8.25 + 8.25 * 0.06` lands just under 8.745 and rounds down to 8.74,
    // while Postgres computes the same expression in exact numeric and stores
    // 8.75. Charging the float total would have taken a cent per ticket less
    // than the ticket rows say — a charge that fails to reconcile against its
    // own order, and against the refund that later re-reads those rows.
    const priceCents = Math.round(price * 100);
    const taxCents = Math.round(priceCents * TAX_RATE);
    return {
      seat_id: seatId,
      tier_id: tierId,
      price,
      tax_amount: taxCents / 100,
      total_price: (priceCents + taxCents) / 100,
      priceCents,
      taxCents,
    };
  });

  const subtotalCents = tickets.reduce((s, t) => s + t.priceCents, 0);
  const taxTotalCents = tickets.reduce((s, t) => s + t.taxCents, 0);
  const totalCents = subtotalCents + taxTotalCents;

  const subtotal = subtotalCents / 100;
  const tax = taxTotalCents / 100;
  const total = totalCents / 100;

  // No surcharge on a standard ticket sale: the patron pays ticket price plus
  // tax, and the theatre absorbs Square's cut. `pass_processing_fee` is a
  // per-production rental exception, off on every production unless a rental
  // agreement says otherwise, so this branch is normally dead.
  const wantsFee = channel !== 'none' && !!production.pass_processing_fee && total > 0;
  const processingFee = wantsFee ? computeProcessingFee(total, channel as ProcessingChannel).fee : 0;
  const feeCents = Math.round(processingFee * 100);
  const grandTotalCents = totalCents + feeCents;

  return {
    tickets: tickets.map(({ priceCents: _p, taxCents: _t, ...ticket }) => ticket),
    subtotal,
    tax,
    total,
    processingFee,
    grandTotal: grandTotalCents / 100,
    amountCents: grandTotalCents,
    productionTitle: production.title,
    productionCategory: production.category,
    showing: {
      id: showing.id,
      total_seats: showing.total_seats ?? 200,
      requires_seat_selection: !!showing.requires_seat_selection,
      start_time: showing.start_time,
    },
  };
}

function seatKey(row: string, section: string | null, number: number) {
  return `${row}|${(section || '').toLowerCase()}|${number}`;
}

async function loadProduction(admin: any, showing: any) {
  if (showing.event_id) {
    const { data } = await admin
      .from('events')
      .select('title, pass_processing_fee')
      .eq('id', showing.event_id)
      .maybeSingle();
    return {
      title: data?.title || 'Kenworthy event',
      pass_processing_fee: !!data?.pass_processing_fee,
      category: 'Special Events',
    };
  }
  if (showing.live_performance_id) {
    const { data } = await admin
      .from('live_performances')
      .select('title, pass_processing_fee')
      .eq('id', showing.live_performance_id)
      .maybeSingle();
    return {
      title: data?.title || 'Kenworthy performance',
      pass_processing_fee: !!data?.pass_processing_fee,
      category: 'Live Performances',
    };
  }
  const { data } = await admin
    .from('movies')
    .select('title, pass_processing_fee')
    .eq('id', showing.movie_id)
    .maybeSingle();
  return {
    title: data?.title || 'Kenworthy showing',
    pass_processing_fee: !!data?.pass_processing_fee,
    category: 'Films',
  };
}
