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

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------
//
// One rule per order, never stacked. A rule produces ONE number for the order —
// D, in cents — which is then shared out across the tickets, and tax is taken
// on what is left. That is the shape Square uses (FINDINGS: a percentage is
// rounded once on the order-wide sum, half-to-even), and it is what lets all
// three rule types share everything downstream of D.
//
// "Eligible" means a ticket with a price. A free ticket is never discounted and
// never counts towards a rule's minimum quantity.

export type DiscountType = 'percent' | 'fixed_per_ticket' | 'fixed_per_order';

export interface DiscountRule {
  id: string;
  type: DiscountType;
  /** Percent (25 = 25%) for `percent`; dollars for the two fixed types. */
  value: number;
  min_quantity: number;
  label: string;
  /** ISO timestamp. The tie-break, so every copy of this picks the same rule. */
  created_at: string;
}

export interface AppliedDiscount {
  rule: DiscountRule;
  discountCents: number;
  /** Cents off each ticket, in ticket order. Sums to discountCents. */
  perTicket: number[];
}

/** What this rule takes off these tickets, or null if it does not apply. */
export function applyDiscount(rule: DiscountRule, listCents: number[]): AppliedDiscount | null {
  const eligible = listCents.filter((c) => c > 0);
  if (eligible.length === 0 || eligible.length < Math.max(1, rule.min_quantity)) return null;
  const eligibleTotal = eligible.reduce((s, c) => s + c, 0);

  let perTicket: number[];
  if (rule.type === 'fixed_per_ticket') {
    // Not a share of anything: each ticket loses the same amount, capped at its
    // own price so a $2 coupon cannot make a $1 ticket cost -$1.
    const off = Math.round(rule.value * 100);
    perTicket = listCents.map((c) => Math.min(off, c));
  } else {
    const orderCents = rule.type === 'percent'
      // Basis points, so 12.5% is exact. Rounded once, on the order.
      ? halfEvenDiv(Math.round(rule.value * 100) * eligibleTotal, 10000)
      : Math.min(Math.round(rule.value * 100), eligibleTotal);
    // Shared out in proportion to price, cumulatively — the same construction as
    // the tax shares, for the same reason: the parts sum to the whole exactly.
    perTicket = [];
    let runningList = 0;
    let runningOff = 0;
    for (const c of listCents) {
      runningList += c;
      const offSoFar = halfEvenDiv(orderCents * runningList, eligibleTotal);
      perTicket.push(offSoFar - runningOff);
      runningOff = offSoFar;
    }
  }

  const discountCents = perTicket.reduce((s, c) => s + c, 0);
  if (discountCents <= 0) return null;
  return { rule, discountCents, perTicket };
}

/**
 * The single best rule for these tickets: the one that takes the most off.
 * Ties go to the older rule, then the lower id — arbitrary, but the same
 * arbitrary everywhere, so the page, the server and the box office agree.
 */
export function bestDiscount(rules: DiscountRule[], listCents: number[]): AppliedDiscount | null {
  let best: AppliedDiscount | null = null;
  for (const rule of rules) {
    const applied = applyDiscount(rule, listCents);
    if (!applied) continue;
    if (
      !best ||
      applied.discountCents > best.discountCents ||
      (applied.discountCents === best.discountCents &&
        (rule.created_at < best.rule.created_at ||
          (rule.created_at === best.rule.created_at && rule.id < best.rule.id)))
    ) {
      best = applied;
    }
  }
  return best;
}

/** A `ticket_discounts` row as PostgREST returns it. */
export interface DiscountRuleRow {
  id: string;
  type: DiscountType;
  value: number | string;
  min_quantity: number;
  label: string;
  created_at: string;
  is_active?: boolean | null;
  code?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

/**
 * The rules that may apply automatically at this instant: active, inside their
 * window, and carrying no promo code. The database applies the same three tests
 * when the order is written (enforce_ticket_order_totals), against its own clock.
 */
export function usableRules(rows: DiscountRuleRow[], nowMs: number): DiscountRule[] {
  return rows
    .filter((r) => r.is_active !== false && !r.code)
    .filter((r) => !r.starts_at || Date.parse(r.starts_at) <= nowMs)
    .filter((r) => !r.ends_at || nowMs < Date.parse(r.ends_at))
    .map((r) => ({
      id: r.id,
      type: r.type,
      value: Number(r.value),
      min_quantity: r.min_quantity,
      label: r.label,
      created_at: r.created_at,
    }));
}
