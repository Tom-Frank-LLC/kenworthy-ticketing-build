import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  absCents,
  bucketFor,
  categoryByDayQuery,
  cents,
  granularityFor,
  pollLoad,
  refundsQuery,
  resolveRange,
  shape,
  topPerformersQuery,
  totalsQuery,
  venueDate,
} from './square-reporting.ts';

/**
 * The previous implementation of this tab was internally consistent, fully
 * tested, and wrong by 35%. So these tests aim at the joins to Square rather
 * than at the arithmetic: the async 200, the dollars/cents boundary, the
 * mandatory query wrapper, and the row-limit truncation.
 */

const ITEM_TIME = 'ItemTransactions.local_reporting_timestamp';

const catRow = (category: string, gross: number, qty: number, day?: string) => ({
  'ItemTransactions.category_name': category,
  'ItemTransactions.sales_gross_amount': gross,
  'ItemTransactions.items_sold_count': qty,
  ...(day ? { [`${ITEM_TIME}.day`]: `${day}T00:00:00.000` } : {}),
});

const TOTALS = [{
  'Sales.total_collected_amount': 58712.92999999968,
  'Sales.net_sales': 55086.69,
  'Sales.order_count': 2894,
  'Sales.tips_amount': 1493.49,
  'Sales.sales_tax_amount': 2161.230000000011,
}];

const REFUNDS = [
  { 'PaymentAndRefunds.type': 'PAYMENT', 'PaymentAndRefunds.count': 2988, 'PaymentAndRefunds.refund_total_amount': 0 },
  { 'PaymentAndRefunds.type': 'REFUND', 'PaymentAndRefunds.count': 4, 'PaymentAndRefunds.refund_total_amount': -63.21 },
];

const run = (categoryRows: any[], over: Record<string, unknown> = {}) =>
  shape({
    range: { start: '2026-07-21', end: '2026-08-20' },
    granularity: 'day',
    totalsRows: TOTALS,
    categoryRows,
    topRows: [],
    uncategorizedRows: [],
    refundRows: REFUNDS,
    categoryRowLimit: 10000,
    ...over,
  } as any);

// --- the dollars/cents boundary --------------------------------------------

Deno.test('Square dollars become cents, floating point and all', () => {
  // This is the literal value the live account returns. Naive *100 gives
  // 2874747.9999999995, which floors to a cent short.
  assertEquals(cents(28747.479999999996), 2874748);
  assertEquals(cents(58712.92999999968), 5871293);
  assertEquals(cents(0), 0);
  assertEquals(cents(null), 0);
  assertEquals(cents(undefined), 0);
  // Refunds arrive negative; the cards want a magnitude.
  assertEquals(absCents(-63.21), 6321);
});

Deno.test('totals carry through from the live figures', () => {
  const r = run([]);
  assertEquals(r.totals.totalCollectedCents, 5871293);
  assertEquals(r.totals.netSalesCents, 5508669);
  assertEquals(r.totals.tipsCents, 149349);
  assertEquals(r.totals.taxCents, 216123);
  assertEquals(r.meta.orders, 2894);
});

// --- refunds: the row must be picked by type, not by position ---------------

Deno.test('refunds read the REFUND row, never the PAYMENT row', () => {
  const r = run([]);
  assertEquals(r.totals.refundCount, 4);
  assertEquals(r.totals.refundCents, 6321);
});

Deno.test('no REFUND row means zero, not the payment count', () => {
  const r = run([], { refundRows: [REFUNDS[0]] });
  assertEquals(r.totals.refundCount, 0);
  assertEquals(r.totals.refundCents, 0);
});

// --- bucketing --------------------------------------------------------------

Deno.test('the concession bucket is the whole stand', () => {
  for (const c of ['1 Combos', '2 Candy', '3 Soda', '4 Beer', '5 Popcorn', 'Cafe', 'Cocktails']) {
    assertEquals(bucketFor(c), 'concessions', c);
  }
  for (const c of ['6 Film Tickets', '6 METLive Tickets', '6 NT Live Tickets', '6 Rental Tickets']) {
    assertEquals(bucketFor(c), 'tickets', c);
  }
  // Real categories on this account that are neither.
  assertEquals(bucketFor('Theater Rental'), 'other');
  assertEquals(bucketFor('9 Film Passes'), 'other');
  assertEquals(bucketFor('Uncategorized'), 'other');
  assertEquals(bucketFor(null), 'other');
});

