// Pins Square's rounding — the model square-order.ts predicts totals with —
// to totals SQUARE returned. See pricing_vectors.json.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { halfEvenDiv, taxOnCents } from './order_math.ts';
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
  Deno.test(`taxOnCents is Square's tax — ${v.label}`, () => {
    const subtotal = v.ticket_net_cents.reduce((s: number, c: number) => s + c, 0);
    assertEquals(taxOnCents(subtotal), v.square_tax_cents);
  });
}
