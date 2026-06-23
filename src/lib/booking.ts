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

export function buildTicketRows({
  lineItems,
  userId,
  showingId,
  paymentMethod,
  selectedSeats,
  quantity,
  ticketPrice,
  processingFee = 0,
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
}) {
  const fee = Math.max(0, Math.round((processingFee || 0) * 100) / 100);
  const stamp = (rows: any[]) => {
    if (rows.length > 0 && fee > 0) rows[0].processing_fee = fee;
    return rows;
  };
  // New tiered path
  if (lineItems && lineItems.length > 0) {
    const rows: any[] = [];
    for (const item of lineItems) {
      const price = Number(item.price);
      const taxAmount = Math.round(price * TAX_RATE * 100) / 100;
      const totalPrice = Math.round(price * (1 + TAX_RATE) * 100) / 100;

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
  const taxAmount = Math.round(price * TAX_RATE * 100) / 100;
  const totalPrice = Math.round(price * (1 + TAX_RATE) * 100) / 100;

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

export function computeOrderTotals(ticketCount: number, ticketPrice: number) {
  const subtotal = ticketCount * ticketPrice;
  const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  return { subtotal, tax, total };
}

export function computeLineItemTotals(lineItems: TicketLineItem[]) {
  let subtotal = 0;
  let totalCount = 0;
  for (const item of lineItems) {
    const qty = item.seatIds ? item.seatIds.length : item.quantity;
    subtotal += qty * item.price;
    totalCount += qty;
  }
  const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  return { subtotal, tax, total, totalCount };
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
