// Types the booking screens share, and the order token.
//
// This file used to hold the browser's copy of the pricing arithmetic. That is
// gone: the running total is asked of the database (lib/quote.ts →
// quote_ticket_order), and rows are written by create_ticket_order. Nothing in
// the browser computes a price. BRIEF-pricing-rpc.

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

export interface TicketLineItem {
  tierId: string;
  tierName: string;
  price: number;
  quantity: number;
  seatIds?: string[]; // for assigned seating
}

/**
 * Token shared by every ticket in one purchase. Stands in for the orders
 * table this schema does not have: it is what the confirmation and the public
 * ticket page use to address a whole order. Random and unguessable, because
 * holding it is what proves you were sent the ticket.
 */
export function newOrderToken(): string {
  return crypto.randomUUID();
}
