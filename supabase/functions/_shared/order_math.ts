// Square's rounding, for predicting Square's total.
//
// `_shared/square-order.ts` computes `expectedTotalCents` — what Square will
// say an order comes to — before the order is sent, so a disagreement is caught
// before a card is charged. That prediction needs Square's arithmetic: tax on
// the order's taxable sum, once, rounded half-to-even (measured;
// docs/FINDINGS-square-order-arithmetic.md). That is all this file holds now.
//
// It used to hold the pricing as well — discounts, apportionment, tier names —
// twinned into the browser. The pricing is in the database
// (price_ticket_order; BRIEF-pricing-rpc) and the twin is gone. The SQL
// `round_half_even_div` / `order_tax_cents` are the same two functions; the
// harness (supabase/tests/pricing_rpc) and pricing_vectors.json hold both to
// Square's own totals.

/** Sales tax, as a whole-number percentage. */
export const TAX_PERCENT = 6;

/**
 * n / d, rounded half-to-even. Integers in, integer out.
 *
 * Neither `Math.round` (half-up) nor Postgres `ROUND(numeric)` (half away from
 * zero) is this. 40.5 is 40 here and 41 there; 49.5 is 50 in all three, which
 * is how an earlier probe at $8.25 failed to notice the difference.
 */
export function halfEvenDiv(n: number, d: number): number {
  const q = Math.floor(n / d);
  const twiceRemainder = 2 * (n - q * d);
  if (twiceRemainder > d) return q + 1;
  if (twiceRemainder === d && q % 2 !== 0) return q + 1;
  return q;
}

/** Tax on a taxable base, the way Square totals an order. */
export function taxOnCents(baseCents: number): number {
  return halfEvenDiv(baseCents * TAX_PERCENT, 100);
}
