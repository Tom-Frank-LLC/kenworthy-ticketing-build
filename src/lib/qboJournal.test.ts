import { describe, expect, it } from 'vitest';
import { type Journal, journalCsv, journalIif, previousMonth } from './qboJournal';

const j: Journal = {
  range: { start: '2026-10-01', end: '2026-10-31' },
  sources: [],
  lines: [
    { accountId: 'film', code: '4710', name: 'Film Ticket Sales', accountType: 'income', debitCents: 0, creditCents: 95000, memo: '6 Film Tickets' },
    { accountId: 'ret', code: '4690', name: 'Returns', accountType: 'contra_income', debitCents: 2000, creditCents: 0, memo: 'Square returns' },
    { accountId: null, code: 'UNMAPPED', name: 'UNMAPPED — Theater, "Main" Rental', accountType: 'income', debitCents: 0, creditCents: 40000, memo: 'x' },
    { accountId: null, code: '', name: 'Undeposited Funds', accountType: 'asset', debitCents: 133000, creditCents: 0, memo: 'Square total collected' },
  ],
  totals: { grossCents: 0, discountCents: 0, compsCents: 0, returnsCents: 0, taxCents: 0, tipsCents: 0, collectedCents: 133000, squareNetSalesCents: 0, orders: 0, unreconciledCents: 0, sales: { grossCents: 0, discountsCents: 0, compsCents: 0, itemizedReturnsCents: 0, refundsByAmountCents: 0, serviceChargesCents: 0, giftCardSalesCents: 0 } },
  unmapped: 1,
  truncated: false,
};

describe('journal CSV', () => {
  it('writes debits and credits in dollars, one row per line, quoting what needs it', () => {
    const rows = journalCsv(j).split('\n');
    expect(rows[0]).toBe('Date Range,QBO Account,Account Code,Account Type,Debit,Credit,Memo');
    expect(rows[1]).toBe('2026-10-01 to 2026-10-31,Film Ticket Sales,4710,income,,950.00,6 Film Tickets');
    expect(rows[2]).toContain(',20.00,,');
    expect(rows[3]).toContain('"UNMAPPED — Theater, ""Main"" Rental"');
    expect(rows).toHaveLength(5);
  });
});

describe('journal IIF', () => {
  it('leads with the deposit and sums to zero', () => {
    const rows = journalIif(j).split('\n');
    expect(rows[3].split('\t').slice(0, 6)).toEqual(['TRNS', '', 'GENERAL JOURNAL', '10/31/2026', 'Undeposited Funds', '1330.00']);
    const amounts = rows.filter(r => /^(TRNS|SPL)\t/.test(r)).map(r => Number(r.split('\t')[5]));
    expect(amounts.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6);
    expect(rows[rows.length - 1]).toBe('ENDTRNS');
  });
});

describe('previousMonth', () => {
  it('is the last full calendar month, across a year boundary too', () => {
    expect(previousMonth(new Date(2026, 10, 3))).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(previousMonth(new Date(2027, 0, 15))).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(previousMonth(new Date(2028, 2, 1))).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });
});
