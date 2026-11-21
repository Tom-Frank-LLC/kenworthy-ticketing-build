// promo-quote's limits, proven against the real handler. Every outbound call
// is stubbed (_shared/testing/handler_harness.ts).
//
// What is pinned, and why each matters:
//   * a caller over the miss limit gets 429 BEFORE any pricing, so the answer
//     cannot leak whether their next guess was right
//   * only a refused code is counted as a miss; a working code re-priced on
//     every basket change is never counted
//   * the coded quote is asked for, never the public quote_ticket_order
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/promo-quote/abuse_controls_test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  BASE_ENV,
  type Call,
  type Route,
  calls,
  is,
  jsonResponse,
  loadHandler,
  post,
  quietly,
  rows,
  rpc,
  useRoutes,
} from '../_shared/testing/handler_harness.ts';

const handler = await loadHandler(() => import('./index.ts'), BASE_ENV);

const pricedRow = {
  seq: 0, seat_id: null, tier_id: null, tier_name: null,
  list_price: 8, discount_amount: 2, price: 6, tax_amount: 0.36, total_price: 6.36,
  discount_id: 'rule-1', discount_label: 'Fall 25%',
  order_list_subtotal: 8, order_discount: 2, order_subtotal: 6, order_tax: 0.36,
  order_total: 6.36, order_processing_fee: 0, order_grand_total: 6.36,
  production_title: 'Metropolis', production_category: 'Films',
  promo_code: 'FALL25', promo_status: 'applied', promo_min_quantity: 1,
};

const bucketOf = (c: Call) => (c.body as { p_bucket?: string } | null)?.p_bucket;
const claims = (bucket: string) => calls.filter((c) => rpc('check_rate_limit')(c) && bucketOf(c) === bucket).length;

function world(over: { missCount?: number; quote?: Route } = {}): Route[] {
  return [
    // The read-only peek at the miss counter.
    (c) => is(c, 'GET', '/rest/v1/rate_limits')
      ? rows(c, over.missCount == null ? [] : [{ count: over.missCount, expires_at: '2099-01-01T00:00:00Z' }])
      : undefined,
    (c) => rpc('check_rate_limit')(c) ? jsonResponse({ allowed: true, count: 1, limit: 300, retry_after: 600 }) : undefined,
    over.quote ?? ((c) => rpc('quote_ticket_order_coded')(c) ? jsonResponse([pricedRow]) : undefined),
    (c) => is(c, 'GET', '/rest/v1/showings')
      ? rows(c, [{ id: 's', total_seats: 100, requires_seat_selection: false, start_time: '2099-01-01T00:00:00Z', max_tickets_per_buyer: 6 }])
      : undefined,
  ];
}

const body = (over: Record<string, unknown> = {}) => ({ showing_id: 's', tickets: [{}], code: 'fall25', ...over });

Deno.test({
  name: 'a working code: priced through the coded quote, and not counted as a miss',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world());
    const res = await handler(post(body()));
    assertEquals(res.status, 200, await res.clone().text());
    const out = await res.json();
    assertEquals(out.promo, { code: 'FALL25', status: 'applied', minQuantity: 1 });
    assertEquals(out.quote.discount, { label: 'Fall 25%', amount: 2 });
    assertEquals(calls.filter(rpc('quote_ticket_order')).length, 0, 'never the public quote');
    const sent = calls.find(rpc('quote_ticket_order_coded'))!.body as { p_code: string; p_buyer: string | null };
    assertEquals(sent.p_code, 'fall25');
    assertEquals(sent.p_buyer, null);
    assertEquals(claims('promo-code-miss'), 0);
    assertEquals(claims('promo-quote'), 1);
  }),
});

Deno.test({
  name: 'a refused code is a miss, and its sentence reaches the page',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world({
      quote: (c) => rpc('quote_ticket_order_coded')(c)
        ? jsonResponse({ code: 'PT422', message: "That promo code isn't valid.", details: null, hint: null }, 400)
        : undefined,
    }));
    const res = await handler(post(body({ code: 'GUESS' })));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: "That promo code isn't valid.", promo_refused: true });
    assertEquals(claims('promo-code-miss'), 1);
  }),
});

Deno.test({
  name: 'over the miss limit: refused before pricing, right code or wrong',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world({ missCount: 20 }));
    const res = await handler(post(body()));
    assertEquals(res.status, 429);
    assert((await res.json()).promo_refused);
    assertEquals(calls.filter(rpc('quote_ticket_order_coded')).length, 0, 'no answer about the code at all');
  }),
});

Deno.test({
  name: 'just under the miss limit still answers',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world({ missCount: 19 }));
    const res = await handler(post(body()));
    assertEquals(res.status, 200);
  }),
});

Deno.test({
  name: 'an order the database cannot price is not a miss',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world({
      quote: (c) => rpc('quote_ticket_order_coded')(c)
        ? jsonResponse({ code: 'PT409', message: 'This showing is sold out.', details: null, hint: null }, 400)
        : undefined,
    }));
    const res = await handler(post(body()));
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, 'This showing is sold out.');
    assertEquals(claims('promo-code-miss'), 0);
  }),
});

Deno.test({
  name: 'no code, no lookup',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes(world());
    const res = await handler(post(body({ code: '   ' })));
    assertEquals(res.status, 400);
    assertEquals(calls.filter(rpc('quote_ticket_order_coded')).length, 0);
  }),
});
