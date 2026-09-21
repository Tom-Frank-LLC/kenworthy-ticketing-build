// Pins order_math.ts to totals SQUARE returned, not to our own arithmetic.
// See pricing_vectors.json and docs/FINDINGS-square-order-arithmetic.md.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  applyDiscount,
  apportionOrderTax,
  bestDiscount,
  type DiscountRule,
  halfEvenDiv,
  taxOnCents,
} from './order_math.ts';
import vectors from './pricing_vectors.json' with { type: 'json' };

Deno.test('halfEvenDiv rounds a tie to the even neighbour', () => {
  assertEquals(halfEvenDiv(405, 10), 40); // 40.5 — Math.round says 41
  assertEquals(halfEvenDiv(495, 10), 50); // 49.5 — the case that hides the difference
  assertEquals(halfEvenDiv(645, 10), 64);
  assertEquals(halfEvenDiv(45, 10), 4);
  assertEquals(halfEvenDiv(15, 10), 2);
});

Deno.test('halfEvenDiv rounds everything else to nearest', () => {
  assertEquals(halfEvenDiv(404, 10), 40);
  assertEquals(halfEvenDiv(406, 10), 41);
  assertEquals(halfEvenDiv(0, 100), 0);
  assertEquals(halfEvenDiv(4800, 100), 48);
});

for (const v of vectors.tax_only) {
  Deno.test(`Square agrees — ${v.label}`, () => {
    const { taxCents, perTicket } = apportionOrderTax(v.ticket_net_cents);
    const subtotal = v.ticket_net_cents.reduce((s: number, c: number) => s + c, 0);

    assertEquals(taxCents, v.square_tax_cents);
    assertEquals(subtotal + taxCents, v.square_total_cents);

    // The rows must add up to the order — this is what refunds re-read.
    assertEquals(perTicket.reduce((s, c) => s + c, 0), taxCents);
    assertEquals(perTicket.length, v.ticket_net_cents.length);

    // No ticket strays more than a cent from its own 6%, and a free one carries
    // none. The database row trigger enforces the same bound.
    perTicket.forEach((tax, i) => {
      const exact = v.ticket_net_cents[i] * 0.06;
      if (Math.abs(tax - exact) > 1) throw new Error(`ticket ${i}: ${tax} vs ${exact}`);
      if (v.ticket_net_cents[i] === 0) assertEquals(tax, 0);
    });
  });
}

Deno.test('at a 50-cent price nothing rounds, so every ticket carries exactly its own 6%', () => {
  // Why changing the model changed no existing sale.
  assertEquals(apportionOrderTax([800, 800, 1450, 1000]).perTicket, [48, 48, 87, 60]);
  assertEquals(taxOnCents(800), 48);
});

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------

const rule = (over: Partial<DiscountRule>): DiscountRule => ({
  id: 'r1', type: 'percent', value: 25, min_quantity: 4, label: '25% off 4+',
  created_at: '2026-01-01T00:00:00Z', ...over,
});

for (const v of vectors.discounted) {
  Deno.test(`Square agrees, discounted — ${v.label}`, () => {
    const applied = applyDiscount(rule(v.rule as Partial<DiscountRule>), v.ticket_list_cents)!;
    assertEquals(applied.discountCents, v.square_discount_cents);
    assertEquals(applied.perTicket.reduce((s, c) => s + c, 0), applied.discountCents);

    const net = v.ticket_list_cents.map((c: number, i: number) => c - applied.perTicket[i]);
    const { taxCents, perTicket } = apportionOrderTax(net);
    assertEquals(taxCents, v.square_tax_cents);
    assertEquals(net.reduce((s: number, c: number) => s + c, 0) + taxCents, v.square_total_cents);
    assertEquals(perTicket.reduce((s, c) => s + c, 0), taxCents);

    // No ticket is discounted below zero, and a free one is not discounted.
    net.forEach((c: number, i: number) => {
      if (c < 0) throw new Error(`ticket ${i} went negative`);
      if (v.ticket_list_cents[i] === 0) assertEquals(applied.perTicket[i], 0);
    });

    // Where Square was also asked to apply the percentage itself, it got the
    // same discount and total — so our rounding of D is Square's, not just ours.
    if ('square_native_percent' in v) {
      assertEquals(applied.discountCents, v.square_native_percent!.discount_cents);
      assertEquals(v.square_total_cents, v.square_native_percent!.total_cents);
    }
  });
}

Deno.test('a rule does not apply below its minimum quantity', () => {
  assertEquals(applyDiscount(rule({}), [900, 900, 900]), null);
  assertEquals(applyDiscount(rule({}), [900, 900, 900, 900])!.discountCents, 900);
});

Deno.test('free tickets do not count towards the minimum', () => {
  assertEquals(applyDiscount(rule({}), [0, 900, 900, 900]), null);
});

Deno.test('an order of free tickets is never discounted', () => {
  assertEquals(applyDiscount(rule({ min_quantity: 1 }), [0, 0]), null);
  assertEquals(bestDiscount([rule({ min_quantity: 1 })], [0, 0]), null);
});

Deno.test('one rule only: the one that takes the most off', () => {
  const pct = rule({ id: 'pct' });                                                     // 900 off 4 x $9
  const each = rule({ id: 'each', type: 'fixed_per_ticket', value: 2 });                // 800
  const order = rule({ id: 'order', type: 'fixed_per_order', value: 10 });              // 1000
  const best = bestDiscount([pct, each, order], [900, 900, 900, 900])!;
  assertEquals(best.rule.id, 'order');
  assertEquals(best.discountCents, 1000); // not 900 + 800 + 1000
});

Deno.test('a tie goes to the older rule, then the lower id, whatever order they arrive in', () => {
  const a = rule({ id: 'b-newer', created_at: '2026-02-01T00:00:00Z' });
  const b = rule({ id: 'a-older', created_at: '2026-01-01T00:00:00Z' });
  const c = rule({ id: 'a-older-twin', created_at: '2026-01-01T00:00:00Z' });
  const list = [900, 900, 900, 900];
  assertEquals(bestDiscount([a, b, c], list)!.rule.id, 'a-older');
  assertEquals(bestDiscount([c, b, a], list)!.rule.id, 'a-older');
});

Deno.test('a bigger order can change which rule is best', () => {
  const pct = rule({ id: 'pct', value: 10, min_quantity: 1 });
  const flat = rule({ id: 'flat', type: 'fixed_per_order', value: 5, min_quantity: 1 });
  assertEquals(bestDiscount([pct, flat], [1000, 1000])!.rule.id, 'flat');        // 200 vs 500
  assertEquals(bestDiscount([pct, flat], Array(8).fill(1000))!.rule.id, 'pct');  // 800 vs 500
});
