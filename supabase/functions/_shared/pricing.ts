// Order pricing — the server's door to the one pricing function.
//
// The arithmetic lives in the database: public.price_ticket_order, reached
// through quote_ticket_order (prices, writes nothing) and create_ticket_order
// (prices, then inserts). Migration …_pricing_rpc.sql, BRIEF-pricing-rpc. It
// used to live here as well, and in the browser, and the three were held in
// step by a vector file and a tripwire trigger. Now there is one, and this file
// is what the edge functions call to reach it: it maps the function's refusals
// to PricingError (same sentences the buyer has always been shown), and reads
// the few showing fields checkout needs that are not prices.
//
// Nothing here computes a price. If you find yourself adding arithmetic to this
// file, it belongs in the SQL, with a vector in pricing_vectors.json and a
// check in supabase/tests/pricing_rpc.

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
  /** NET pre-tax price: list_price less this ticket's share of the discount. */
  price: number;
  tax_amount: number;
  total_price: number;
  /** The tier/showing price before any discount. */
  list_price: number;
  discount_amount: number;
  discount_id: string | null;
  discount_label: string | null;
}

export interface PricedOrder {
  tickets: PricedTicket[];
  /** Net of any discount: what tax is charged on. */
  subtotal: number;
  /** Before the discount. Equals `subtotal` when there is none. */
  listSubtotal: number;
  /** The one rule applied to this order, or null. Never more than one. */
  discount: { id: string; label: string; cents: number } | null;
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
    /** Most tickets one buyer may hold online; null = no cap. See _shared/ticket_limit.ts. */
    max_tickets_per_buyer: number | null;
  };
}

