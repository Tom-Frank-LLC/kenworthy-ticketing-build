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

import type { SquareLineItem } from './square.ts';

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
  /** The resolved tier's label ("Adult", "Student"), for Square line items. */
  tier_name: string | null;
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
 * The largest gift a checkout page may add to an order.
 *
 * Not a policy about generosity — a donation of any size is welcome on the
 * Donate page, which has its own $100,000 ceiling. This is a ceiling on what a
 * tampered-with checkout request can turn a $9 movie ticket into, and $1,000 is
 * far above any plausible tap of the "$10" button.
 */
export const MAX_BUNDLED_DONATION_CENTS = 100_000;

/**
 * Read the optional donation riding along with a ticket order.
 *
 * Deliberately separate from `priceTicketOrder`: a donation is not a priced
 * line, it is a number the buyer chose, and the one rule that matters is that
 * it never enters the tax base. Tax is computed per ticket row inside
 * priceTicketOrder and the donation is added to the charge afterwards, so there
 * is no path by which a gift can be taxed.
 *
 * The $1 floor mirrors the donations table's own CHECK constraint — a 40-cent
 * "donation" would be charged and then fail to insert, which is a payment with
 * no record of what it was for.
 */
export function readDonationCents(raw: unknown): { ok: true; cents: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, cents: 0 };
  const cents = Number(raw);
  if (!Number.isInteger(cents) || cents < 0) {
    return { ok: false, error: 'That donation amount is not valid' };
  }
  if (cents === 0) return { ok: true, cents: 0 };
  if (cents < 100) return { ok: false, error: 'The smallest donation we can take is $1' };
  if (cents > MAX_BUNDLED_DONATION_CENTS) {
    return {
      ok: false,
      error:
        'Donations over $1,000 go through our donation page so we can thank you properly — visit /donate.',
    };
  }
  return { ok: true, cents };
}

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

  const tierById = new Map<string, { name: string | null; price: number; is_active: boolean }>();
  for (const t of tierRows || []) {
    tierById.set(t.id, {
      name: t.tier_name ?? null,
      price: Number(t.price),
      is_active: t.is_active !== false,
    });
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
    let tierName: string | null = null;
    if (tierId) {
      const tier = tierById.get(tierId);
      if (!tier) throw new PricingError('Invalid ticket tier for this showing');
      if (!tier.is_active) throw new PricingError('That ticket tier is no longer on sale');
      price = tier.price;
      tierName = tier.name;
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
      tier_name: tierName,
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

/**
 * The Square order lines for a priced ticket order.
 *
 * Lives here, next to the arithmetic that produced the numbers, because the one
 * rule these lines must obey is arithmetic: they have to sum to exactly the
 * amount charged, or Square leaves the order part-paid. Building them anywhere
 * else means building them from a different set of roundings.
 *
 * Tickets are grouped so that Item Sales sees one line per price point rather
 * than one per seat: the film is the item, the tier is its variation, and the
 * quantity is the count. Seat numbers are deliberately absent — Square is being
 * told what was sold, not where anyone sat.
 *
 * The shape, for a two-ticket order with a gift:
 *
 *     A COMPLETE UNKNOWN   x2   $24.00   <- pre-tax, may bind to a catalog item
 *     Sales tax            x1    $1.44   <- ours, never Square's arithmetic
 *     Donation             x1    $5.00   <- outside the tax line, by design
 *                                ------
 *                                $30.44  == the amount charged, exactly
 *
 * Each of the three is a separate line for a separate reason: the film so its
 * gross matches what the register recorded for the same title, the tax because
 * Square cannot reproduce our figure (see below), and the gift because it is
 * contribution income that has never been part of the tax base and should not
 * look like it is.
 */
export function ticketLineItems(order: PricedOrder, donationCents = 0): SquareLineItem[] {
  const groups = new Map<string, { tierName: string | null; cents: number; quantity: number }>();

  for (const ticket of order.tickets) {
    // The **pre-tax** price. A film's line has to mean what the register's line
    // has always meant, or joining them under one catalog item mixes two
    // different quantities in one Item Sales row — see the tax line below.
    const cents = Math.round(ticket.price * 100);
    const key = `${ticket.tier_id ?? ''}|${cents}`;
    const existing = groups.get(key);
    if (existing) existing.quantity += 1;
    else groups.set(key, { tierName: ticket.tier_name, cents, quantity: 1 });
  }

  const lines: SquareLineItem[] = Array.from(groups.values()).map((g) => ({
    name: order.productionTitle,
    quantity: g.quantity,
    amountCents: g.cents,
    variationName: g.tierName,
    // Films are the one thing here with a decade of history in Square's item
    // library. If this title already has an item, the sale should join it.
    lookupCatalog: true,
  }));

  // -------------------------------------------------------------------------
  // Tax, as a line of its own, computed by us
  // -------------------------------------------------------------------------
  //
  // Square is never asked to work the tax out, and that is not a preference —
  // its arithmetic cannot be made to agree with ours. Measured in sandbox:
  //
  //   * Square rounds half-to-even, Postgres ROUND() and Math.round() round
  //     half-up. They differ on every price ending in $.75 ($6.75 -> we say 41c,
  //     Square says 40c).
  //   * Square computes the tax on the order and apportions it across lines,
  //     where we compute per ticket row and sum. Three identical $8.25 lines
  //     came back [49, 50, 49]; ours is 50 three times. So quantity amplifies
  //     the gap even at prices where one ticket agrees.
  //
  // Matching Square would mean rewriting the enforce_ticket_pricing trigger, and
  // with it how every ticket ever sold was priced. So the amount the trigger
  // stores is sent as a fixed line, and the order total is ours by construction.
  //
  // It rides as its own line rather than inside the ticket price so that a
  // film's gross in Square is the pre-tax figure the register recorded for the
  // same catalog item, and so that what is taxed is visibly separate from what
  // is not — the donation below sits outside this line, where the donations
  // table and the tax base both already put it.
  const taxCents = Math.round(order.tax * 100);
  if (taxCents > 0) {
    lines.push({ name: 'Sales tax', quantity: 1, amountCents: taxCents, variationName: null });
  }

  // The rental surcharge, when a production opted into it. Its own line because
  // it is not ticket revenue and should not inflate a film's takings. Never
  // looked up: there is no catalog item for it, and a fuzzy neighbour would be
  // worse than none.
  const feeCents = Math.round(order.processingFee * 100);
  if (feeCents > 0) {
    lines.push({
      name: 'Card processing fee',
      quantity: 1,
      amountCents: feeCents,
      variationName: null,
    });
  }

  // Contribution income, never taxed, never part of the film's revenue — the
  // same separation the donations table enforces, carried into Square.
  if (donationCents > 0) {
    lines.push({ name: 'Donation', quantity: 1, amountCents: donationCents, variationName: null });
  }

  return lines;
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
