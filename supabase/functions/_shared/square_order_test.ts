import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildTicketOrder,
  orderRequestBody,
  type TicketGroup,
} from './square-order.ts';
import vectors from './pricing_vectors.json' with { type: 'json' };

/**
 * These numbers are the charge. If the order Square totals differs from
 * SUM(tickets.total_price), the payment no longer matches our own rows and
 * square-refund refunds the wrong amount — silently, because both sides look
 * internally consistent.
 */

const g = (over: Partial<TicketGroup> = {}): TicketGroup => ({
  tierKey: 'Adult',
  displayName: 'Adult - Wednesday, September 16 at 7 PM',
  variationId: 'VAR_ADULT',
  unitPriceCents: 800,
  count: 1,
  ...over,
});

Deno.test('a whole-dollar tier aggregates onto one line', () => {
  // The convention: "Adult ×2", not two Adult lines.
  const b = buildTicketOrder([g({ count: 2 })]);
  assertEquals(b.lineItems.length, 1);
  assertEquals(b.lineItems[0].quantity, '2');
  assertEquals(b.expectedTotalCents, (800 + 48) * 2);
});

Deno.test('a half-cent tier stays on one line, and totals the way Square totals it', () => {
  // $8.25 x 2. This used to be split into two single lines, expecting Square to
  // round each separately: 2 x 50 = 100 tax, 1750. Square taxes the order once
  // — 6% of 1650 is 99 — and returns 1749 whether it is sent one line or two
  // (measured; pricing_vectors.json). So the split is gone and the expectation
  // is Square's number, which is now also what pricing.ts charges.
  const b = buildTicketOrder([g({ unitPriceCents: 825, count: 2 })]);
  assertEquals(b.lineItems.length, 1);
  assertEquals(b.lineItems[0].quantity, '2');
  assertEquals(b.expectedTotalCents, 1749);
});

for (const v of vectors.tax_only) {
  Deno.test(`expectedTotalCents is what Square returned — ${v.label}`, () => {
    // One group per distinct price, exactly as loadTicketGroups would make them.
    const counts = new Map<number, number>();
    for (const c of v.ticket_net_cents) counts.set(c, (counts.get(c) ?? 0) + 1);
    const groups = [...counts].map(([cents, count], i) =>
      g({ tierKey: `T${i}`, unitPriceCents: cents, count }));
    assertEquals(buildTicketOrder(groups).expectedTotalCents, v.square_total_cents);
  });
}

Deno.test('an untaxed line stays out of the tax base but in the total', () => {
  // 3 x $8.25 is 2475 -> 148.5 -> 148 tax. Were the $25 gift taxed with it the
  // base would be 4975 -> 298.5 -> 298; were tax taken per line and summed, the
  // tie would not exist at all. One tax, on the taxable lines only.
  const b = buildTicketOrder([g({ unitPriceCents: 825, count: 3 }), donationGroup(2500)]);
  assertEquals(b.expectedTotalCents, 2475 + 148 + 2500);
});

Deno.test('a multi-tier sale is one line per tier', () => {
  const b = buildTicketOrder([
    g({ count: 2 }),
    g({ tierKey: 'Student', displayName: 'Student - x', variationId: 'VAR_STU',
        unitPriceCents: 500, count: 1 }),
  ]);
  assertEquals(b.lineItems.length, 2);
  assertEquals(b.lineItems[0].catalog_object_id, 'VAR_ADULT');
  assertEquals(b.lineItems[1].catalog_object_id, 'VAR_STU');
  assertEquals(b.expectedTotalCents, (800 + 48) * 2 + (500 + 30));
});

Deno.test('a catalogued line STILL carries our tax', () => {
  // Measured, not assumed: Square applies no tax of its own to an Orders API
  // line, even when the referenced item is is_taxable with tax_ids. A line for
  // an $8.25 taxable item came back total_tax_money 0. Relying on the catalog
  // would undercharge sales tax on every catalogued ticket, and the order would
  // look perfectly well formed while doing it.
  const b = buildTicketOrder([g()]);
  assertEquals(b.lineItems[0].catalog_object_id, 'VAR_ADULT');
  assertEquals((b.lineItems[0].applied_taxes as any[]).length, 1);
  assertEquals(b.taxes.length, 1);
  assertEquals(b.expectedTotalCents, 848);
});

Deno.test('an ad-hoc line carries our tax too', () => {
  const b = buildTicketOrder([g({ variationId: null })]);
  assertEquals(b.lineItems[0].catalog_object_id, undefined);
  assertEquals(b.lineItems[0].name, 'Adult - Wednesday, September 16 at 7 PM');
  assertEquals((b.lineItems[0].applied_taxes as any[]).length, 1);
  assertEquals(b.adHocGroups, 1);
});

Deno.test('every line in a mixed order is taxed, and the tax is declared once', () => {
  const b = buildTicketOrder([g(), g({ tierKey: 'Student', variationId: null, unitPriceCents: 500 })]);
  assertEquals((b.lineItems[0].applied_taxes as any[]).length, 1);
  assertEquals((b.lineItems[1].applied_taxes as any[]).length, 1);
  assertEquals(b.taxes.length, 1);
  assertEquals(b.adHocGroups, 1);
});

Deno.test('base_price_money always overrides, so a stale catalog price cannot charge', () => {
  // The catalog may say $8.25 while the showing says $9. Our number wins, and
  // the buyer is charged what the site quoted.
  const b = buildTicketOrder([g({ unitPriceCents: 900 })]);
  assertEquals(b.lineItems[0].base_price_money, { amount: 900, currency: 'USD' });
});

