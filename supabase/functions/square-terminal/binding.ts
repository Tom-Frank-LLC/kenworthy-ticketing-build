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
