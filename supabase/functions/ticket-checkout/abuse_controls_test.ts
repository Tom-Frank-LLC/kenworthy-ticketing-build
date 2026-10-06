// The abuse controls on online ticket checkout, proven against the real handler
// (audit M2, L10). Every outbound call is stubbed — see
// _shared/testing/handler_harness.ts — so nothing here reaches Supabase,
// Cloudflare, Square, Resend or Twilio.
//
// What is pinned, and why each matters:
//   * no account is created for a request that fails any check (M2, feeding H1)
//   * the bot check runs before pricing, and before any write
//   * Turnstile fails CLOSED when its secret is unset
//   * the rate limit runs before the bot check and refuses with 429
//   * a free ($0) showing gets the same controls — it has no card step
//   * a replay of a completed order skips the bot check (its token is spent)
//   * GoTrue's and Square's own text never reaches the caller (L10)
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/ticket-checkout/abuse_controls_test.ts

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  BASE_ENV,
  SQUARE_TEST_ENV,
  type Call,
  type Route,
  calls,
  createdUser,
  firstIndex,
  is,
  jsonResponse,
  loadHandler,
  post,
  quietly,
  rateLimit,
  rows,
  rpc,
  siteverify,
  useRoutes,
  verifiedBot,
  withEnv,
} from '../_shared/testing/handler_harness.ts';

const handler = await loadHandler(() => import('./index.ts'), BASE_ENV);

const SHOWING = 'showing-free-1';
const KEY = 'idem-key-0001';

const pricedRow = {
  seq: 1, seat_id: null, tier_id: null, tier_name: null,
  list_price: 0, discount_amount: 0, price: 0, tax_amount: 0, total_price: 0,
  discount_id: null, discount_label: null,
  order_list_subtotal: 0, order_discount: 0, order_subtotal: 0, order_tax: 0,
  order_total: 0, order_processing_fee: 0, order_grand_total: 0,
  production_title: 'Free Film Night', production_category: 'Films',
};

/** A free showing, a brand-new buyer, and every write succeeding. */
function world(over: {
  bot?: boolean;
  limited?: boolean;
  quote?: Route;
  replayRows?: unknown[];
  profiles?: unknown[];
  createUser?: Route;
} = {}): Route[] {
  return [
    rateLimit(!over.limited),
    siteverify(over.bot ?? true),
    over.quote ?? ((c) => rpc('quote_ticket_order')(c) ? jsonResponse([pricedRow]) : undefined),
    (c) => is(c, 'GET', '/rest/v1/showings')
      ? rows(c, [{ id: SHOWING, total_seats: 100, requires_seat_selection: false, start_time: '2099-01-01T00:00:00Z', max_tickets_per_buyer: 6 }])
      : undefined,
    // The replay lookup filters on the key; availability and holdings do not.
    (c) => is(c, 'GET', '/rest/v1/tickets') && c.url.searchParams.has('checkout_idempotency_key')
      ? rows(c, over.replayRows ?? [])
      : undefined,
    (c) => is(c, 'GET', '/rest/v1/tickets') ? rows(c, []) : undefined,
    (c) => is(c, 'GET', '/rest/v1/profiles') ? rows(c, over.profiles ?? []) : undefined,
    // Since #360 an account is found in auth.users through this RPC, not by
    // reading profiles; `profiles` here stands in for the accounts that exist.
    (c) => rpc('auth_user_id_by_email')(c)
      ? jsonResponse((over.profiles?.[0] as { id?: string } | undefined)?.id ?? null)
      : undefined,
    (c) => is(c, 'GET', '/auth/v1/admin/users') ? jsonResponse({ users: [], aud: 'authenticated' }) : undefined,
    over.createUser ?? ((c) => createdUser(c)
      ? jsonResponse({ id: 'new-user-1', email: 'guest@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' })
      : undefined),
    (c) => rpc('create_ticket_order')(c)
      ? jsonResponse([{ id: 'ticket-1', total_price: 0, order_token: 'tok', status: 'pending', qr_code: 'qr' }])
      : undefined,
    (c) => is(c, 'PATCH', '/rest/v1/tickets') ? jsonResponse([]) : undefined,
  ];
}

const order = (over: Record<string, unknown> = {}) => ({
  action: 'create_purchase',
  showing_id: SHOWING,
  tickets: [{}, {}],
  email: 'guest@example.com',
  name: 'Guest Patron',
  idempotency_key: KEY,
  turnstile_token: 'a-solved-token',
  ...over,
});

const count = (pred: (c: Call) => boolean) => calls.filter(pred).length;

