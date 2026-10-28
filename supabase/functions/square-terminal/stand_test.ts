// square-terminal's Stand path (BRIEF-ios-stand-reader.md): start_sale with
// reader "stand" creates no Terminal checkout, and confirm_sale by payment_id
// confirms rows only for a COMPLETED payment that Square says was taken for
// this order, at our location, for at least the order's amount. The real
// handler, every outbound call stubbed.
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/square-terminal/stand_test.ts

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  authUsers,
  BASE_ENV,
  type Call,
  calls,
  jsonResponse,
  loadHandler,
  quietly,
  roleGateRoute,
  rows,
  type Route,
  SQUARE_TEST_ENV,
  testJwt,
  useRoutes,
} from '../_shared/testing/handler_harness.ts';

const handler = await loadHandler(() => import('./index.ts'), { ...BASE_ENV, ...SQUARE_TEST_ENV, SQUARE_ENV: 'sandbox' });

const STAFF = '00000000-0000-0000-0000-0000000000c1';
const JWT = testJwt(STAFF, 'aal2');
const TOKEN = '3f1c2b8e-9a7d-4e21-b6c3-0d5e8f7a1b2c';
const LOC = SQUARE_TEST_ENV.SQUARE_LOCATION_ID;
const PAY = 'PAY_STAND_1';

const users = authUsers({ [JWT]: { id: STAFF, email: 'staff@x.test' } });
const gate = roleGateRoute(() => 'ok');

/** Two pending card rows: $10.60 + $10.60 = 2120 cents. */
const pendingTickets = (status = 'pending'): Route => (c) => {
  if (c.url.pathname !== '/rest/v1/tickets') return undefined;
  if (c.method === 'GET' && c.url.searchParams.get('order_token') === `eq.${TOKEN}`) {
    return rows(c, [1, 2].map((i) => ({
      id: `t${i}`, showing_id: 's1', tier_id: null, price: 10, list_price: 10, discount_amount: 0, discount_label: null,
      tax_amount: 0.6, total_price: 10.6, processing_fee: 0, payment_method: 'card', status, square_payment_id: null,
    })));
  }
  if (c.method === 'GET' && c.url.searchParams.get('square_payment_id')) return rows(c, []);
  if (c.method === 'PATCH') return rows(c, [{ id: 't1' }, { id: 't2' }]);
  return undefined;
};
const noPasses: Route = (c) => (c.url.pathname === '/rest/v1/user_film_passes' ? rows(c, []) : undefined);
const payment = (over: Record<string, unknown> = {}): Route => (c) =>
  c.method === 'GET' && c.url.pathname === `/v2/payments/${PAY}`
    ? jsonResponse({ payment: { id: PAY, status: 'COMPLETED', reference_id: TOKEN, location_id: LOC, amount_money: { amount: 2120, currency: 'USD' }, ...over } })
    : undefined;

function post(body: Record<string, unknown>): Request {
  return new Request('http://localhost/square-terminal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JWT}` },
    body: JSON.stringify(body),
  });
}
const toTerminal = (c: Call) => c.url.pathname.startsWith('/v2/terminals');
const confirmed = (c: Call) => c.url.pathname === '/rest/v1/tickets' && c.method === 'PATCH';

function run(name: string, fn: () => Promise<void>) {
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn: () => quietly(fn) });
}

run('start_sale (stand): no Terminal checkout; the amount and reference the iPad must use', async () => {
  useRoutes([users, gate, pendingTickets(), noPasses]);
  const res = await handler(post({ action: 'start_sale', order_token: TOKEN, idempotency_key: 'k1', reader: 'stand' }));
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.stand, true);
  assertEquals(j.amount_cents, 2120);
  assertEquals(j.reference_id, TOKEN);
  assertEquals(calls.filter(toTerminal).length, 0);
});

run('start_sale (stand): a gift rides along in the amount', async () => {
  useRoutes([users, gate, pendingTickets(), noPasses]);
  const j = await (await handler(post({ action: 'start_sale', order_token: TOKEN, idempotency_key: 'k1', reader: 'stand', donation_cents: 500 }))).json();
  assertEquals(j.amount_cents, 2620);
});

run('confirm_sale (payment_id): a completed payment for this order confirms the rows', async () => {
  useRoutes([users, gate, pendingTickets(), noPasses, payment()]);
  const res = await handler(post({ action: 'confirm_sale', order_token: TOKEN, payment_id: PAY }));
  const j = await res.json();
  assertEquals(j.confirmed, true);
  assertEquals(j.payment_id, PAY);
  const patch = calls.find(confirmed)!;
  assertEquals((patch.body as Record<string, unknown>).square_payment_id, PAY);
  assertEquals((patch.body as Record<string, unknown>).status, 'confirmed');
});

run('confirm_sale (payment_id): a payment for another order is refused 409, nothing confirmed', async () => {
  useRoutes([users, gate, pendingTickets(), noPasses, payment({ reference_id: 'aaaaaaaa-0000-0000-0000-000000000000' })]);
  const res = await handler(post({ action: 'confirm_sale', order_token: TOKEN, payment_id: PAY }));
  assertEquals(res.status, 409);
  assertStringIncludes((await res.json()).error, 'different sale');
  assertEquals(calls.filter(confirmed).length, 0);
});

