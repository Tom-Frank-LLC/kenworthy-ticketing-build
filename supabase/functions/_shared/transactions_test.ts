import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  attachSiteMatches,
  buildCatalogIndex,
  buildFacets,
  type CatalogIndex,
  expectsSquare,
  filterRows,
  hasTender,
  MAX_RANGE_DAYS,
  normalizeOrder,
  POS_SOURCE,
  resolveTransactionRange,
  type SiteRecord,
  siteOnlyRows,
  sortRows,
  totalsFor,
  venueDayStart,
} from './transactions.ts';
import { venueDate } from './square-reporting.ts';

/**
 * What these protect.
 *
 * This screen is the one place where Square's ledger and ours are put side by
 * side, so its failure mode is not a crash — it is a confident wrong answer. A
 * broken match reports a paid ticket as money the theatre never received, or
 * hides a real one. Both look identical to a reader. So the matching rules, the
 * refund arithmetic and the range boundaries are pinned here.
 */

const EMPTY: CatalogIndex = new Map();

const order = (over: Record<string, unknown> = {}) => ({
  id: 'ORDER_1',
  location_id: 'LOC_1',
  created_at: '2026-08-01T18:30:00Z',
  state: 'COMPLETED',
  total_money: { amount: 1696, currency: 'USD' },
  total_tax_money: { amount: 96, currency: 'USD' },
  total_tip_money: { amount: 0, currency: 'USD' },
  total_discount_money: { amount: 0, currency: 'USD' },
  line_items: [
    {
      uid: 'L1',
      name: 'EMILY THE CRIMINAL',
      variation_name: 'Adult - Saturday, August 1 at 7 PM',
      quantity: '2',
      catalog_object_id: 'VAR_ADULT',
      gross_sales_money: { amount: 1600 },
      total_tax_money: { amount: 96 },
      total_money: { amount: 1696 },
    },
  ],
  tenders: [
    {
      id: 'TENDER_1',
      payment_id: 'PAY_1',
      type: 'CARD',
      amount_money: { amount: 1696 },
      tip_money: { amount: 0 },
      card_details: { card: { card_brand: 'VISA', last_4: '4242' } },
    },
  ],
  ...over,
});

const record = (over: Partial<SiteRecord> = {}): SiteRecord => ({
  kind: 'tickets',
  orderToken: 'TOKEN_1',
  squarePaymentId: 'PAY_1',
  paymentMethod: 'card',
  buyerName: 'Dana Hendricks',
  buyerEmail: 'dana@example.com',
  recordIds: ['TICKET_A', 'TICKET_B'],
  showingId: 'SHOWING_1',
  showingLabel: 'EMILY THE CRIMINAL · 2026-08-01T19:00:00Z',
  totalCents: 1696,
  createdAt: '2026-08-01T18:30:00Z',
  receiptUrl: 'https://squareup.com/receipt/1',
  ...over,
});

// ---------------------------------------------------------------------------
// Normalising an order
// ---------------------------------------------------------------------------

Deno.test('a POS sale with no source name is labelled, not left blank', () => {
  // 4,054 of ~5,000 recent orders carry no `source.name` at all. Rendering
  // those as an empty cell would make the commonest sale in the account look
  // like missing data.
  const row = normalizeOrder(order(), EMPTY);
  assertEquals(row.source, POS_SOURCE);
  assertEquals(row.tenderTypes, ['CARD']);
  assertEquals(row.tenders[0].paymentId, 'PAY_1');
  assertEquals(row.tenders[0].last4, '4242');
  assertEquals(row.status, 'Completed');
  assertEquals(row.reconciliation, 'square_only');
});

Deno.test('a named source is kept', () => {
  const row = normalizeOrder(order({ source: { name: 'Square Online' } }), EMPTY);
  assertEquals(row.source, 'Square Online');
});

Deno.test('tender payment_id wins over tender id', () => {
  // Our tables store the PAYMENT id. Matching on the tender id instead would
  // miss every site sale while looking like it worked.
  const row = normalizeOrder(order(), EMPTY);
  assertEquals(row.tenders[0].paymentId, 'PAY_1');
});

Deno.test('a tender with no payment_id falls back to the tender id', () => {
  const row = normalizeOrder(
    order({ tenders: [{ id: 'TENDER_ONLY', type: 'CASH', amount_money: { amount: 800 } }] }),
    EMPTY,
  );
  assertEquals(row.tenders[0].paymentId, 'TENDER_ONLY');
  assertEquals(row.tenders[0].tipCents, 0);
});