Deno.test('tickets, concessions and the day chart all reconcile with gross', () => {
  const rows = [
    catRow('6 Film Tickets', 100, 10, '2026-08-11'),
    catRow('5 Popcorn', 50, 20, '2026-08-11'),
    catRow('Theater Rental', 25, 1, '2026-08-11'),
    catRow('6 Film Tickets', 60, 6, '2026-08-12'),
  ];
  const r = run(rows);
  assertEquals(r.totals.grossSalesCents, 23500);
  assertEquals(r.totals.ticketsSold, 16);
  assertEquals(r.totals.concessionRevenueCents, 5000);
  assertEquals(r.totals.avgPerTicketCents, 1000);
  const dayTotal = r.revenueByDay.reduce((s, d) => s + d.totalCents, 0);
  const pieTotal = r.revenueByCategory.reduce((s, c) => s + c.amountCents, 0);
  assertEquals(dayTotal, 23500);
  assertEquals(pieTotal, 23500);
  assertEquals(r.revenueByDay.map((d) => d.date), ['2026-08-11', '2026-08-12']);
  assertEquals(r.revenueByDay[0], {
    date: '2026-08-11', ticketsCents: 10000, concessionsCents: 5000, otherCents: 2500, totalCents: 17500,
  });
});

Deno.test('a category split across days is merged in the pie', () => {
  const r = run([
    catRow('6 Film Tickets', 100, 10, '2026-08-11'),
    catRow('6 Film Tickets', 60, 6, '2026-08-12'),
  ]);
  assertEquals(r.revenueByCategory, [{ name: '6 Film Tickets', amountCents: 16000, quantity: 16 }]);
});

Deno.test('avg per ticket ignores concession revenue and survives zero tickets', () => {
  const r = run([catRow('6 Film Tickets', 100, 10), catRow('5 Popcorn', 9999, 500)]);
  assertEquals(r.totals.avgPerTicketCents, 1000);
  assertEquals(run([]).totals.avgPerTicketCents, 0);
});

Deno.test('an empty range shapes to zeros rather than throwing', () => {
  const r = run([], { totalsRows: [] });
  assertEquals(r.totals.totalCollectedCents, 0);
  assertEquals(r.totals.ticketsSold, 0);
  assertEquals(r.revenueByDay, []);
  assertEquals(r.revenueByCategory, []);
  assertEquals(r.meta.orders, 0);
});

// --- silent truncation ------------------------------------------------------

Deno.test('hitting the row limit is reported, not swallowed', () => {
  // Cube truncates at `limit` with no error, exactly like PostgREST.
  const rows = Array.from({ length: 5 }, (_, i) => catRow('6 Film Tickets', 1, 1, `2026-08-0${i + 1}`));
  assertEquals(run(rows, { categoryRowLimit: 5 }).meta.truncated, true);
  assertEquals(run(rows, { categoryRowLimit: 6 }).meta.truncated, false);
});

// --- the async 200 ----------------------------------------------------------

Deno.test('"Continue wait" is a 200 that means keep polling', async () => {
  let calls = 0;
  const fetchImpl = ((_u: string, _i: any) => {
    calls++;
    const body = calls < 3
      ? JSON.stringify({ error: 'Continue wait' })
      : JSON.stringify({ data: [{ 'Sales.order_count': 2894 }] });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as unknown as typeof fetch;

  const rows = await pollLoad({
    environment: 'production', accessToken: 't', query: totalsQuery({ start: 'a', end: 'b' }),
    fetchImpl, sleep: () => Promise.resolve(),
  });
  assertEquals(calls, 3);
  assertEquals(rows, [{ 'Sales.order_count': 2894 }]);
});

Deno.test('a real error is raised, not returned as no rows', async () => {
  const fetchImpl = (() =>
    Promise.resolve(new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 }))
  ) as unknown as typeof fetch;
  await assertRejects(
    () => pollLoad({ environment: 'production', accessToken: 't', query: totalsQuery({ start: 'a', end: 'b' }), fetchImpl, sleep: () => Promise.resolve() }),
    Error,
    'Reporting API 400',
  );
});

Deno.test('polling gives up rather than hanging forever', async () => {
  const fetchImpl = (() =>
    Promise.resolve(new Response(JSON.stringify({ error: 'Continue wait' }), { status: 200 }))
  ) as unknown as typeof fetch;
  await assertRejects(
    () => pollLoad({ environment: 'production', accessToken: 't', query: totalsQuery({ start: 'a', end: 'b' }), fetchImpl, sleep: () => Promise.resolve(), maxAttempts: 3 }),
    Error,
    'did not finish computing',
  );
});