run('confirm_sale (payment_id): a payment with no reference is refused', async () => {
  useRoutes([users, gate, pendingTickets(), noPasses, payment({ reference_id: undefined })]);
  assertEquals((await handler(post({ action: 'confirm_sale', order_token: TOKEN, payment_id: PAY }))).status, 409);
  assertEquals(calls.filter(confirmed).length, 0);
});

run('confirm_sale (payment_id): a payment at another location is refused', async () => {
  useRoutes([users, gate, pendingTickets(), noPasses, payment({ location_id: 'OTHER' })]);
  const res = await handler(post({ action: 'confirm_sale', order_token: TOKEN, payment_id: PAY }));
  assertEquals(res.status, 409);
  assertEquals(calls.filter(confirmed).length, 0);
});

run('confirm_sale (payment_id): short of the order is refused', async () => {
  useRoutes([users, gate, pendingTickets(), noPasses, payment({ amount_money: { amount: 2119, currency: 'USD' } })]);
  assertEquals((await handler(post({ action: 'confirm_sale', order_token: TOKEN, payment_id: PAY }))).status, 409);
  assertEquals(calls.filter(confirmed).length, 0);
});

for (const status of ['APPROVED', 'PENDING', 'CANCELED', 'FAILED']) {
  run(`confirm_sale (payment_id): ${status} is reported, not confirmed`, async () => {
    useRoutes([users, gate, pendingTickets(), noPasses, payment({ status })]);
    const j = await (await handler(post({ action: 'confirm_sale', order_token: TOKEN, payment_id: PAY }))).json();
    assertEquals(j.confirmed, false);
    assertEquals(j.status, status);
    assertEquals(calls.filter(confirmed).length, 0);
  });
}

run('confirm_sale: a payment already on another order is refused (one payment, one sale)', async () => {
  const dupe: Route = (c) =>
    c.url.pathname === '/rest/v1/tickets' && c.method === 'GET' && c.url.searchParams.get('square_payment_id') === `eq.${PAY}`
      ? rows(c, [{ id: 'other' }])
      : undefined;
  useRoutes([users, gate, dupe, pendingTickets(), noPasses, payment()]);
  const res = await handler(post({ action: 'confirm_sale', order_token: TOKEN, payment_id: PAY }));
  assertEquals(res.status, 409);
  assertEquals(calls.filter(confirmed).length, 0);
});

run('confirm_sale: both checkout_id and payment_id, or neither, is a 400', async () => {
  useRoutes([users, gate, pendingTickets(), noPasses, payment()]);
  assertEquals((await handler(post({ action: 'confirm_sale', order_token: TOKEN, payment_id: PAY, checkout_id: 'C' }))).status, 400);
  assertEquals((await handler(post({ action: 'confirm_sale', order_token: TOKEN }))).status, 400);
  assert(!calls.some((c) => c.url.pathname.startsWith('/v2/')));
});

// ── stand_charge: the Stand at the patron-facing display ────────────────────

const ORDER = 'ORDER_STAND_1';
const squareOrder = (over: Record<string, unknown> = {}): Route => (c) =>
  c.method === 'GET' && c.url.pathname === `/v2/orders/${ORDER}`
    ? jsonResponse({ order: { id: ORDER, state: 'OPEN', location_id: LOC, reference_id: TOKEN, total_money: { amount: 2620, currency: 'USD' }, ...over } })
    : undefined;

run('stand_charge: the amount and token come from Square’s order, held to the rows', async () => {
  useRoutes([users, gate, pendingTickets(), noPasses, squareOrder()]);
  const res = await handler(post({ action: 'stand_charge', square_order_id: ORDER }));
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.amount_cents, 2620);
  assertEquals(j.order_token, TOKEN);
  assertEquals(j.reference_id, TOKEN);
  assertEquals(j.ticket_count, 2);
});

for (const [why, over, status] of [
  ['another location', { location_id: 'OTHER' }, 409],
  ['not OPEN', { state: 'COMPLETED' }, 409],
  ['short of the rows', { total_money: { amount: 2119 } }, 409],
  ['more than rows plus the gift cap', { total_money: { amount: 2120 + 1_000_000 } }, 409],
] as const) {
  run(`stand_charge: an order ${why} is refused`, async () => {
    useRoutes([users, gate, pendingTickets(), noPasses, squareOrder(over as Record<string, unknown>)]);
    assertEquals((await handler(post({ action: 'stand_charge', square_order_id: ORDER }))).status, status);
  });
}

run('stand_charge: rows that are no longer pending are refused', async () => {
  useRoutes([users, gate, pendingTickets('confirmed'), noPasses, squareOrder()]);
  assertEquals((await handler(post({ action: 'stand_charge', square_order_id: ORDER }))).status, 409);
});

run('stand_charge: an order naming no box-office sale is refused', async () => {
  const noRows: Route = (c) => (c.url.pathname === '/rest/v1/tickets' && c.method === 'GET' ? rows(c, []) : undefined);
  useRoutes([users, gate, pendingTickets(), noRows, noPasses, squareOrder({ reference_id: 'aaaaaaaa-0000-0000-0000-000000000000' })]);
  assertEquals((await handler(post({ action: 'stand_charge', square_order_id: ORDER }))).status, 404);
});