Deno.test('a fully refunded order reads Refunded, a partial one reads partial', () => {
  const full = normalizeOrder(
    order({ refunds: [{ id: 'R1', amount_money: { amount: 1696 }, status: 'APPROVED' }] }),
    EMPTY,
  );
  assertEquals(full.status, 'Refunded');
  assertEquals(full.refundedCents, 1696);

  const partial = normalizeOrder(
    order({ refunds: [{ id: 'R1', amount_money: { amount: 848 }, status: 'APPROVED' }] }),
    EMPTY,
  );
  assertEquals(partial.status, 'Partially refunded');
  assertEquals(partial.refundedCents, 848);
});

Deno.test('a rejected refund does not reduce the sale', () => {
  // A failed refund attempt is not money returned. Counting it would show a
  // sale as refunded while the patron is still out of pocket.
  const row = normalizeOrder(
    order({ refunds: [{ id: 'R1', amount_money: { amount: 1696 }, status: 'REJECTED' }] }),
    EMPTY,
  );
  assertEquals(row.status, 'Completed');
  assertEquals(row.refundedCents, 0);
});

Deno.test('a pending refund does count', () => {
  // Staff who just issued a refund must see it. Waiting for settlement would
  // tell them it had not happened.
  const row = normalizeOrder(
    order({ refunds: [{ id: 'R1', amount_money: { amount: 1696 }, status: 'PENDING' }] }),
    EMPTY,
  );
  assertEquals(row.status, 'Refunded');
});

Deno.test('missing money fields become zero, not NaN', () => {
  // Square omits zero-valued money objects. `undefined.amount` propagating into
  // a total would render the whole column as NaN.
  const row = normalizeOrder(
    { id: 'O', created_at: '2026-08-01T00:00:00Z', line_items: [], tenders: [] },
    EMPTY,
  );
  assertEquals(row.totalCents, 0);
  assertEquals(row.taxCents, 0);
  assertEquals(row.tipCents, 0);
  assertEquals(row.itemsSummary, '—');
});

Deno.test('the buyer falls back to a Square Online fulfillment recipient', () => {
  // Only 26 of ~5,000 orders carry a customer, but Square Online fills in a
  // recipient — the one place Square knows a name without our help.
  const row = normalizeOrder(
    order({
      source: { name: 'Square Online' },
      fulfillments: [{
        type: 'PICKUP',
        pickup_details: { recipient: { display_name: 'Sam Reyes', email_address: 's@example.com' } },
      }],
    }),
    EMPTY,
  );
  assertEquals(row.buyerName, 'Sam Reyes');
  assertEquals(row.buyerEmail, 's@example.com');
});

// ---------------------------------------------------------------------------
// What counts as a transaction
// ---------------------------------------------------------------------------

Deno.test('a tender, not a state, is what makes an order a transaction', () => {
  // FINDINGS-square-reporting-api.md §2 measured the old analytics function 35%
  // below Square and named `state_filter: ["COMPLETED"]` as suspect one: OPEN
  // may include paid-but-unclosed checks. So a paid OPEN check is kept.
  assert(hasTender(order({ state: 'OPEN' })));
  assert(hasTender(order({ state: 'COMPLETED' })));
});

Deno.test('an unpaid cart or draft is not a transaction', () => {
  assertFalse(hasTender(order({ state: 'DRAFT', tenders: [] })));
  assertFalse(hasTender(order({ state: 'OPEN', tenders: undefined })));
  assertFalse(hasTender({}));
});

Deno.test('the order state is carried on the row, not filtered away', () => {
  // A reader must be able to see that a sale was OPEN rather than have it
  // silently included — or, as before, silently dropped.
  const row = normalizeOrder(order({ state: 'OPEN' }), EMPTY);
  assertEquals(row.state, 'OPEN');
  assertEquals(buildFacets([row]).states, ['OPEN']);
  assertEquals(filterRows([row], { states: ['COMPLETED'] }).length, 0);
  assertEquals(filterRows([row], { states: ['OPEN'] }).length, 1);
});

Deno.test('a site-only row claims no Square state', () => {
  // Faking COMPLETED would read as "Square has this" — the opposite of what
  // the row exists to say.
  const [row] = siteOnlyRows([record({ squarePaymentId: null })]);
  assertEquals(row.state, '');
  assertEquals(buildFacets([row]).states, []);
});

// ---------------------------------------------------------------------------
// When the money moved
// ---------------------------------------------------------------------------