Deno.test('the query is wrapped, or Square answers "Query param is required"', async () => {
  let sent: any = null;
  const fetchImpl = ((_u: string, init: any) => {
    sent = JSON.parse(init.body);
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  }) as unknown as typeof fetch;
  await pollLoad({ environment: 'production', accessToken: 't', query: totalsQuery({ start: 'a', end: 'b' }), fetchImpl, sleep: () => Promise.resolve() });
  assert(sent.query, 'body must have a top-level `query` wrapper');
  assertEquals(sent.query.measures[0], 'Sales.total_collected_amount');
});

// --- ranges -----------------------------------------------------------------

Deno.test('ranges are venue-local calendar dates, inclusive of today', () => {
  // 20 Aug 04:00 UTC is still the 19th in Moscow, Idaho. The old rolling-UTC
  // window is exactly what shifted an evening's takings into the wrong day.
  const now = new Date('2026-08-20T04:00:00Z');
  assertEquals(venueDate(now), '2026-08-19');
  const r = resolveRange('30d', now);
  assertEquals(r.end, '2026-08-19');
  assertEquals(r.start, '2026-07-21');
});

Deno.test('presets resolve, and an unknown one falls back to 30 days', () => {
  const now = new Date('2026-08-20T18:00:00Z');
  assertEquals(resolveRange('30d', now), { start: '2026-07-22', end: '2026-08-20' });
  assertEquals(resolveRange('90d', now).start, '2026-05-23');
  assertEquals(resolveRange('ytd', now), { start: '2026-01-01', end: '2026-08-20' });
  assertEquals(resolveRange('nonsense', now), resolveRange('30d', now));
  assertEquals(resolveRange(undefined, now), resolveRange('30d', now));
});

Deno.test('a custom range needs both ends', () => {
  const now = new Date('2026-08-20T18:00:00Z');
  assertEquals(resolveRange('custom', now, { start: '2026-01-01', end: '2026-02-01' }),
    { start: '2026-01-01', end: '2026-02-01' });
  assertEquals(resolveRange('custom', now, { start: '2026-01-01' }), resolveRange('30d', now));
});

Deno.test('long ranges switch to months so the chart stays readable', () => {
  assertEquals(granularityFor({ start: '2026-07-21', end: '2026-08-20' }), 'day');
  assertEquals(granularityFor({ start: '2026-01-01', end: '2026-08-20' }), 'month');
});

// --- query shapes -----------------------------------------------------------

Deno.test('no query sends `order` — Square rejects it with a bare Invalid request', () => {
  const range = { start: '2026-07-21', end: '2026-08-20' };
  for (const q of [totalsQuery(range), categoryByDayQuery(range, 'day'), topPerformersQuery(range), refundsQuery(range)]) {
    assert(!('order' in q), 'order must not be sent');
  }
});

Deno.test('top performers are sorted and capped by us, not by Square', () => {
  const rows = [
    { 'ItemTransactions.item_name': 'SMALL', 'ItemTransactions.sales_gross_amount': 10, 'ItemTransactions.items_sold_count': 1 },
    { 'ItemTransactions.item_name': 'BIG', 'ItemTransactions.sales_gross_amount': 900, 'ItemTransactions.items_sold_count': 9 },
  ];
  const r = run([], { topRows: rows });
  assertEquals(r.topPerformers.map((p) => p.title), ['BIG', 'SMALL']);
  assertEquals(r.topPerformers[0].revenueCents, 90000);
});

Deno.test('top performers are filtered to ticket categories only', () => {
  const q = topPerformersQuery({ start: '2026-07-21', end: '2026-08-20' });
  assertEquals(q.dimensions, ['ItemTransactions.item_name']);
  const f = q.filters![0];
  assertEquals(f.member, 'ItemTransactions.category_name');
  assert(f.values.includes('6 Film Tickets'));
  assert(!f.values.includes('5 Popcorn'), 'popcorn is not a performer');
});

Deno.test('queries carry the date range Square was given', () => {
  const range = { start: '2026-07-21', end: '2026-08-20' };
  for (const q of [totalsQuery(range), categoryByDayQuery(range, 'day'), refundsQuery(range)]) {
    assertEquals(q.timeDimensions![0].dateRange, ['2026-07-21', '2026-08-20']);
  }
  assertEquals(categoryByDayQuery(range, 'day').timeDimensions![0].granularity, 'day');
});
