// square-donation `record_in_person`: a counter gift needs the sale it rode on
// and a Square payment that covers it (security audit 2026-10-06, L1). The real
// handler, every outbound call stubbed — no Square, no LGL, no email.
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/square-donation/record_in_person_test.ts

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  ANON,
  BASE_ENV,
  type Call,
  calls,
  is,
  jsonResponse,
  loadHandler,
  quietly,
  rpc,
  type Route,
  SQUARE_TEST_ENV,
  useRoutes,
  verifiedBot,
  withEnv,
} from '../_shared/testing/handler_harness.ts';
import { orderProblem, requestProblem, type OrderTicket } from './in_person.ts';

const handler = await loadHandler(() => import('./index.ts'), BASE_ENV);

const STAFF = '00000000-0000-0000-0000-0000000000c1';
const OTHER_STAFF = '00000000-0000-0000-0000-0000000000c2';
const STAFF_JWT = 'staff-session-jwt';
const ORDER = '7b0c2a3e-1111-4222-8333-444455556666';
const PAY = 'sq-payment-1';

const ticket = (over: Partial<OrderTicket> = {}): OrderTicket & { showing_id: string } => ({
  user_id: STAFF,
  payment_method: 'cash',
  status: 'confirmed',
  square_payment_id: PAY,
  total_price: 10.6,
  processing_fee: 0,
  showing_id: 'show-1',
  ...over,
});

interface World {
  tickets?: ReturnType<typeof ticket>[];
  existingGift?: boolean;
  paymentCents?: number;
  paymentUsedElsewhere?: boolean;
  role?: 'staff' | 'admin' | 'none';
}

function routes(w: World): Route[] {
  const tickets = w.tickets ?? [ticket(), ticket()];
  return [
    (c) => (is(c, 'GET', '/auth/v1/user')
      ? ((c.headers.get('authorization') ?? '').endsWith(STAFF_JWT)
        ? jsonResponse({ id: STAFF, email: 'staff@x.test', aud: 'authenticated' })
        : jsonResponse({ msg: 'invalid JWT' }, 401))
      : undefined),
    (c) => {
      if (!rpc('has_role')(c)) return undefined;
      const want = (c.body as { _role: string })._role;
      const role = w.role ?? 'staff';
      return jsonResponse(role === 'admin' || (role === 'staff' && want === 'staff'));
    },
    (c) => {
      if (!is(c, 'GET', '/rest/v1/tickets')) return undefined;
      // The "used by another order" lookup filters on square_payment_id.
      if (c.url.searchParams.has('square_payment_id')) return jsonResponse(w.paymentUsedElsewhere ? [{ id: 'x' }] : []);
      return jsonResponse(tickets);
    },
    (c) => (is(c, 'GET', '/rest/v1/user_film_passes') || is(c, 'GET', '/rest/v1/film_pass_orders') ? jsonResponse([]) : undefined),
    (c) => {
      if (!is(c, 'GET', '/rest/v1/donations')) return undefined;
      if (c.url.searchParams.has('order_token')) return jsonResponse(w.existingGift ? [{ id: 'gift-0', amount_cents: 500 }] : []);
      return jsonResponse([]);
    },
    (c) => (is(c, 'POST', '/rest/v1/donations') ? jsonResponse({ id: 'gift-1' }, 201) : undefined),
    (c) => (c.url.hostname.includes('squareup') && c.url.pathname === `/v2/payments/${PAY}`
      ? jsonResponse({ payment: { id: PAY, status: 'COMPLETED', location_id: 'LOC_TEST', total_money: { amount: w.paymentCents ?? 2120 + 500 } } })
      : undefined),
    // settleDonation's reads and writes after the insert: answer anything left.
    (c) => (c.url.pathname.startsWith('/rest/v1/') ? jsonResponse([]) : undefined),
  ];
}

function gift(over: Record<string, unknown> = {}, bearer = STAFF_JWT): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({
      action: 'record_in_person',
      amountCents: 500,
      paymentChannel: 'cash',
      orderToken: ORDER,
      squarePaymentId: null,
      donorEmail: null,
      ...over,
    }),
  });
}

const inserts = () => calls.filter((c: Call) => is(c, 'POST', '/rest/v1/donations'));

function run(name: string, w: World, fn: () => Promise<void>, env: Record<string, string | null> = {}) {
  Deno.test({
    name,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: () => quietly(() => withEnv({ ...SQUARE_TEST_ENV, ...env }, async () => {
      useRoutes(routes(w));
      await fn();
    })),
  });
}

// ---- the paths the POS takes today ----------------------------------------

run('cash gift on the cash sale square-cash-sale recorded: filed, with the verified payment and the actor', {}, async () => {
  const res = await handler(gift());
  assertEquals(res.status, 200, await res.clone().text());
  const [ins] = inserts();
  const row = (Array.isArray(ins.body) ? ins.body[0] : ins.body) as Record<string, unknown>;
  assertEquals(row.square_payment_id, PAY, 'the stamp, not the browser');
  assertEquals(row.order_token, ORDER);
  assertEquals(row.showing_id, 'show-1');
  assertEquals(ins.headers.get('x-kw-actor-id'), STAFF);
  assertEquals(calls.filter(verifiedBot).length, 0, 'staff action, not behind Turnstile');
});