Deno.test('a POS sale is collected when it is rung up', () => {
  const row = normalizeOrder(
    order({ tenders: [{ id: 'T', type: 'CASH', amount_money: { amount: 800 }, created_at: '2026-08-01T18:30:00Z' }] }),
    EMPTY,
  );
  assertEquals(row.createdAt, '2026-08-01T18:30:00Z');
  assertEquals(row.collectedAt, '2026-08-01T18:30:00Z');
});

Deno.test('an invoice is collected long after it is rung up', () => {
  // The reason this tab and Square's reports disagree over a short range:
  // Square dates this sale in September, we date it in August. Measured on the
  // live account 23 Aug 2026 — see FINDINGS-transactions-tab.md §8.
  const row = normalizeOrder(
    order({
      source: { name: 'Invoices' },
      created_at: '2026-08-01T18:30:00Z',
      tenders: [{ id: 'T', type: 'CARD', amount_money: { amount: 137597 }, created_at: '2026-09-14T16:02:00Z' }],
    }),
    EMPTY,
  );
  assertEquals(row.createdAt, '2026-08-01T18:30:00Z');
  assertEquals(row.collectedAt, '2026-09-14T16:02:00Z');
});

Deno.test('the earliest tender wins, and closed_at is the fallback', () => {
  const split = normalizeOrder(
    order({
      tenders: [
        { id: 'B', type: 'CARD', amount_money: { amount: 500 }, created_at: '2026-08-02T10:00:00Z' },
        { id: 'A', type: 'CASH', amount_money: { amount: 500 }, created_at: '2026-08-01T09:00:00Z' },
      ],
    }),
    EMPTY,
  );
  assertEquals(split.collectedAt, '2026-08-01T09:00:00Z');

  const undated = normalizeOrder(
    order({ closed_at: '2026-08-03T00:00:00Z', tenders: [{ id: 'T', type: 'CARD', amount_money: { amount: 100 } }] }),
    EMPTY,
  );
  assertEquals(undated.collectedAt, '2026-08-03T00:00:00Z');
});

Deno.test('a site-only row claims no collection time', () => {
  // There is no Square tender, so there is nothing to vouch for.
  const [row] = siteOnlyRows([record({ squarePaymentId: null })]);
  assertEquals(row.collectedAt, null);
});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

Deno.test('the catalog index resolves a variation to its item and category', () => {
  const index = buildCatalogIndex([
    { type: 'CATEGORY', id: 'CAT_FILM', category_data: { name: '6 Film Tickets' } },
    {
      type: 'ITEM',
      id: 'ITEM_1',
      item_data: {
        name: 'EMILY THE CRIMINAL',
        reporting_category: { id: 'CAT_FILM' },
        variations: [{ id: 'VAR_ADULT' }],
      },
    },
  ]);
  const row = normalizeOrder(order(), index);
  assertEquals(row.items[0].name, 'EMILY THE CRIMINAL');
  assertEquals(row.items[0].category, '6 Film Tickets');
  assertEquals(row.categories, ['6 Film Tickets']);
});

Deno.test('an archived variation still shows the sale, just without a category', () => {
  // `/v2/catalog/list` omits archived objects and this account has years of
  // retired showtimes. A blank category is acceptable; a missing row is not.
  const row = normalizeOrder(order(), EMPTY);
  assertEquals(row.items[0].category, null);
  assertEquals(row.items[0].name, 'EMILY THE CRIMINAL');
  assertEquals(row.categories, []);
});

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

Deno.test('a site sale matches on payment id and takes our buyer', () => {
  const rows = [normalizeOrder(order(), EMPTY)];
  const { unmatched } = attachSiteMatches(rows, [record()]);
  assertEquals(rows[0].reconciliation, 'matched');
  assertEquals(rows[0].buyerName, 'Dana Hendricks');
  assertEquals(rows[0].match?.recordIds, ['TICKET_A', 'TICKET_B']);
  assertEquals(unmatched.length, 0);
});

Deno.test('a site sale matches on reference_id when the payment id is absent', () => {
  const rows = [normalizeOrder(order({ reference_id: 'TOKEN_1' }), EMPTY)];
  const { unmatched } = attachSiteMatches(rows, [record({ squarePaymentId: null })]);
  assertEquals(rows[0].reconciliation, 'matched');
  assertEquals(unmatched.length, 0);
});

Deno.test('two of our rows on one Square order merge instead of overwriting', () => {
  // A four-seat sale is one card charge. Overwriting would show one seat of
  // four in the drawer and quietly lose the rest.
  const rows = [normalizeOrder(order(), EMPTY)];
  attachSiteMatches(rows, [
    record({ recordIds: ['TICKET_A'], totalCents: 848 }),
    record({ recordIds: ['TICKET_B'], totalCents: 848 }),
  ]);
  assertEquals(rows[0].match?.recordIds, ['TICKET_A', 'TICKET_B']);
  assertEquals(rows[0].match?.ourTotalCents, 1696);
});

