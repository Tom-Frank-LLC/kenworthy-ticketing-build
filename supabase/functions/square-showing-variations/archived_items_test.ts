// Archived Square items are not candidates for a title match
// (docs/briefs/BRIEF-square-link-ignore-archived.md).
//
// The real handler, with PostgREST and Square stubbed. `/catalog/list` returns
// archived items alongside live ones, so these feed it exactly that: a live
// item plus archived namesakes, the shape that made Backcountry Film Festival
// unlinkable in Oct 2026.
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/square-showing-variations/archived_items_test.ts

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  ANON,
  authUsers,
  BASE_ENV,
  type Call,
  jsonResponse,
  loadHandler,
  quietly,
  roleGateRoute,
  type Route,
  rows,
  SQUARE_TEST_ENV,
  testJwt,
  useRoutes,
  withEnv,
} from '../_shared/testing/handler_harness.ts';

const handler = await loadHandler(() => import('./index.ts'), BASE_ENV);

const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const BEARER = testJwt(ADMIN, 'aal2');
const users = authUsers({ [BEARER]: { id: ADMIN, email: 'admin@x.test' } });
const gate = roleGateRoute(() => 'ok');

const TITLE = 'Backcountry Film Festival';
const EVENT_ID = '00000000-0000-0000-0000-00000000e001';
const SHOWING_ID = '00000000-0000-0000-0000-00000000s001';
const PASS_ID = '00000000-0000-0000-0000-00000000p001';

const item = (id: string, name: string, opts: { type?: string; archived?: boolean } = {}) => ({
  type: 'ITEM',
  id,
  item_data: {
    name,
    product_type: opts.type ?? 'EVENT',
    ...(opts.archived ? { is_archived: true } : {}),
    variations: [{
      type: 'ITEM_VARIATION',
      id: `${id}-V`,
      item_variation_data: { item_id: id, name: 'Regular', price_money: { amount: 1500, currency: 'USD' } },
    }],
  },
});

/** Our side: one active showing of one event with no stored Square item; one pass type. */
const db: Route = (c: Call) => {
  if (c.method !== 'GET' || !c.url.pathname.startsWith('/rest/v1/')) return undefined;
  const table = c.url.pathname.slice('/rest/v1/'.length);
  const start = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  switch (table) {
    case 'showings':
      return rows(c, [{
        id: SHOWING_ID, start_time: start, ticket_price: 15, is_active: true,
        movie_id: null, event_id: EVENT_ID, live_performance_id: null,
      }]);
    case 'events':
      return rows(c, [{ id: EVENT_ID, title: TITLE, square_item_id: null }]);
    case 'showing_price_tiers':
    case 'showing_square_variations':
    case 'movies':
    case 'live_performances':
      return rows(c, []);
    case 'film_pass_types':
      return rows(c, [{
        id: PASS_ID, name: TITLE, price: 40, is_active: true,
        square_item_id: null, square_variation_id: null,
      }]);
    default:
      return undefined;
  }
};

/** Square's ListCatalog, one page, ITEM or CATEGORY as asked. */
const catalog = (items: unknown[]): Route => (c) => {
  if (!c.url.hostname.includes('squareup') || !c.url.pathname.endsWith('/catalog/list')) return undefined;
  const types = c.url.searchParams.get('types');
  return jsonResponse({ objects: types === 'ITEM' ? items : [] });
};

function plan(action = 'plan'): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${BEARER}` },
    body: JSON.stringify({ action }),
  });
}

function run(name: string, items: unknown[], fn: (body: any) => void, action = 'plan') {
  Deno.test({
    name,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: () => quietly(() => withEnv(SQUARE_TEST_ENV, async () => {
      useRoutes([users, gate, db, catalog(items)]);
      const res = await handler(plan(action));
      const body = await res.json();
      assertEquals(res.status, 200, JSON.stringify(body));
      fn(body);
    })),
  });
}

// ---- productions ------------------------------------------------------------

run('one live EVENT item and archived namesakes: the showing resolves to the live item', [
  item('LIVE', TITLE),
  item('OLD1', TITLE.toUpperCase(), { archived: true }),
  item('OLD2', TITLE, { archived: true }),
], (body) => {
  assertEquals(body.counts, { would_append: 1 });
  assertEquals(body.appendable[0].square_item_id, 'LIVE');
  assertEquals(body.appendable[0].resolved_by, 'title_match');
  assertEquals(body.needs_dashboard_item, []);
});

run('two live EVENT items with the title are still ambiguous', [
  item('A', TITLE),
  item('B', TITLE),
  item('OLD', TITLE, { archived: true }),
], (body) => {
  assertEquals(body.counts, { ambiguous_item: 1 });
  assertEquals(body.needs_dashboard_item[0].status, 'ambiguous_item');
});

run('an archived-only title says so, rather than reading as "create one"', [
  item('OLD', TITLE, { archived: true }),
], (body) => {
  assertEquals(body.counts, { archived_match: 1 });
  const row = body.needs_dashboard_item[0];
  assertEquals(row.status, 'archived_match');
  assertEquals(row.archived_items, [{ id: 'OLD', name: TITLE }]);
});

run('no item at all is still needs_item', [item('X', 'Something Else')], (body) => {
  assertEquals(body.counts, { needs_item: 1 });
});

// ---- film passes --------------------------------------------------------------

run('pass: archived namesakes are not counted as duplicates', [
  item('PASS', TITLE, { type: 'REGULAR' }),
  item('PASS_OLD1', TITLE, { type: 'REGULAR', archived: true }),
  item('PASS_OLD2', TITLE, { type: 'REGULAR', archived: true }),
], (body) => {
  const p = body.pass_types[0];
  assertEquals(p.status, 'match_found');
  assertEquals(p.matching_items, 1);
  assertEquals(p.variations.map((v: any) => v.item_id), ['PASS']);
  assertEquals(p.archived_items, []);
}, 'plan_film_passes');

run('pass: an archived-only name is archived_match, not needs_item', [
  item('PASS_OLD', TITLE, { type: 'REGULAR', archived: true }),
], (body) => {
  const p = body.pass_types[0];
  assertEquals(p.status, 'archived_match');
  assertEquals(p.matching_items, 0);
  assertEquals(p.variations, []);
  assertEquals(p.archived_items, [{ id: 'PASS_OLD', name: TITLE }]);
}, 'plan_film_passes');