Deno.test({
  name: 'a free reservation by a new guest: limited, verified, priced, THEN the account, then the rows',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world());
    const res = await handler(post(order()));
    assertEquals(res.status, 200, await res.clone().text());

    const limit = firstIndex(rpc('check_rate_limit'));
    const bot = firstIndex(verifiedBot);
    const quote = firstIndex(rpc('quote_ticket_order'));
    const account = firstIndex(createdUser);
    const insert = firstIndex(rpc('create_ticket_order'));
    assert(limit >= 0 && bot > limit, 'rate limit before the bot check');
    assert(quote > bot, 'bot check before pricing');
    assert(account > quote, 'account only after pricing');
    assert(insert > account, 'rows after the account they belong to');
    assertEquals(count(createdUser), 1);
    // Free: nothing went to Square.
    assertEquals(count((c) => c.url.hostname.includes('squareup')), 0);
  }),
});

Deno.test({
  name: 'a request the pricing refuses creates no account',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world({
      quote: (c) => rpc('quote_ticket_order')(c)
        ? jsonResponse({ code: 'PT404', message: 'That showing is not on sale.', details: null, hint: null }, 400)
        : undefined,
    }));
    const res = await handler(post(order()));
    assertEquals(res.status, 400);
    assertEquals(count(createdUser), 0);
    assertEquals(count(rpc('create_ticket_order')), 0);
  }),
});

Deno.test({
  name: 'a failed bot check stops everything: no pricing, no account lookup, no account, no rows',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world({ bot: false }));
    const res = await handler(post(order()));
    assertEquals(res.status, 403);
    assertEquals(count(rpc('quote_ticket_order')), 0);
    assertEquals(count((c) => c.url.pathname.startsWith('/auth/v1/admin')), 0);
    assertEquals(count((c) => is(c, 'GET', '/rest/v1/profiles')), 0);
    assertEquals(count(rpc('create_ticket_order')), 0);
  }),
});

Deno.test({
  name: 'no token at all is refused before Cloudflare is even asked',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world());
    const res = await handler(post(order({ turnstile_token: undefined })));
    assertEquals(res.status, 403);
    assertEquals(count(verifiedBot), 0);
    assertEquals(count(createdUser), 0);
  }),
});

Deno.test({
  name: 'Turnstile fails CLOSED here when the secret is unset',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    await withEnv({ TURNSTILE_SECRET_KEY: null }, async () => {
      useRoutes(world());
      const res = await handler(post(order()));
      assertEquals(res.status, 403);
      assertEquals(count(rpc('create_ticket_order')), 0);
      assertEquals(count(createdUser), 0);
    });
  }),
});

Deno.test({
  name: 'over the rate limit: 429, before the bot check and before any lookup',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world({ limited: true }));
    const res = await handler(post(order()));
    assertEquals(res.status, 429);
    assertEquals(count(verifiedBot), 0);
    assertEquals(count((c) => c.url.pathname.startsWith('/rest/v1/tickets')), 0);
    assertEquals(count(createdUser), 0);
  }),
});

Deno.test({
  name: 'a malformed request is refused for free: not counted, not verified, nothing created',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world());
    const res = await handler(post(order({ tickets: [] })));
    assertEquals(res.status, 400);
    assertEquals(calls.length, 0);
  }),
});

Deno.test({
  name: 'a replay of a completed order returns it without spending a bot check',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world({
      replayRows: [{ id: 'ticket-1', order_token: 'ord-1', status: 'confirmed', user_id: 'buyer-1', qr_code: 'q', square_payment_id: null, square_receipt_url: null }],
      profiles: [{ id: 'buyer-1' }],
    }));
    const res = await handler(post(order({ turnstile_token: 'spent-on-the-first-attempt' })));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.replayed, true);
    assertEquals(body.order_token, 'ord-1');
    assert(!('user_id' in body.tickets[0]), 'the owner column is not echoed per ticket');
    assertEquals(count(verifiedBot), 0);
    assertEquals(count(createdUser), 0);
  }),
});

Deno.test({
  name: "a key that is someone else's order is not a replay — the caller goes through the bot check",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world({
      bot: false,
      replayRows: [{ id: 'ticket-1', order_token: 'ord-1', status: 'confirmed', user_id: 'somebody-else' }],
      profiles: [],
    }));
    const res = await handler(post(order()));
    assertEquals(res.status, 403);
  }),
});

Deno.test({
  name: "GoTrue's own sentence does not reach the caller (L10)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world({
      createUser: (c) => createdUser(c)
        ? jsonResponse({ code: 'unexpected_failure', msg: 'Database error saving new user', error_code: 'unexpected_failure' }, 500)
        : undefined,
    }));
    const res = await handler(post(order()));
    assertEquals(res.status, 500);
    const text = await res.text();
    assert(!/Database error|Failed to create account|unexpected/i.test(text), text);
    assertStringIncludes(text, 'not charged');
  }),
});

Deno.test({
  name: 'get_config with Square unconfigured names no environment variable (L10)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes([]);
    const unset = Object.fromEntries(Object.keys(SQUARE_TEST_ENV).map((k) => [k, null]));
    await withEnv(unset, async () => {
      const res = await handler(post({ action: 'get_config' }));
      assertEquals(res.status, 500);
      const text = await res.text();
      assert(!/SQUARE_|ACCESS_TOKEN|credentials/i.test(text), text);
    });
  }),
});