export class PricingError extends Error {
  /** The SQLSTATE the database refused with, when it was the database. */
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

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
 * Why a gift may not ride along on this order, or null if it may.
 *
 * Tickets are deliverable by email *or* phone, and SMS-only ticketing is a real
 * feature rather than an oversight. A gift is not a ticket. What a donation is
 * worth to the theatre beyond the money is the constituent record it becomes in
 * Little Green Light, and LGL keys constituents on an email address — so
 * `_shared/lgl.ts` declines an emailless gift outright, deliberately, rather
 * than seeding the donor database with a record nobody can reach. A phone-only
 * gift is therefore charged, banked, and then permanently un-syncable. That is
 * not hypothetical: it is what happened to a $1 gift on 28 Aug 2026, whose
 * buyer gave a number and no address.
 *
 * The rule is narrow on purpose. It fires only when a gift is actually
 * attached, so a ticket-only order keeps email-or-phone untouched; and only the
 * online paths call it, so the box office still takes an emailless walk-in
 * gift. That walk-in is the case `donations.donor_email` was made nullable for,
 * and such a gift stays correctly recorded locally and unsynced.
 */
export function bundledDonationEmailError(
  email: string | null | undefined,
  donationCents: number,
): string | null {
  if (donationCents <= 0) return null;
  if (email && email.trim()) return null;
  return 'An email address is required to add a donation — it is where the receipt for your gift goes, and how we record it. Remove the donation to check out with a phone number only.';
}

/** The refusal codes price_ticket_order raises. All become a 400 with its sentence. */
const PRICING_REFUSALS = new Set(['PT400', 'PT404', 'PT409', 'PT410']);

/** One row of public.priced_ticket, as PostgREST returns it. */
interface PricedRow {
  seq: number;
  seat_id: string | null;
  tier_id: string | null;
  tier_name: string | null;
  list_price: number | string;
  discount_amount: number | string;
  price: number | string;
  tax_amount: number | string;
  total_price: number | string;
  discount_id: string | null;
  discount_label: string | null;
  order_list_subtotal: number | string;
  order_discount: number | string;
  order_subtotal: number | string;
  order_tax: number | string;
  order_total: number | string;
  order_processing_fee: number | string;
  order_grand_total: number | string;
  production_title: string;
  production_category: string;
}

function refusal(error: { code?: string; message?: string } | null): PricingError | null {
  if (!error) return null;
  if (error.code && PRICING_REFUSALS.has(error.code)) return new PricingError(error.message || 'Could not price this order', error.code);
  return null;
}

/**
 * Price an order without writing anything: what create_ticket_order would
 * write, for the checks checkout makes before it does.
 *
 * `channel` decides which Square rate the surcharge uses; 'none' for a cash
 * sale or a film-pass redemption, which carry no surcharge.
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

  const [{ data: rows, error }, { data: showing }] = await Promise.all([
    admin.rpc('quote_ticket_order', {
      p_showing_id: showingId,
      // Only what the function reads. A forged descriptor cannot smuggle a
      // price, a discount or anything else in: these two keys are all it has.
      p_tickets: descriptors.map((d) => ({ seat_id: d.seat_id ?? null, tier_id: d.tier_id ?? null })),
      p_channel: channel,
    }),
    admin
      .from('showings')
      .select('id, total_seats, requires_seat_selection, start_time, max_tickets_per_buyer')
      .eq('id', showingId)
      .maybeSingle(),
  ]);

  const refused = refusal(error);
  if (refused) throw refused;
  if (error) throw new Error(`quote_ticket_order: ${error.message}`);
  const priced: PricedRow[] = rows ?? [];
  if (priced.length === 0 || !showing) throw new PricingError('Showing not found');

  const first = priced[0];
  const n = (v: number | string) => Number(v);
  const discountCents = Math.round(n(first.order_discount) * 100);

  return {
    tickets: priced.map((r) => ({
      seat_id: r.seat_id,
      tier_id: r.tier_id,
      price: n(r.price),
      tax_amount: n(r.tax_amount),
      total_price: n(r.total_price),
      list_price: n(r.list_price),
      discount_amount: n(r.discount_amount),
      discount_id: r.discount_id,
      discount_label: r.discount_label,
    })),
    subtotal: n(first.order_subtotal),
    listSubtotal: n(first.order_list_subtotal),
    discount: discountCents > 0
      ? {
        id: priced.find((r) => r.discount_id)?.discount_id ?? '',
        label: priced.find((r) => r.discount_label)?.discount_label ?? '',
        cents: discountCents,
      }
      : null,
    tax: n(first.order_tax),
    total: n(first.order_total),
    processingFee: n(first.order_processing_fee),
    grandTotal: n(first.order_grand_total),
    amountCents: Math.round(n(first.order_grand_total) * 100),
    productionTitle: first.production_title,
    productionCategory: first.production_category,
    showing: {
      id: showing.id,
      total_seats: showing.total_seats ?? 200,
      requires_seat_selection: !!showing.requires_seat_selection,
      start_time: showing.start_time,
      max_tickets_per_buyer: showing.max_tickets_per_buyer ?? null,
    },
  };
}

/**
 * Price and write an order in one statement. Returns the rows as stored —
 * the only place a paid ticket row is ever created.
 */
export async function createTicketOrder(
  admin: any,
  params: {
    showingId: string;
    descriptors: TicketDescriptor[];
    paymentMethod: 'online' | 'cash' | 'card';
    userId: string | null;
    orderToken: string;
    status: 'pending' | 'confirmed';
    squarePaymentId?: string | null;
    idempotencyKey?: string | null;
    smsConsent?: boolean | null;
  },
): Promise<{ rows: any[] } | { refused: PricingError } | { error: { code?: string; message: string } }> {
  const { data, error } = await admin.rpc('create_ticket_order', {
    p_showing_id: params.showingId,
    p_tickets: params.descriptors.map((d) => ({ seat_id: d.seat_id ?? null, tier_id: d.tier_id ?? null })),
    p_payment_method: params.paymentMethod,
    p_user_id: params.userId,
    p_order_token: params.orderToken,
    p_status: params.status,
    p_square_payment_id: params.squarePaymentId ?? null,
    p_checkout_idempotency_key: params.idempotencyKey ?? null,
    p_sms_consent: params.smsConsent ?? null,
  });
  const refused = refusal(error);
  if (refused) return { refused };
  if (error) return { error };
  return { rows: data ?? [] };
}
