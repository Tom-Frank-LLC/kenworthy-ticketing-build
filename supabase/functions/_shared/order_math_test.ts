// Pins order_math.ts to totals SQUARE returned, not to our own arithmetic.
// See pricing_vectors.json and docs/FINDINGS-square-order-arithmetic.md.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { apportionOrderTax, halfEvenDiv, taxOnCents } from './order_math.ts';
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