run('terminal gift with the reader payment confirm_sale stamped: filed', {
  tickets: [ticket({ payment_method: 'card' })],
  paymentCents: 1060 + 500,
}, async () => {
  const res = await handler(gift({ paymentChannel: 'terminal', squarePaymentId: PAY }));
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals(inserts().length, 1);
});

run('sandbox simulated reader (no payment anywhere): filed', {
  tickets: [ticket({ payment_method: 'card', square_payment_id: null })],
}, async () => {
  const res = await handler(gift({ paymentChannel: 'terminal', squarePaymentId: null }));
  assertEquals(res.status, 200, await res.clone().text());
  assertEquals(calls.filter((c) => c.url.hostname.includes('squareup')).length, 0);
});

// ---- refusals --------------------------------------------------------------

run('production: a terminal gift with no payment is refused', {
  tickets: [ticket({ payment_method: 'card', square_payment_id: null })],
}, async () => {
  const res = await handler(gift({ paymentChannel: 'terminal', squarePaymentId: null }));
  assertEquals(res.status, 400);
  assertEquals(inserts().length, 0);
}, { SQUARE_ENV: 'production' });

run('a gift with no order is refused before anything is read', {}, async () => {
  const res = await handler(gift({ orderToken: null }));
  assertEquals(res.status, 400);
  assertEquals(calls.filter((c) => c.url.pathname.startsWith('/rest/v1/tickets')).length, 0);
});

run('a gift over MAX_BUNDLED_DONATION_CENTS is refused', {}, async () => {
  const res = await handler(gift({ amountCents: 100_001 }));
  assertEquals(res.status, 400);
  assertStringIncludes(await res.text(), 'capped');
  assertEquals(inserts().length, 0);
});

run('a cash gift larger than what Square took for the sale is refused', { paymentCents: 2120 + 499 }, async () => {
  const res = await handler(gift({ amountCents: 500 }));
  assertEquals(res.status, 400);
  assertEquals(inserts().length, 0);
});

run('a cash sale Square never recorded cannot carry a receipted gift', {
  tickets: [ticket({ square_payment_id: null })],
}, async () => {
  const res = await handler(gift());
  assertEquals(res.status, 409);
  assertStringIncludes(await res.text(), 'Tell a manager');
  assertEquals(inserts().length, 0);
});

run('a terminal gift naming a different payment than the sale carries is refused', {
  tickets: [ticket({ payment_method: 'card' })],
}, async () => {
  const res = await handler(gift({ paymentChannel: 'terminal', squarePaymentId: 'someone-elses-payment' }));
  assertEquals(res.status, 409);
  assertEquals(inserts().length, 0);
});

run('a payment already used by another order is refused', { paymentUsedElsewhere: true }, async () => {
  const res = await handler(gift());
  assertEquals(res.status, 409);
  assertEquals(inserts().length, 0);
});

run('another staff member\'s sale is refused', { tickets: [ticket({ user_id: OTHER_STAFF })] }, async () => {
  const res = await handler(gift());
  assertEquals(res.status, 403);
  assertEquals(inserts().length, 0);
});

run('an admin may file against anyone\'s sale', { tickets: [ticket({ user_id: OTHER_STAFF })], role: 'admin' }, async () => {
  assertEquals((await handler(gift())).status, 200);
});

run('a second gift on the same order is not filed again', { existingGift: true }, async () => {
  const res = await handler(gift());
  assertEquals(res.status, 200);
  assertEquals((await res.json()).already_recorded, true);
  assertEquals(inserts().length, 0);
});

run('a cash gift claimed on a card sale is refused', { tickets: [ticket({ payment_method: 'card' })] }, async () => {
  assertEquals((await handler(gift())).status, 400);
  assertEquals(inserts().length, 0);
});

run('a non-staff session is refused', { role: 'none' }, async () => {
  assertEquals((await handler(gift())).status, 403);
  assertEquals(inserts().length, 0);
});

// ---- the pure rules --------------------------------------------------------

Deno.test('requestProblem: amount bounds, channel, order token shape', () => {
  const ok = { amountCents: 500, paymentChannel: 'cash', orderToken: ORDER };
  assertEquals(requestProblem(ok), null);
  assert(requestProblem({ ...ok, amountCents: 99 }));
  assert(requestProblem({ ...ok, amountCents: 100_001 }));
  assertEquals(requestProblem({ ...ok, amountCents: 100_000 }), null);
  assert(requestProblem({ ...ok, amountCents: 5.5 }));
  assert(requestProblem({ ...ok, paymentChannel: 'card' }));
  assert(requestProblem({ ...ok, orderToken: 'not-a-uuid' }));
});

Deno.test('orderProblem: an unconfirmed (pending card) sale cannot carry a gift yet', () => {
  const v = orderProblem({
    channel: 'terminal', tickets: [ticket({ payment_method: 'card', status: 'pending', square_payment_id: null })],
    callerId: STAFF, callerIsAdmin: false, claimedPaymentId: null, environment: 'sandbox',
  });
  assert(!v.ok);
});

Deno.test('orderProblem: failed rows are ignored; an order of only failed rows is no sale', () => {
  const v = orderProblem({
    channel: 'cash', tickets: [ticket({ status: 'failed' })],
    callerId: STAFF, callerIsAdmin: false, claimedPaymentId: null, environment: 'sandbox',
  });
  assert(!v.ok && v.refusal.status === 404);
});