Deno.test('a card sale of ours with no Square order is reported as unmatched', () => {
  const rows = [normalizeOrder(order({ tenders: [], reference_id: null }), EMPTY)];
  const { unmatched } = attachSiteMatches(rows, [record()]);
  assertEquals(unmatched.length, 1);
  assertEquals(rows[0].reconciliation, 'square_only');
});

Deno.test('comps, film-pass redemptions and till cash are never flagged', () => {
  // These never touch Square by design. Flagging them would bury the real
  // faults under hundreds of routine rows and make the view useless.
  assertFalse(expectsSquare(record({ squarePaymentId: null, paymentMethod: 'comp' })));
  assertFalse(expectsSquare(record({ squarePaymentId: null, paymentMethod: 'film_pass' })));
  assertFalse(expectsSquare(record({ squarePaymentId: null, paymentMethod: 'cash' })));
  assert(expectsSquare(record({ squarePaymentId: null, paymentMethod: 'card' })));
});

Deno.test('a record carrying a Square payment id always expects a match', () => {
  // That id came from Square. Whatever the payment method column says, the
  // charge happened.
  assert(expectsSquare(record({ squarePaymentId: 'PAY_9', paymentMethod: 'comp' })));
});

Deno.test('unmatched records become rows with no invented Square data', () => {
  const [row] = siteOnlyRows([record({ squarePaymentId: null, orderToken: 'TOKEN_9' })]);
  assertEquals(row.reconciliation, 'site_only');
  assertEquals(row.source, 'Kenworthy Website');
  assertEquals(row.tenders, []);
  assertEquals(row.taxCents, 0);
  assertEquals(row.referenceId, 'TOKEN_9');
  assert(row.id.startsWith('site:tickets:'));
});

// ---------------------------------------------------------------------------
// Search, filter, sort, totals
// ---------------------------------------------------------------------------

Deno.test('search terms may land in different fields of the same row', () => {
  const rows = [normalizeOrder(order(), EMPTY)];
  attachSiteMatches(rows, [record()]);
  // "dana" is the buyer, "emily" is the item. Requiring both in one field
  // would make the natural way to search fail.
  assertEquals(filterRows(rows, { q: 'dana emily' }).length, 1);
  assertEquals(filterRows(rows, { q: 'dana bogart' }).length, 0);
});

Deno.test('search finds a row by the ids someone would have in hand', () => {
  const rows = [normalizeOrder(order({ reference_id: 'TOKEN_1' }), EMPTY)];
  attachSiteMatches(rows, [record()]);
  for (const q of ['ORDER_1', 'PAY_1', 'TOKEN_1', 'TICKET_B', '4242']) {
    assertEquals(filterRows(rows, { q }).length, 1, `expected a hit for ${q}`);
  }
});

Deno.test('filters narrow, and an empty filter list means no filter', () => {
  const rows = [
    normalizeOrder(order(), EMPTY),
    normalizeOrder(
      order({ id: 'O2', source: { name: 'Square Online' }, tenders: [{ id: 'T', type: 'CASH', amount_money: { amount: 500 } }] }),
      EMPTY,
    ),
  ];
  assertEquals(filterRows(rows, {}).length, 2);
  assertEquals(filterRows(rows, { sources: [] }).length, 2);
  assertEquals(filterRows(rows, { sources: ['Square Online'] }).length, 1);
  assertEquals(filterRows(rows, { tenders: ['CASH'] }).length, 1);
  assertEquals(filterRows(rows, { reconciliation: ['site_only'] }).length, 0);
});

Deno.test('facets come from the whole range, not the filtered page', () => {
  // Facets that narrowed with the results would drop the option you just
  // deselected, leaving no way back without clearing the filter.
  const rows = [
    normalizeOrder(order(), EMPTY),
    normalizeOrder(order({ id: 'O2', source: { name: 'Square Online' } }), EMPTY),
  ];
  const facets = buildFacets(rows);
  assertEquals(facets.sources, ['Square Online', POS_SOURCE].sort());
  assertEquals(facets.statuses, ['Completed']);
});

