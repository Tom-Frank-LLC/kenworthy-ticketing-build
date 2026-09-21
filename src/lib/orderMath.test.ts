import { describe, expect, it } from 'vitest';
import { applyDiscount, apportionOrderTax, type DiscountRule } from './orderMath';
import { buildTicketRows, computeOrderTotals, computeSeatTotals } from './booking';
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

describe('discounts', () => {
  for (const v of vectors.discounted) {
    it(`agrees with Square — ${v.label}`, () => {
      const rule = { id: 'r', label: 'x', created_at: '2026-01-01T00:00:00Z', ...v.rule } as DiscountRule;
      const applied = applyDiscount(rule, v.ticket_list_cents)!;
      const net = v.ticket_list_cents.map((c, i) => c - applied.perTicket[i]);
      const { taxCents } = apportionOrderTax(net);
      expect(applied.discountCents).toBe(v.square_discount_cents);
      expect(taxCents).toBe(v.square_tax_cents);
      expect(net.reduce((s, c) => s + c, 0) + taxCents).toBe(v.square_total_cents);
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

describe('discount preview and box-office rows', () => {
  const cents = (n: number) => Math.round(Number(n) * 100);
  const rule: DiscountRule = {
    id: 'rule-25', type: 'percent', value: 25, min_quantity: 4, label: '25% off 4+ tickets',
    created_at: '2026-01-01T00:00:00Z',
  };

  it('quotes full price at three tickets and the discount at four', () => {
    expect(computeOrderTotals(3, 9, [rule])).toEqual({ subtotal: 27, discount: null, tax: 1.62, total: 28.62 });
    expect(computeOrderTotals(4, 9, [rule])).toEqual({
      subtotal: 36,
      discount: { id: 'rule-25', label: '25% off 4+ tickets', amount: 9 },
      tax: 1.62,
      total: 28.62, // Square's own total for this order
    });
  });

  it('the summary adds up on screen: subtotal − discount + tax = total', () => {
    const t = computeOrderTotals(7, 9, [rule]);
    expect(cents(t.subtotal) - cents(t.discount!.amount) + cents(t.tax)).toBe(cents(t.total));
    expect(cents(t.total)).toBe(5009);
  });

  it('box-office rows carry the rule, their share, the NET price, and sum to Square\'s total', () => {
    const rows = buildTicketRows({
      userId: 'staff', showingId: 's', paymentMethod: 'cash', quantity: 5, ticketPrice: 9,
      discountRules: [rule],
    });
    expect(rows.every((r) => r.discount_id === 'rule-25' && r.discount_label === '25% off 4+ tickets')).toBe(true);
    expect(rows.reduce((s, r) => s + cents(r.discount_amount), 0)).toBe(1125);
    for (const r of rows) expect(900 - cents(r.discount_amount)).toBe(cents(r.price));
    expect(rows.reduce((s, r) => s + cents(r.total_price), 0)).toBe(3577); // vector: 25% off 5 x $9
  });

  it('writes no discount fields worth the name when no rule applies', () => {
    const rows = buildTicketRows({
      userId: 'staff', showingId: 's', paymentMethod: 'cash', quantity: 3, ticketPrice: 9,
      discountRules: [rule],
    });
    expect(rows.map((r) => [r.discount_id, r.discount_amount, r.price])).toEqual([[null, 0, 9], [null, 0, 9], [null, 0, 9]]);
  });
});
