// Order arithmetic — Square's, because Square's is the one we cannot change.
//
// Measured against the Square sandbox (docs/FINDINGS-square-order-arithmetic.md):
// Square taxes the ORDER, once, on the sum of its taxed lines, and rounds
// half-to-even. It does not tax per line, and how the lines are shaped makes no
// difference to the total. We used to tax each ticket and round half-up, which
// agrees with Square only while every price is a multiple of 50 cents — 6% of
// which is a whole number of cents, so nothing rounds at all. At $8.25, or at
// 25% off $9, the two disagree, the checkout's reconciliation guard trips, and
// the Square order is abandoned to a bare payment.
//
// So the order's tax is computed here the way Square computes it, and then
// apportioned to ticket rows so that SUM(tickets.tax_amount) is exactly that
// figure. The invariant every other part of the system leans on is unchanged:
// the charge equals SUM(tickets.total_price). Refunds, cash-sale recording and
// the Square-vs-site reconciliation all re-read those rows.
//
// The database enforces the same sum (enforce_ticket_order_tax, migration
// 20260921…_order_level_tax.sql). pricing_vectors.json pins this file, its
// browser twin and that trigger to totals Square itself returned.
//
// THIS FILE HAS A BYTE-IDENTICAL TWIN: src/lib/orderMath.ts. It imports nothing
// so that it can. src/lib/orderMath.test.ts fails if the two differ — edit one,
// copy it over the other.

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

/**
 * The order's tax, and each ticket's share of it.
 *
 * `netCents` is what each ticket costs before tax, in the order the rows will be
 * written. The shares are cumulative: ticket i carries tax(first i tickets)
 * minus what the earlier tickets already carry. That makes the shares sum to
 * the order's tax by construction, keeps each within a cent of its own 6%, and
 * gives a free ticket no tax. It is also how Square spreads its own cents
 * across lines — four $6.75 tickets come back 40, 41, 40, 41.
 */
export function apportionOrderTax(netCents: number[]): { taxCents: number; perTicket: number[] } {
  const perTicket: number[] = [];
  let runningBase = 0;
  let runningTax = 0;
  for (const net of netCents) {
    runningBase += net;
    const taxSoFar = taxOnCents(runningBase);
    perTicket.push(taxSoFar - runningTax);
    runningTax = taxSoFar;
  }
  return { taxCents: runningTax, perTicket };
}
