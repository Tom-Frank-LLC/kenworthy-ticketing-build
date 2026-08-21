import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  aggregate,
  bucketFor,
  buildCategoryLookup,
  categoryNames,
  resolveRange,
  venueDay,
} from './square-analytics.ts';

/**
 * These numbers are what the theatre's board sees on the Overview. The failure
 * mode that matters is not a crash — it is a total that looks plausible and is
 * quietly short, because a category went unresolved or a day landed in the
 * wrong bucket.
 */

const variation = (id: string, itemId: string) => ({
  type: 'ITEM_VARIATION',
  id,
  item_variation_data: { item_id: itemId },
});

const item = (id: string, categoryId: string, shape = 'reporting_category') => ({
  type: 'ITEM',
  id,
  item_data: shape === 'reporting_category'
    ? { reporting_category: { id: categoryId } }
    : shape === 'category_id'
    ? { category_id: categoryId }
    : { categories: [{ id: categoryId }] },
});

const CATEGORIES = new Map([
  ['CAT_FILM', '6 Film Tickets'],
  ['CAT_POPCORN', '5 Popcorn'],
  ['CAT_MERCH', '7 Merch'],
]);

const line = (over: Record<string, unknown> = {}) => ({
  name: 'EMILY THE CRIMINAL',
  quantity: '1',
  catalog_object_id: 'VAR_FILM',
  gross_sales_money: { amount: 800, currency: 'USD' },
  ...over,
});

const order = (over: Record<string, unknown> = {}) => ({
  closed_at: '2026-08-12T02:00:00Z',
  total_money: { amount: 848, currency: 'USD' },
  line_items: [line()],
  ...over,
});

const LOOKUP = buildCategoryLookup(
  [variation('VAR_FILM', 'ITEM_FILM'), variation('VAR_POPCORN', 'ITEM_POPCORN')],
  [item('ITEM_FILM', 'CAT_FILM'), item('ITEM_POPCORN', 'CAT_POPCORN')],
  CATEGORIES,
);

const RANGE = { start: '2026-07-20T00:00:00Z', end: '2026-08-20T00:00:00Z' };
const run = (orders: unknown[], refunds: unknown[] = []) =>
  aggregate({ orders, refunds, lookup: LOOKUP, range: RANGE });

// --- the day-bucketing trap -------------------------------------------------

Deno.test('a 7 PM screening counts on the day it was sold, not the next one', () => {
  // 7 PM Moscow, Idaho on 11 Aug is 02:00 UTC on 12 Aug. The old build-sourced
  // tab used toISOString().slice(0,10) and filed it under the 12th, shifting a
  // whole evening's takings into the following day.
  assertEquals(venueDay('2026-08-12T02:00:00Z'), '2026-08-11');
  const { revenueByDay } = run([order()]);
  assertEquals(revenueByDay.map((d) => d.date), ['2026-08-11']);
});

Deno.test('closed_at wins over created_at, so an invoice lands when it was paid', () => {
  const { revenueByDay } = run([
    order({ created_at: '2026-07-01T18:00:00Z', closed_at: '2026-08-12T02:00:00Z' }),
  ]);
  assertEquals(revenueByDay.map((d) => d.date), ['2026-08-11']);
});

// --- categories -------------------------------------------------------------

Deno.test('all three category shapes resolve, reporting_category winning', () => {
  const cats = new Map([['CAT_A', '6 Film Tickets'], ['CAT_B', '7 Merch']]);
  for (const shape of ['reporting_category', 'category_id', 'categories']) {
    const lookup = buildCategoryLookup([variation('V', 'I')], [item('I', 'CAT_A', shape)], cats);
    assertEquals(lookup.get('V'), '6 Film Tickets', `shape ${shape}`);
  }
  // When an item carries both, the reporting category is the one revenue
  // reports group by, so it must win.
  const both = {
    type: 'ITEM',
    id: 'I',
    item_data: { reporting_category: { id: 'CAT_A' }, category_id: 'CAT_B' },
  };
  assertEquals(buildCategoryLookup([variation('V', 'I')], [both], cats).get('V'), '6 Film Tickets');
});

Deno.test('categoryNames ignores non-category objects', () => {
  const names = categoryNames([
    { type: 'CATEGORY', id: 'C1', category_data: { name: '6 Film Tickets' } },
    { type: 'ITEM', id: 'I1', item_data: { name: 'not a category' } },
  ]);
  assertEquals([...names.entries()], [['C1', '6 Film Tickets']]);
});

Deno.test('the concession bucket is the whole stand, not just "Concessions"', () => {
  for (const c of ['1 Combos', '2 Candy', '4 Beer', '5 Popcorn', 'Cafe', 'Cocktails', 'Concessions']) {
    assertEquals(bucketFor(c), 'concessions', c);
  }
  for (const c of ['6 Film Tickets', '6 METLive Tickets', '6 NT Live Tickets', '6 Rental Tickets']) {
    assertEquals(bucketFor(c), 'tickets', c);
  }
  // '6 Redeem' is a pass being redeemed, not money taken at the door, and
  // '9 Film Passes' is neither a ticket nor a concession.
  assertEquals(bucketFor('7 Merch'), 'other');
  assertEquals(bucketFor(undefined), 'other');
});

// --- the silent-shortfall trap ---------------------------------------------