Deno.test('zero-count and free tiers behave', () => {
  assertEquals(buildTicketOrder([g({ count: 0 })]).lineItems.length, 0);
  const free = buildTicketOrder([g({ unitPriceCents: 0, count: 1 })]);
  assertEquals(free.expectedTotalCents, 0);
  assertEquals(free.lineItems.length, 1);
});

Deno.test('the order body carries the reconciliation key and the web source', () => {
  const body: any = orderRequestBody({
    locationId: 'LOC1',
    referenceId: 'order-abc',
    built: buildTicketOrder([g()]),
    idempotencyKey: 'idem-1',
    buyerEmail: 'patron@example.com',
    buyerName: 'A Patron',
  });
  assertEquals(body.order.location_id, 'LOC1');
  assertEquals(body.order.reference_id, 'order-abc');
  assertEquals(body.order.source.name, 'Kenworthy Website');
  // This test used to assert type DIGITAL, state COMPLETED and
  // delivery_details — and passed, for the nine days Square was rejecting
  // every one of those orders. A unit test can only confirm we sent what we
  // meant to; it cannot tell us the vendor accepts it. The fulfillment shape
  // is asserted below against what was actually measured.
  assertEquals(body.order.fulfillments, undefined);
});

Deno.test('reference_id is truncated to what Square accepts', () => {
  const body: any = orderRequestBody({
    locationId: 'LOC1',
    referenceId: 'x'.repeat(60),
    built: buildTicketOrder([g()]),
    idempotencyKey: 'idem-1',
  });
  assertEquals((body.order.reference_id as string).length, 40);
});

/**
 * These four assert the exact shape measured as accepted by the Square sandbox
 * on 28 Aug 2026. DIGITAL was rejected under every variation tried, including
 * with digital_details supplied and under a 2025 Square-Version, so the shape
 * is not a preference — it is the only one that works. Changing it means
 * re-measuring, not re-reasoning.
 */

Deno.test('PICKUP, when used, is PROPOSED and carries the showtime and the buyer', () => {
  const body: any = orderRequestBody({
    locationId: 'LOC1', referenceId: 'r', idempotencyKey: 'i',
    built: buildTicketOrder([g()]),
    fulfillment: 'PICKUP',
    pickupAt: '2026-09-16T02:00:00.000Z',
    buyerEmail: 'patron@example.com',
    buyerName: 'A Patron',
  });
  const f = body.order.fulfillments[0];
  assertEquals(f.type, 'PICKUP');
  // Square rejects an order whose fulfillment is created COMPLETED.
  assertEquals(f.state, 'PROPOSED');
  assertEquals(f.pickup_details.pickup_at, '2026-09-16T02:00:00.000Z');
  assertEquals(f.pickup_details.recipient.display_name, 'A Patron');
  assertEquals(f.pickup_details.recipient.email_address, 'patron@example.com');
  // The field that caused the outage. It belongs to type DELIVERY.
  assertEquals(f.delivery_details, undefined);
});

Deno.test('every caller ships the no-fulfillment shape: a paid one completes', () => {
  const body: any = orderRequestBody({
    locationId: 'LOC1', referenceId: 'r', idempotencyKey: 'i',
    built: buildTicketOrder([g()]), fulfillment: 'NONE',
    buyerEmail: 'donor@example.com',
  });
  assertEquals(body.order.fulfillments, undefined);
});

Deno.test('a PICKUP with no pickup time degrades rather than failing the order', () => {
  // Square rejects PICKUP without pickup_at, and a rejected order costs the
  // whole sale's attribution. Dropping the fulfillment keeps the line items.
  const body: any = orderRequestBody({
    locationId: 'LOC1', referenceId: 'r', idempotencyKey: 'i',
    built: buildTicketOrder([g()]), fulfillment: 'PICKUP', pickupAt: null,
  });
  assertEquals(body.order.fulfillments, undefined);
  assertEquals(body.order.line_items.length, 1);
});

Deno.test('a patron who gave no name still gets a recipient', () => {
  const body: any = orderRequestBody({
    locationId: 'LOC1', referenceId: 'r', idempotencyKey: 'i',
    built: buildTicketOrder([g()]), fulfillment: 'PICKUP',
    pickupAt: '2026-09-16T02:00:00.000Z',
  });
  const r = body.order.fulfillments[0].pickup_details.recipient;
  assertEquals(r.display_name, 'Kenworthy patron');
  assertEquals(r.email_address, undefined);
});

import { donationGroup, processingFeeGroup } from './square-order.ts';

Deno.test('a bundled donation is never taxed', () => {
  // pricing.ts keeps a gift out of the tax base on purpose. Taxing it here would
  // charge more than the checkout page quoted.
  const b = buildTicketOrder([g(), donationGroup(2500)]);
  assertEquals(b.lineItems[1].name, 'Donation');
  assertEquals(b.lineItems[1].applied_taxes, undefined);
  assertEquals(b.expectedTotalCents, 848 + 2500);
});

Deno.test('the processing surcharge is never taxed either', () => {
  const b = buildTicketOrder([g(), processingFeeGroup(59)]);
  assertEquals(b.lineItems[1].name, 'Card processing fee');
  assertEquals(b.lineItems[1].applied_taxes, undefined);
  assertEquals(b.expectedTotalCents, 848 + 59);
});

Deno.test('an order of nothing but a donation declares no tax at all', () => {
  const b = buildTicketOrder([donationGroup(5000)]);
  assertEquals(b.taxes.length, 0);
  assertEquals(b.expectedTotalCents, 5000);
});
