import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildJournal,
  journalCategoryQuery,
  journalTotalsQuery,
  journalUncategorizedQuery,
  UNCATEGORIZED,
} from './square-journal.ts';

const range = { start: '2026-10-01', end: '2026-10-31' };

const row = (dim: 'category_name' | 'item_name', key: string, gross: number, discount = 0, returns = 0, qty = 1) => ({
  [`ItemTransactions.${dim}`]: key,
  'ItemTransactions.sales_gross_amount': gross,
  // Square reports discounts and returns as negative dollars.
  'ItemTransactions.item_discount_money': -discount,
  'ItemTransactions.returns_gross_amount': -returns,
  'ItemTransactions.sales_net_amount': gross - discount - returns,
  'ItemTransactions.items_sold_count': qty,
});

const accounts = [
  { id: 'film', code: '4710', qbo_account_name: 'Film Ticket Sales', account_type: 'income' },
  { id: 'conc', code: '4410', qbo_account_name: 'Concessions', account_type: 'income' },
  { id: 'rent', code: '4310', qbo_account_name: 'A Rentals - General', account_type: 'income' },
  { id: 'tax', code: '4810', qbo_account_name: 'Sales Tax Collected', account_type: 'income' },
  { id: 'tip', code: '4820', qbo_account_name: 'Tips', account_type: 'income' },
  { id: 'ret', code: '4690', qbo_account_name: 'Returns', account_type: 'contra_income' },
];
const base = [
  { source_type: 'square_category', source_key: '6 Film Tickets', account_id: 'film' },
  { source_type: 'square_category', source_key: '5 Popcorn', account_id: 'conc' },
  { source_type: 'square_category', source_key: '2 Candy', account_id: 'conc' },
  { source_type: 'sales_tax', source_key: 'collected', account_id: 'tax' },
  { source_type: 'tip', source_key: '_all', account_id: 'tip' },
  { source_type: 'refund', source_key: '_all', account_id: 'ret' },
];

// gross 1000 + 300 + 200 + 500(uncat) = 2000; discounts 50; returns 20;
// tax 117, tips 40 -> collected 2000 - 50 - 20 + 117 + 40 = 2087.
const categoryRows = [
  row('category_name', '6 Film Tickets', 1000, 50, 20),
  row('category_name', '5 Popcorn', 300),
  row('category_name', '2 Candy', 200),
  row('category_name', UNCATEGORIZED, 500),
];
const uncategorizedRows = [row('item_name', 'Theater Rental', 400), row('item_name', 'Fall Fundraiser Ticket', 60)];
const totals = (collected: number) => [{
  'Sales.total_collected_amount': collected,
  'Sales.net_sales': 1930,
  'Sales.sales_tax_amount': 117,
  'Sales.tips_amount': 40,
  'Sales.order_count': 321,
}];

const sum = (j: ReturnType<typeof buildJournal>, k: 'debitCents' | 'creditCents') =>
  j.lines.reduce((n, l) => n + l[k], 0);

Deno.test('the entry balances, and closes with no review line when Square closes', () => {
  const j = buildJournal({ range, totalsRows: totals(2087), categoryRows, uncategorizedRows, mappings: base, accounts });
  assertEquals(sum(j, 'debitCents'), sum(j, 'creditCents'));
  assertEquals(j.totals.unreconciledCents, 0);
  assertEquals(j.lines.some(l => l.code === 'REVIEW'), false);
  assertEquals(j.lines.find(l => l.name === 'Undeposited Funds')?.debitCents, 208700);
});

Deno.test('income is net of discounts; returns, tax and tips get their own lines', () => {
  const j = buildJournal({ range, totalsRows: totals(2087), categoryRows, uncategorizedRows, mappings: base, accounts });
  const by = (code: string) => j.lines.find(l => l.code === code)!;
  assertEquals(by('4710').creditCents, 95000);
  assertEquals(by('4410').creditCents, 50000); // popcorn + candy, one line
  assertEquals(by('4690').debitCents, 2000);
  assertEquals(by('4810').creditCents, 11700);
  assertEquals(by('4820').creditCents, 4000);
});

Deno.test('a difference Square does not close is shown, never absorbed', () => {
  // $25 of gift card sales: collected, but not an item sale.
  const j = buildJournal({ range, totalsRows: totals(2112), categoryRows, uncategorizedRows, mappings: base, accounts });
  const review = j.lines.find(l => l.code === 'REVIEW')!;
  assertEquals(review.creditCents, 2500);
  assertEquals(j.totals.unreconciledCents, -2500);
  assertEquals(sum(j, 'debitCents'), sum(j, 'creditCents'));
});

