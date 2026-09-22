// Tests for what pricing.ts still does: reach the database's pricing function
// and turn its answers into the shapes checkout uses. The arithmetic itself —
// tax, discounts, apportionment, the purchasability rules — is in SQL now and
// is tested there (supabase/tests/pricing_rpc, against Square's own totals).

import { assert, assertEquals, assertRejects, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  MAX_BUNDLED_DONATION_CENTS,
  PricingError,
  bundledDonationEmailError,
  computeProcessingFee,
  createTicketOrder,
  priceTicketOrder,
  readDonationCents,
} from './pricing.ts';
import { NOT_SOLD_HERE_MESSAGE, ticketsSoldHere } from './purchasable.ts';

/** A fake supabase client: `rpc` answers from a script, `from().select()` returns the showing. */
function fakeAdmin(rpc: (fn: string, args: any) => { data: any; error: any }, showing: any = { id: 's', total_seats: 200, requires_seat_selection: false, start_time: 't', max_tickets_per_buyer: 20 }) {
  const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: showing, error: null }) };
  return { rpc: (fn: string, args: any) => Promise.resolve(rpc(fn, args)), from: () => chain };
}

const row = (over: Record<string, unknown> = {}) => ({
  seq: 0, seat_id: null, tier_id: null, tier_name: null,
  list_price: '9.00', discount_amount: '2.25', price: '6.75', tax_amount: '0.41', total_price: '7.16',
  discount_id: 'rule-1', discount_label: '25% off 4+',
  order_list_subtotal: '36.00', order_discount: '9.00', order_subtotal: '27.00', order_tax: '1.62',
  order_total: '28.62', order_processing_fee: '0.00', order_grand_total: '28.62',
  production_title: 'Metropolis', production_category: 'Films', ...over,
});

Deno.test('priceTicketOrder sends only seat and tier ids, whatever the client attached', async () => {
  let sent: any;
  const admin = fakeAdmin((fn, args) => { sent = { fn, args }; return { data: [row()], error: null }; });
  await priceTicketOrder(admin, 's', [{ seat_id: 'seat-1', tier_id: 't1', price: 0.01, discount_amount: 99 } as never]);
  assertEquals(sent.fn, 'quote_ticket_order');
  assertEquals(sent.args.p_tickets, [{ seat_id: 'seat-1', tier_id: 't1' }]);
  assertEquals(sent.args.p_channel, 'online');
});

Deno.test('the priced order is read off the rows: numbers, discount, cents', async () => {
  const admin = fakeAdmin(() => ({ data: [row(), row({ seq: 1, tax_amount: '0.40', total_price: '7.15' })], error: null }));
  const order = await priceTicketOrder(admin, 's', [{}, {}]);
  assertEquals(order.amountCents, 2862);
  assertEquals(order.discount, { id: 'rule-1', label: '25% off 4+', cents: 900 });
  assertEquals(order.tickets.map((t) => t.total_price), [7.16, 7.15]);
  assertEquals(order.productionTitle, 'Metropolis');
  assertEquals(order.showing.max_tickets_per_buyer, 20);
});

Deno.test("the database's refusals become PricingErrors with its own sentence", async () => {
  const admin = fakeAdmin(() => ({ data: null, error: { code: 'PT410', message: 'This showing has passed.' } }));
  await assertRejects(() => priceTicketOrder(admin, 's', [{}]), PricingError, 'This showing has passed.');
});

Deno.test('a production not ticketed here is refused with the sentence the page shows', async () => {
  // The refusal is in price_ticket_order (20260922203433) and is exercised by
  // the SQL harness; this pins that ticket-checkout hands the buyer that same
  // sentence rather than 'Could not price this order'.
  const admin = fakeAdmin(() => ({ data: null, error: { code: 'PT409', message: NOT_SOLD_HERE_MESSAGE } }));
  await assertRejects(() => priceTicketOrder(admin, 's', [{}]), PricingError, NOT_SOLD_HERE_MESSAGE);
});

Deno.test('any other database error is not a pricing refusal', async () => {
  const admin = fakeAdmin(() => ({ data: null, error: { code: '57014', message: 'canceling statement' } }));
  const err = await assertRejects(() => priceTicketOrder(admin, 's', [{}]));
  assert(!(err instanceof PricingError));
});

