export interface Seat {
  id: string;
  seat_row: string;
  seat_number: number;
  seat_type: string;
  section?: string | null;
}

export interface PriceTier {
  id: string;
  tier_name: string;
  price: number;
  display_order: number;
  color?: string | null;
}

export const TAX_RATE = 0.06;

export interface TicketLineItem {
  tierId: string;
  tierName: string;
  price: number;
  quantity: number;
  seatIds?: string[]; // for assigned seating
}

/**
 * Token shared by every ticket in one purchase.
 *
 * Stands in for the orders table this schema does not have: it is what the
 * confirmation email/SMS and the public ticket page use to address a whole
 * order, so a four-ticket purchase is one link rather than four. Random and
 * unguessable, because holding it is what proves you were sent the ticket.
 */
export function newOrderToken(): string {
  return crypto.randomUUID();
}

export function buildTicketRows({
  lineItems,
  userId,
  showingId,
  paymentMethod,
  selectedSeats,
  quantity,
  ticketPrice,
  processingFee = 0,
  orderToken,
  squarePaymentId,
}: {
  lineItems?: TicketLineItem[];
  userId: string;
  showingId: string;
  paymentMethod: string;
  // Legacy single-price params (used when no tiers)
  selectedSeats?: Set<string>;
  quantity?: number;
  ticketPrice?: number;
  // Buyer-paid Square processing surcharge for the whole order.
  // Attributed entirely to the first ticket row so refunds can recover it
  // without needing a separate orders table.
  processingFee?: number;
  // Groups these rows into one deliverable order. Generated per purchase by
  // the caller so it can pass the same token to the confirmation sender.
  orderToken?: string;
  // Square payment behind a box-office card sale. Without it a refund can only
  // flip a status column — the customer's card is never credited.
  squarePaymentId?: string | null;
}) {
  const fee = Math.max(0, Math.round((processingFee || 0) * 100) / 100);
  const token = orderToken || newOrderToken();
  const stamp = (rows: any[]) => {
    if (rows.length > 0 && fee > 0) rows[0].processing_fee = fee;
    for (const row of rows) {
      row.order_token = token;
      if (squarePaymentId) row.square_payment_id = squarePaymentId;
    }
    return rows;
  };
  // New tiered path
  if (lineItems && lineItems.length > 0) {
    const rows: any[] = [];
    for (const item of lineItems) {
      const price = Number(item.price);
      // Integer cents, matching the trigger that overwrites these on insert.
      const taxAmount = ticketTaxCents(price) / 100;
      const totalPrice = (Math.round(price * 100) + ticketTaxCents(price)) / 100;

      if (item.seatIds && item.seatIds.length > 0) {
        // Assigned seating with tier
        for (const seatId of item.seatIds) {
          rows.push({
            user_id: userId,
            showing_id: showingId,
            seat_id: seatId,
            tier_id: item.tierId,
            price,
            tax_rate: TAX_RATE,
            tax_amount: taxAmount,
            total_price: totalPrice,
            qr_code: crypto.randomUUID(),
            status: 'confirmed',
            payment_method: paymentMethod,
          });
        }
      } else {
        // GA with tier
        for (let i = 0; i < item.quantity; i++) {
          rows.push({
            user_id: userId,
            showing_id: showingId,
            seat_id: null,
            tier_id: item.tierId,
            price,
            tax_rate: TAX_RATE,
            tax_amount: taxAmount,
            total_price: totalPrice,
            qr_code: crypto.randomUUID(),
            status: 'confirmed',
            payment_method: paymentMethod,
          });
        }
      }
    }
    return stamp(rows);
  }

  // Legacy single-price path (no tiers configured)
  const price = Number(ticketPrice || 0);
  const taxAmount = ticketTaxCents(price) / 100;
  const totalPrice = (Math.round(price * 100) + ticketTaxCents(price)) / 100;

  const baseRow = {
    user_id: userId,
    showing_id: showingId,
    price,
    tax_rate: TAX_RATE,
    tax_amount: taxAmount,
    total_price: totalPrice,
    qr_code: '',
    status: 'confirmed',
    payment_method: paymentMethod,
  };

  if (selectedSeats && selectedSeats.size > 0) {
    return stamp(Array.from(selectedSeats).map(seatId => ({
      ...baseRow,
      seat_id: seatId,
      qr_code: crypto.randomUUID(),
    })));
  }

  const count = quantity || 0;
  return stamp(Array.from({ length: count }, () => ({
    ...baseRow,
    seat_id: null,
    qr_code: crypto.randomUUID(),
  })));
}

/** Tax on one ticket, in integer cents. */
export function ticketTaxCents(price: number) {
  return Math.round(Math.round(price * 100) * TAX_RATE);
}

/**
 * Totals for a set of tickets, computed the way the server and the database do.
 *
 * Two rules, both of which exist to keep the price shown equal to the price
 * charged:
 *
 *  1. **Tax is rounded per ticket**, because `enforce_ticket_pricing` stores
 *     `ROUND(price * 0.06, 2)` on each row and the charge is the sum of the
 *     rows. Rounding once on the subtotal disagrees by a cent at some
 *     quantities.
 *  2. **The arithmetic is in integer cents.** In floating point,
 *     `4.25 * 0.06 * 100` is 25.499999999999996 and rounds to 25, while the
 *     database computes 25.5 in exact numeric and rounds to 26. A cent of
 *     disagreement here is a customer charged more than the page quoted.
 */
function totalsFor(prices: number[]) {
  const subtotalCents = prices.reduce((sum, price) => sum + Math.round(price * 100), 0);
  const taxCents = prices.reduce((sum, price) => sum + ticketTaxCents(price), 0);
  return {
    subtotal: subtotalCents / 100,
    tax: taxCents / 100,
    total: (subtotalCents + taxCents) / 100,
  };
}

export function computeOrderTotals(ticketCount: number, ticketPrice: number) {
  return totalsFor(Array.from({ length: Math.max(0, ticketCount) }, () => Number(ticketPrice)));
}

export function computeLineItemTotals(lineItems: TicketLineItem[]) {
  const prices: number[] = [];
  for (const item of lineItems) {
    const qty = item.seatIds ? item.seatIds.length : item.quantity;
    for (let i = 0; i < qty; i++) prices.push(Number(item.price));
  }
  return { ...totalsFor(prices), totalCount: prices.length };
}

/** Assigned seating where each seat carries its own tier price. */
export function computeSeatTotals(seatPrices: number[]) {
  return totalsFor(seatPrices.map(Number));
}

// Square processing fee rates (sandbox-aligned with production pricing).
// We compute the buyer-facing surcharge by "grossing up" so the venue nets
// the full ticket subtotal + tax after Square takes its cut from the charge.
//   total = (net + fixed) / (1 - pct)
//   fee   = total - net
// Sources: squareup.com/us/en/pricing
//   - Online / keyed entry: 2.9% + $0.30
//   - In-person (Terminal / card-present): 2.6% + $0.10
export const SQUARE_RATES = {
  online:    { pct: 0.029, fixed: 0.30 },
  in_person: { pct: 0.026, fixed: 0.10 },
} as const;

export type ProcessingChannel = keyof typeof SQUARE_RATES;

export function computeProcessingFee(netAmount: number, channel: ProcessingChannel) {
  const { pct, fixed } = SQUARE_RATES[channel];
  const grossed = (netAmount + fixed) / (1 - pct);
  const total = Math.round(grossed * 100) / 100;
  const fee = Math.round((total - netAmount) * 100) / 100;
  return { fee, total };
}