Deno.test('sorting by amount and by date', () => {
  const rows = [
    normalizeOrder(order({ id: 'A', created_at: '2026-08-01T00:00:00Z', total_money: { amount: 100 } }), EMPTY),
    normalizeOrder(order({ id: 'B', created_at: '2026-08-03T00:00:00Z', total_money: { amount: 900 } }), EMPTY),
  ];
  assertEquals(sortRows(rows, 'date_desc')[0].id, 'B');
  assertEquals(sortRows(rows, 'date_asc')[0].id, 'A');
  assertEquals(sortRows(rows, 'amount_desc')[0].id, 'B');
  assertEquals(sortRows(rows, 'amount_asc')[0].id, 'A');
});

Deno.test('totals exclude site-only rows from the money but count them', () => {
  // A sale Square has no record of is not revenue the bank saw. Adding it to a
  // total would report income that does not exist — while still needing to be
  // visible as a row.
  const rows = [normalizeOrder(order(), EMPTY), ...siteOnlyRows([record({ totalCents: 5000 })])];
  const totals = totalsFor(rows);
  assertEquals(totals.count, 2);
  assertEquals(totals.grossCents, 1696);
  assertEquals(totals.taxCents, 96);
  assertEquals(totals.netCents, 1696);
});

Deno.test('net is gross less refunds', () => {
  const rows = [
    normalizeOrder(order({ refunds: [{ id: 'R', amount_money: { amount: 696 }, status: 'APPROVED' }] }), EMPTY),
  ];
  const totals = totalsFor(rows);
  assertEquals(totals.grossCents, 1696);
  assertEquals(totals.refundedCents, 696);
  assertEquals(totals.netCents, 1000);
});

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-08-22T12:00:00Z');
const ok = (r: ReturnType<typeof resolveTransactionRange>) => {
  assertFalse('error' in r, `expected a range, got ${JSON.stringify(r)}`);
  return r as Exclude<typeof r, { error: string }>;
};

Deno.test('a range spans whole venue-local days, both ends inclusive', () => {
  // Two bugs in one assertion. The end must cover the WHOLE of the last day —
  // ending at midnight silently drops every sale made on the 31st. And the
  // boundaries are the theatre's midnight, not UTC's: in August, Pacific is
  // UTC-7, so the day starts at 07:00Z.
  const range = ok(resolveTransactionRange('2026-08-01', '2026-08-31', NOW));
  assertEquals(range.startDate, '2026-08-01');
  assertEquals(range.endDate, '2026-08-31');
  assertEquals(range.startAt, '2026-08-01T07:00:00.000Z');
  assertEquals(range.endAt, '2026-09-01T06:59:59.999Z');
});

Deno.test('a winter range uses the winter offset', () => {
  // Pacific is UTC-8 in January. A fixed offset would put the boundary an hour
  // out for half the year — one evening's screenings landing in the wrong day.
  const range = ok(resolveTransactionRange('2026-01-01', '2026-01-31', NOW));
  assertEquals(range.startAt, '2026-01-01T08:00:00.000Z');
  assertEquals(range.endAt, '2026-02-01T07:59:59.999Z');
});

Deno.test('a range crossing the DST change stays aligned at both ends', () => {
  // The two days a year a single-pass offset lookup gets wrong.
  const range = ok(resolveTransactionRange('2026-03-01', '2026-03-31', NOW));
  assertEquals(range.startAt, '2026-03-01T08:00:00.000Z'); // before the change
  assertEquals(range.endAt, '2026-04-01T06:59:59.999Z'); // after it
});

Deno.test('no dates means the last 30 venue days, inclusive of today', () => {
  // The same convention as _shared/square-reporting.ts, so the Transactions
  // tab and the Overview describe the same window by the same name.
  const range = ok(resolveTransactionRange(undefined, undefined, NOW));
  assertEquals(range.endDate, '2026-08-22');
  assertEquals(range.startDate, '2026-07-24');
});

Deno.test('a reversed, unparseable or over-long range is refused', () => {
  assert('error' in resolveTransactionRange('2026-08-31', '2026-08-01', NOW));
  assert('error' in resolveTransactionRange('not-a-date', '2026-08-01', NOW));
  assert('error' in resolveTransactionRange('2020-01-01', '2026-08-01', NOW));
});

Deno.test(`a full ${MAX_RANGE_DAYS} days is still allowed`, () => {
  const start = venueDate(new Date(NOW - (MAX_RANGE_DAYS - 1) * 86400_000));
  const end = venueDate(new Date(NOW));
  assertFalse('error' in resolveTransactionRange(start, end, NOW));
});

Deno.test('venueDayStart returns the theatre midnight, not the UTC one', () => {
  assertEquals(venueDayStart('2026-08-01').toISOString(), '2026-08-01T07:00:00.000Z');
  assertEquals(venueDayStart('2026-12-01').toISOString(), '2026-12-01T08:00:00.000Z');
});