Deno.test('an empty order is refused before the database is asked', async () => {
  const admin = fakeAdmin(() => { throw new Error('should not be called'); });
  await assertRejects(() => priceTicketOrder(admin, 's', []), PricingError, 'No tickets requested');
});

Deno.test('createTicketOrder passes the order through and returns the stored rows', async () => {
  let sent: any;
  const admin = fakeAdmin((fn, args) => { sent = { fn, args }; return { data: [{ id: 'tk-1' }], error: null }; });
  const made = await createTicketOrder(admin, {
    showingId: 's', descriptors: [{ tier_id: 't1' }], paymentMethod: 'online', userId: 'u',
    orderToken: 'tok', status: 'pending', idempotencyKey: 'k', smsConsent: false,
  });
  assertEquals(sent.fn, 'create_ticket_order');
  assertEquals(sent.args.p_status, 'pending');
  assertEquals(sent.args.p_checkout_idempotency_key, 'k');
  assertEquals('rows' in made && made.rows, [{ id: 'tk-1' }]);
});

Deno.test('createTicketOrder reports a refusal and a failure differently', async () => {
  const refused = await createTicketOrder(fakeAdmin(() => ({ data: null, error: { code: 'PT409', message: 'This showing is sold out.' } })),
    { showingId: 's', descriptors: [{}], paymentMethod: 'cash', userId: 'u', orderToken: 't', status: 'confirmed' });
  assert('refused' in refused && refused.refused.message === 'This showing is sold out.');
  const failed = await createTicketOrder(fakeAdmin(() => ({ data: null, error: { code: 'PT409', message: 'This showing just sold out.' } })),
    { showingId: 's', descriptors: [{}], paymentMethod: 'cash', userId: 'u', orderToken: 't', status: 'confirmed' });
  assert('refused' in failed);
});

Deno.test('readDonationCents accepts nothing, zero, and the preset amounts', () => {
  assertEquals(readDonationCents(undefined), { ok: true, cents: 0 });
  assertEquals(readDonationCents(null), { ok: true, cents: 0 });
  assertEquals(readDonationCents(''), { ok: true, cents: 0 });
  assertEquals(readDonationCents(0), { ok: true, cents: 0 });
  assertEquals(readDonationCents(100), { ok: true, cents: 100 });
  assertEquals(readDonationCents(500), { ok: true, cents: 500 });
  assertEquals(readDonationCents(1000), { ok: true, cents: 1000 });
});

Deno.test('no gift: a phone-only buyer is unaffected', () => {
  assertEquals(bundledDonationEmailError(null, 0), null);
  assertEquals(bundledDonationEmailError('', 0), null);
  assertEquals(bundledDonationEmailError(undefined, 0), null);
});

Deno.test('gift with no email is refused', () => {
  const err = bundledDonationEmailError(null, 100);
  assert(err, 'a $1 gift with no email must be refused');
  assertStringIncludes(err, 'email');
});

Deno.test('gift with no email: blank and whitespace count as no email', () => {
  assert(bundledDonationEmailError('', 500));
  assert(bundledDonationEmailError('   ', 500));
  assert(bundledDonationEmailError(undefined, 500));
});

Deno.test('gift with an email is allowed', () => {
  assertEquals(bundledDonationEmailError('donor@example.com', 100), null);
  assertEquals(bundledDonationEmailError('donor@example.com', MAX_BUNDLED_DONATION_CENTS), null);
});


Deno.test('ticketsSoldHere: false for rsvp and info_only, true otherwise and when absent', () => {
  assertEquals(ticketsSoldHere({ ticket_type: 'ticketed' }), true);
  assertEquals(ticketsSoldHere({ ticket_type: 'rsvp', rsvp_url: 'https://festival.example' }), false);
  assertEquals(ticketsSoldHere({ ticket_type: 'info_only' }), false);
  assertEquals(ticketsSoldHere({}), true);
  assertEquals(ticketsSoldHere(null), true);
  // Twin of the RAISE in the migration and of src/lib/purchasable.ts.
  assertEquals(NOT_SOLD_HERE_MESSAGE, 'Tickets for this showing are not sold here.');
});
