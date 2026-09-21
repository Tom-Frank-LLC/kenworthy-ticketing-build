import { describe, expect, it } from 'vitest';
import { apportionOrderTax } from './orderMath';
import { buildTicketRows, computeSeatTotals } from './booking';
import vectors from '../../supabase/functions/_shared/pricing_vectors.json';
import here from './orderMath.ts?raw';
import there from '../../supabase/functions/_shared/order_math.ts?raw';

/**
 * The order arithmetic exists three times — this file's subject, its Deno twin
 * `supabase/functions/_shared/order_math.ts`, and the database trigger — and the
 * one thing all three must agree with is Square. `pricing_vectors.json` holds
 * totals Square's sandbox returned; each implementation has a suite asserting
 * them (this one, `order_math_test.ts`, `supabase/tests/order_tax`).
 */
describe('orderMath', () => {
  it('is byte-identical to its Deno twin', () => {
    // Two hand-kept copies drift. These two may not: edit one, copy it over.
    expect(here).toBe(there);
  });

  for (const v of vectors.tax_only) {
    it(`agrees with Square — ${v.label}`, () => {
      const subtotal = v.ticket_net_cents.reduce((s, c) => s + c, 0);
      const { taxCents, perTicket } = apportionOrderTax(v.ticket_net_cents);
      expect(taxCents).toBe(v.square_tax_cents);
      expect(subtotal + taxCents).toBe(v.square_total_cents);
      expect(perTicket.reduce((s, c) => s + c, 0)).toBe(taxCents);

      // What the page shows is the same number.
      const shown = computeSeatTotals(v.ticket_net_cents.map((c) => c / 100));
      expect(Math.round(shown.total * 100)).toBe(v.square_total_cents);
    });
  }
});

describe('buildTicketRows', () => {
  const cents = (n: number) => Math.round(Number(n) * 100);

  it('writes rows that sum to the order, which the database will insist on', () => {
    // The box office inserts these straight through PostgREST, and
    // enforce_ticket_order_tax refuses an order whose rows do not add up to
    // Square's tax. Four at $8.25: 1.98 of tax, not 4 × 0.50.
    const rows = buildTicketRows({
      userId: 'staff', showingId: 's', paymentMethod: 'cash',
      lineItems: [{ tierId: 't', tierName: 'Student', price: 8.25, quantity: 4 }],
    });
    expect(rows.map((r) => cents(r.tax_amount))).toEqual([50, 49, 49, 50]);
    expect(rows.reduce((s, r) => s + cents(r.total_price), 0)).toBe(3498);
    for (const r of rows) expect(cents(r.price) + cents(r.tax_amount)).toBe(cents(r.total_price));
  });

  it('apportions across tiers in one pass, not tier by tier', () => {
    // Per tier: 2 × 8.25 → 0.99, 1 × 6.75 → 0.40, total 1.39. As one order,
    // 23.25 → 1.395 → 1.40. The order is what Square taxes.
    const rows = buildTicketRows({
      userId: 'staff', showingId: 's', paymentMethod: 'card',
      lineItems: [
        { tierId: 'a', tierName: 'Student', price: 8.25, quantity: 2 },
        { tierId: 'b', tierName: 'Child', price: 6.75, quantity: 1 },
      ],
    });
    expect(rows.reduce((s, r) => s + cents(r.tax_amount), 0)).toBe(140);
  });

  it('leaves today\'s prices exactly as they were', () => {
    const rows = buildTicketRows({
      userId: 'staff', showingId: 's', paymentMethod: 'cash', quantity: 3, ticketPrice: 8,
    });
    expect(rows.map((r) => [r.price, r.tax_amount, r.total_price])).toEqual([
      [8, 0.48, 8.48], [8, 0.48, 8.48], [8, 0.48, 8.48],
    ]);
  });
});
