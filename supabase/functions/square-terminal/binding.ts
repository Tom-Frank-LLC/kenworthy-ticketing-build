// The testable half of square-terminal: does a Square Terminal checkout belong
// to the counter order being confirmed, and how an order token may be logged.
//
// index.ts calls Deno.serve at import time, so nothing in it can be imported
// by a test.

/** Square caps a checkout's reference_id at 40 characters; start_sale writes
 *  the order token, truncated to that. A UUID token (36) fits whole. */
export const REFERENCE_ID_MAX = 40;

/**
 * True when this checkout was started for this order.
 *
 * start_sale sets the checkout's reference_id to the order token. Without this
 * check confirm_sale took any COMPLETED checkout whose amount covered the
 * order, so one swipe could confirm any number of later counter orders
 * (security audit 2026-10-06, L1). A checkout with no reference_id was not
 * started by start_sale, and is refused rather than trusted.
 */
export function checkoutMatchesOrder(
  checkout: { reference_id?: unknown } | null | undefined,
  orderToken: string,
): boolean {
  const ref = typeof checkout?.reference_id === 'string' ? checkout.reference_id : '';
  const token = orderToken.trim();
  return ref.length > 0 && token.length > 0 && ref === token.slice(0, REFERENCE_ID_MAX);
}

/**
 * True when this Square payment was taken for this order.
 *
 * The box-office Stand (BRIEF-ios-stand-reader.md) takes the card on the iPad
 * through Square's Mobile Payments SDK, with `referenceId` set to what
 * start_sale returned: the order token, cut to 40. confirm_sale reads the
 * payment back from Square and holds it to the same rule as a Terminal
 * checkout, for the same reason (L1): without it, any completed payment id
 * would confirm any order it covered. No reference, no match.
 */
export function paymentMatchesOrder(
  payment: { reference_id?: unknown } | null | undefined,
  orderToken: string,
): boolean {
  return checkoutMatchesOrder(payment, orderToken);
}

/**
 * An order token as it may appear in a log line.
 *
 * The token is the bearer credential behind /t/:token and the ticket QR codes,
 * so whoever reads the function logs could otherwise open the order. Eight
 * characters is enough to find the order from the admin side, and not enough
 * to open it (L15).
 */
export function logToken(orderToken: string): string {
  return orderToken ? `${orderToken.slice(0, 8)}…` : '(none)';
}

/**
 * What the Stand at the patron-facing display may charge for this Square
 * Order (BRIEF-stand-at-patron-display.md), or why it may not.
 *
 * The till tells the display which order to charge over the pairing channel,
 * which anyone holding the code can write to. So the display does not take an
 * amount from the till: it asks the server, and the server answers from the
 * order Square holds — the one start_sale created — held to the pending rows.
 * The order must be ours (location), still OPEN, name its order token, and
 * total the rows plus at most the counter's gift cap. Square's total is the
 * amount: the order already carries the gift.
 */
export function standChargeFromOrder(
  order: {
    id?: unknown; state?: unknown; location_id?: unknown; reference_id?: unknown;
    total_money?: { amount?: unknown } | null;
  } | null | undefined,
  locationId: string,
  rowsCents: number,
  maxGiftCents: number,
): { ok: true; orderToken: string; amountCents: number } | { ok: false; status: number; error: string } {
  if (!order || typeof order.id !== 'string') return { ok: false, status: 404, error: 'No such Square order' };
  if (order.location_id !== locationId) return { ok: false, status: 409, error: 'That Square order is at a different location' };
  if (order.state !== 'OPEN') return { ok: false, status: 409, error: 'That sale is no longer waiting for a card' };
  const token = typeof order.reference_id === 'string' ? order.reference_id.trim() : '';
  if (!token) return { ok: false, status: 409, error: 'That Square order is not a box-office sale' };
  const amount = order.total_money?.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false, status: 409, error: 'That Square order has no total' };
  }
  if (amount < rowsCents || amount - rowsCents > maxGiftCents) {
    return { ok: false, status: 409, error: 'That Square order does not match the tickets it is for' };
  }
  return { ok: true, orderToken: token, amountCents: amount };
}