Deno.test('Uncategorized is split by item, and the un-itemised rest is kept', () => {
  const mappings = [...base, { source_type: 'square_item', source_key: 'Theater Rental', account_id: 'rent' }];
  const j = buildJournal({ range, totalsRows: totals(2087), categoryRows, uncategorizedRows, mappings, accounts });
  assertEquals(j.lines.find(l => l.code === '4310')?.creditCents, 40000);
  const fundraiser = j.sources.find(s => s.key === 'Fall Fundraiser Ticket')!;
  assertEquals(fundraiser.accountId, null);
  const rest = j.sources.find(s => s.key === 'Uncategorized (not itemised)')!;
  assertEquals(rest.grossCents, 4000);
  // Every cent of the category is somewhere in the entry.
  assertEquals(sum(j, 'debitCents'), sum(j, 'creditCents'));
});

Deno.test('an item with no mapping of its own falls back to Uncategorized', () => {
  const mappings = [...base, { source_type: 'square_category', source_key: UNCATEGORIZED, account_id: 'rent' }];
  const j = buildJournal({ range, totalsRows: totals(2087), categoryRows, uncategorizedRows, mappings, accounts });
  const s = j.sources.find(s => s.key === 'Fall Fundraiser Ticket')!;
  assertEquals([s.accountId, s.mappedBy], ['rent', 'square_category']);
  assertEquals(j.unmapped, 0);
});

Deno.test('each unmapped source gets its own named line, not one anonymous total', () => {
  const j = buildJournal({ range, totalsRows: totals(2087), categoryRows, uncategorizedRows, mappings: base, accounts });
  const names = j.lines.filter(l => l.code === 'UNMAPPED').map(l => l.name).sort();
  assertEquals(names, [
    'UNMAPPED — Uncategorized (not itemised)',
    'UNMAPPED — Uncategorized · Fall Fundraiser Ticket',
    'UNMAPPED — Uncategorized · Theater Rental',
  ]);
  assertEquals(j.unmapped, 3);
});

Deno.test('a category Square has never had a mapping for is unmapped, not defaulted', () => {
  const rows = [...categoryRows, row('category_name', '7 Merch', 80)];
  const j = buildJournal({ range, totalsRows: totals(2167), categoryRows: rows, uncategorizedRows, mappings: base, accounts });
  assertEquals(j.sources.find(s => s.key === '7 Merch')?.accountId, null);
});

Deno.test('an empty range is an empty, balanced entry', () => {
  const j = buildJournal({ range, totalsRows: [], categoryRows: [], uncategorizedRows: [], mappings: base, accounts });
  assertEquals(j.sources, []);
  assertEquals(sum(j, 'debitCents'), 0);
  assertEquals(sum(j, 'creditCents'), 0);
});

Deno.test('item queries count only paid lines', () => {
  for (const q of [journalCategoryQuery(range), journalUncategorizedQuery(range)]) {
    const f = q.filters?.find(f => f.member === 'ItemTransactions.revenue_recognition_state');
    assertEquals(f?.values, ['RECOGNIZED']);
  }
});

Deno.test('service charges are their own credit, so a surcharged invoice closes', () => {
  const mappings = [...base, { source_type: 'service_charge', source_key: '_all', account_id: 'rent' }];
  const t = [{ ...totals(2087 + 30)[0], 'Sales.service_charges_only_sum': 30 }];
  const j = buildJournal({ range, totalsRows: t, categoryRows, uncategorizedRows, mappings, accounts });
  assertEquals(j.totals.unreconciledCents, 0);
  assertEquals(j.lines.find(l => l.memo.includes('service charges'))?.creditCents, 3000);
});

Deno.test('the journal queries carry the range and never send `order`', () => {
  for (const q of [journalCategoryQuery(range), journalUncategorizedQuery(range), journalTotalsQuery(range)]) {
    assertEquals(q.timeDimensions?.[0].dateRange, ['2026-10-01', '2026-10-31']);
    assertEquals('order' in q, false);
    // One row per category or item for the whole range: no day buckets.
    assertEquals(q.timeDimensions?.[0].granularity, undefined);
  }
});

Deno.test('comps come off income like discounts, and a same-named category and item stay apart', () => {
  const comped = { ...row('category_name', '6 Film Tickets', 1000), 'ItemTransactions.item_comps_money': -100 };
  const rows = [comped, row('category_name', 'Film Sponsorship', 300), row('category_name', UNCATEGORIZED, 200)];
  const items = [row('item_name', 'Film Sponsorship', 200)];
  // 1000 - 100 + 300 + 200 + tax 117 + tips 40
  const j = buildJournal({ range, totalsRows: totals(1557), categoryRows: rows, uncategorizedRows: items, mappings: base, accounts });
  assertEquals(j.lines.find(l => l.code === '4710')?.creditCents, 90000);
  assertEquals(j.totals.compsCents, 10000);
  assertEquals(j.totals.unreconciledCents, 0);
  const sponsorship = j.lines.filter(l => l.name.includes('Film Sponsorship')).map(l => l.creditCents).sort();
  assertEquals(sponsorship, [20000, 30000]);
});