Deno.test('revenue from an unresolved variation is surfaced, never dropped', () => {
  // An archived screening whose variation batch-retrieve did not return. Its
  // money is real; filing it under nothing would make the pie disagree with the
  // total with no error to notice.
  const result = run([
    order({ line_items: [line({ catalog_object_id: 'VAR_GONE', gross_sales_money: { amount: 1200 } })] }),
  ]);
  assertEquals(result.meta.uncategorizedLineItems, 1);
  assertEquals(result.totals.ticketsSold, 0);
  const wedge = result.revenueByCategory.find((c) => c.name === 'Uncategorised');
  assertEquals(wedge?.amountCents, 1200);
  assertEquals(
    result.revenueByCategory.reduce((s, c) => s + c.amountCents, 0),
    result.totals.grossSalesCents,
  );
});

Deno.test('the day chart, the pie and the gross total all reconcile', () => {
  const result = run([
    order({
      line_items: [
        line({ quantity: '2', gross_sales_money: { amount: 1600 } }),
        line({ catalog_object_id: 'VAR_POPCORN', name: 'Popcorn', gross_sales_money: { amount: 500 } }),
        line({ catalog_object_id: 'VAR_GONE', name: 'Mystery', gross_sales_money: { amount: 300 } }),
      ],
    }),
  ]);
  const dayTotal = result.revenueByDay.reduce((s, d) => s + d.totalCents, 0);
  const pieTotal = result.revenueByCategory.reduce((s, c) => s + c.amountCents, 0);
  assertEquals(dayTotal, 2400);
  assertEquals(pieTotal, 2400);
  assertEquals(result.totals.grossSalesCents, 2400);
  assertEquals(result.totals.ticketsSold, 2);
  assertEquals(result.totals.concessionRevenueCents, 500);
});

// --- totals -----------------------------------------------------------------

Deno.test('quantity counts tickets, not line-item rows', () => {
  const result = run([order({ line_items: [line({ quantity: '3', gross_sales_money: { amount: 2400 } })] })]);
  assertEquals(result.totals.ticketsSold, 3);
  assertEquals(result.totals.avgPerTicketCents, 800);
});

Deno.test('avg per ticket divides ticket revenue only, and survives zero tickets', () => {
  // Concession revenue must not inflate the average price of a ticket.
  const result = run([
    order({
      line_items: [
        line({ gross_sales_money: { amount: 800 } }),
        line({ catalog_object_id: 'VAR_POPCORN', gross_sales_money: { amount: 9999 } }),
      ],
    }),
  ]);
  assertEquals(result.totals.avgPerTicketCents, 800);
  assertEquals(run([]).totals.avgPerTicketCents, 0);
});

Deno.test('total collected includes tax and tips; gross sales does not', () => {
  const result = run([order({ total_money: { amount: 848 } })]);
  assertEquals(result.totals.totalCollectedCents, 848);
  assertEquals(result.totals.grossSalesCents, 800);
});

Deno.test('an empty range aggregates to zeros rather than throwing', () => {
  const result = run([]);
  assertEquals(result.totals.totalCollectedCents, 0);
  assertEquals(result.totals.ticketsSold, 0);
  assertEquals(result.revenueByDay, []);
  assertEquals(result.revenueByCategory, []);
  assertEquals(result.topPerformers, []);
});

// --- refunds ----------------------------------------------------------------

Deno.test('only settled refunds count', () => {
  const result = run([], [
    { status: 'COMPLETED', amount_money: { amount: 800 } },
    { status: 'PENDING', amount_money: { amount: 500 } },
    { status: 'FAILED', amount_money: { amount: 9999 } },
    { status: 'REJECTED', amount_money: { amount: 9999 } },
  ]);
  assertEquals(result.totals.refundCount, 2);
  assertEquals(result.totals.refundCents, 1300);
});

// --- top performers ---------------------------------------------------------

Deno.test('top performers group by title, not by showtime variation', () => {
  const result = run([
    order({
      line_items: [
        line({ name: 'DUNE', variation_name: 'Adult - August 11 at 7 PM', gross_sales_money: { amount: 800 } }),
        line({ name: 'DUNE', variation_name: 'Child - August 11 at 7 PM', gross_sales_money: { amount: 500 } }),
        line({ name: 'ARRIVAL', gross_sales_money: { amount: 900 } }),
      ],
    }),
  ]);
  assertEquals(result.topPerformers.length, 2);
  assertEquals(result.topPerformers[0], { title: 'DUNE', revenueCents: 1300, count: 2 });
  // Concessions are not a "performer".
  assert(!result.topPerformers.some((p) => p.title === 'Popcorn'));
});

// --- ranges -----------------------------------------------------------------

Deno.test('range presets resolve against an injected clock', () => {
  const now = new Date('2026-08-20T12:00:00Z');
  assertEquals(resolveRange('30d', now).start, '2026-07-21T12:00:00.000Z');
  assertEquals(resolveRange('90d', now).start, '2026-05-22T12:00:00.000Z');
  assertEquals(resolveRange('ytd', now).start, '2026-01-01T00:00:00.000Z');
  // An unknown preset falls back to 30 days rather than to "all time", so a
  // typo cannot trigger a full-history scan.
  assertEquals(resolveRange('nonsense', now).start, resolveRange('30d', now).start);
  assertEquals(resolveRange(undefined, now).start, resolveRange('30d', now).start);
});

Deno.test('a custom range needs both ends, or it falls back to the preset', () => {
  const now = new Date('2026-08-20T12:00:00Z');
  const custom = resolveRange('custom', now, { start: '2026-01-01', end: '2026-02-01' });
  assertEquals(custom.start, '2026-01-01T00:00:00.000Z');
  assertEquals(custom.end, '2026-02-01T00:00:00.000Z');
  assertEquals(resolveRange('custom', now, { start: '2026-01-01' }).start, resolveRange('30d', now).start);
});
