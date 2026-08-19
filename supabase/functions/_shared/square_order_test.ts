import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  aggregationChangesTax,
  buildTicketOrder,
  orderRequestBody,
  type TicketGroup,
} from './square-order.ts';

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
  unitTaxCents: 48,
  count: 1,
  ...over,
});

Deno.test('a whole-dollar tier aggregates onto one line', () => {
  // The convention: "Adult ×2", not two Adult lines.
  const b = buildTicketOrder([g({ count: 2 })]);
  assertEquals(b.lineItems.length, 1);
  assertEquals(b.lineItems[0].quantity, '2');
  assertEquals(b.splitGroups, 0);
  assertEquals(b.expectedTotalCents, (800 + 48) * 2);
});

Deno.test('a half-cent tier is split so the tax still matches ours', () => {
  // $8.25: 825 * 6% = 49.5. We charge 2 * 50 = 100; one line of qty 2 would be
  // round(1650 * 6%) = 99. A cent, every time, on every such sale.
  const group = g({ unitPriceCents: 825, unitTaxCents: 50, count: 2 });
  assert(aggregationChangesTax(group));
  const b = buildTicketOrder([group]);
  assertEquals(b.lineItems.length, 2);
  assertEquals(b.lineItems.map((l) => l.quantity), ['1', '1']);
  assertEquals(b.splitGroups, 1);
  assertEquals(b.expectedTotalCents, (825 + 50) * 2);
});

Deno.test('whole dollars need no splitting', () => {
  assertEquals(aggregationChangesTax(g({ count: 5 })), false);
  assertEquals(aggregationChangesTax(g({ unitPriceCents: 2000, unitTaxCents: 120, count: 3 })), false);
});

Deno.test('a multi-tier sale is one line per tier', () => {
  const b = buildTicketOrder([
    g({ count: 2 }),
    g({ tierKey: 'Student', displayName: 'Student - x', variationId: 'VAR_STU',
        unitPriceCents: 500, unitTaxCents: 30, count: 1 }),
  ]);
  assertEquals(b.lineItems.length, 2);
  assertEquals(b.lineItems[0].catalog_object_id, 'VAR_ADULT');
  assertEquals(b.lineItems[1].catalog_object_id, 'VAR_STU');
  assertEquals(b.expectedTotalCents, (800 + 48) * 2 + (500 + 30));
});

Deno.test('a catalogued line sends no tax of its own', () => {
  // The tax lives on the catalog item and Square applies it. Sending ours too
  // would tax every ticket twice.
  const b = buildTicketOrder([g()]);
  assertEquals(b.lineItems[0].applied_taxes, undefined);
  assertEquals(b.taxes.length, 0);
});

Deno.test('an ad-hoc line carries our tax, because no catalog item can', () => {
  const b = buildTicketOrder([g({ variationId: null })]);
  assertEquals(b.lineItems[0].catalog_object_id, undefined);
  assertEquals(b.lineItems[0].name, 'Adult - Wednesday, September 16 at 7 PM');
  assertEquals((b.lineItems[0].applied_taxes as any[]).length, 1);
  assertEquals(b.taxes.length, 1);
  assertEquals(b.adHocGroups, 1);
});

Deno.test('a mixed order taxes only the ad-hoc half', () => {
  const b = buildTicketOrder([g(), g({ tierKey: 'Student', variationId: null, unitPriceCents: 500, unitTaxCents: 30 })]);
  assertEquals(b.lineItems[0].applied_taxes, undefined);
  assertEquals((b.lineItems[1].applied_taxes as any[]).length, 1);
  assertEquals(b.taxes.length, 1);
  assertEquals(b.adHocGroups, 1);
});

Deno.test('base_price_money always overrides, so a stale catalog price cannot charge', () => {
  // The catalog may say $8.25 while the showing says $9. Our number wins, and
  // the buyer is charged what the site quoted.
  const b = buildTicketOrder([g({ unitPriceCents: 900, unitTaxCents: 54 })]);
  assertEquals(b.lineItems[0].base_price_money, { amount: 900, currency: 'USD' });
});

Deno.test('zero-count and free tiers behave', () => {
  assertEquals(buildTicketOrder([g({ count: 0 })]).lineItems.length, 0);
  const free = buildTicketOrder([g({ unitPriceCents: 0, unitTaxCents: 0, count: 1 })]);
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
  assertEquals(body.order.fulfillments[0].type, 'DIGITAL');
  assertEquals(body.order.fulfillments[0].state, 'COMPLETED');
  assertEquals(
    body.order.fulfillments[0].delivery_details.recipient.email_address,
    'patron@example.com',
  );
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

Deno.test('an in-person sale is not marked DIGITAL', () => {
  const body: any = orderRequestBody({
    locationId: 'LOC1', referenceId: 'r', idempotencyKey: 'i',
    built: buildTicketOrder([g()]), fulfillment: 'IN_STORE',
  });
  assertEquals(body.order.fulfillments[0].type, 'IN_STORE');
  assertEquals(body.order.fulfillments[0].delivery_details, undefined);
});
