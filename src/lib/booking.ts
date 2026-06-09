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
}: {
  lineItems?: TicketLineItem[];
  userId: string;
  showingId: string;
  paymentMethod: string;
  // Legacy single-price params (used when no tiers)
  selectedSeats?: Set<string>;
  quantity?: number;
  ticketPrice?: number;
}) {
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
    return rows;
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
    return Array.from(selectedSeats).map(seatId => ({
      ...baseRow,
      seat_id: seatId,
      qr_code: crypto.randomUUID(),
    }));
  }

  const count = quantity || 0;
  return Array.from({ length: count }, () => ({
    ...baseRow,
    seat_id: null,
    qr_code: crypto.randomUUID(),
  }));
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
