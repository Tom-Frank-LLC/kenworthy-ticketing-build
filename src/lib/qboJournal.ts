// The QBO Export's file formats, from the journal square-analytics returns
// (mode "journal"; see supabase/functions/_shared/square-journal.ts).
//
// Pure, so the files the accountant imports are tested without a browser.
// Money arrives in cents and leaves as dollars with two decimals.

export interface JournalLine {
  accountId: string | null;
  code: string;
  name: string;
  accountType: string;
  debitCents: number;
  creditCents: number;
  memo: string;
}

export interface JournalSource {
  kind: 'category' | 'item';
  key: string;
  grossCents: number;
  discountCents: number;
  compsCents: number;
  returnsCents: number;
  netCents: number;
  quantity: number;
  accountId: string | null;
  mappedBy: 'square_category' | 'square_item' | null;
}

export interface Journal {
  range: { start: string; end: string };
  sources: JournalSource[];
  lines: JournalLine[];
  totals: {
    grossCents: number;
    discountCents: number;
    compsCents: number;
    returnsCents: number;
    taxCents: number;
    tipsCents: number;
    collectedCents: number;
    squareNetSalesCents: number;
    orders: number;
    unreconciledCents: number;
    sales: {
      grossCents: number;
      discountsCents: number;
      compsCents: number;
      itemizedReturnsCents: number;
      refundsByAmountCents: number;
      serviceChargesCents: number;
      giftCardSalesCents: number;
    };
  };
  unmapped: number;
  truncated: boolean;
}

export const toDollars = (c: number) => (c / 100).toFixed(2);

function csvEscape(v: unknown) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per account. Debits and credits total the same, review line included. */
export function journalCsv(j: Journal): string {
  const header = ['Date Range', 'QBO Account', 'Account Code', 'Account Type', 'Debit', 'Credit', 'Memo'];
  const range = `${j.range.start} to ${j.range.end}`;
  const rows = j.lines.map(l => [
    range,
    l.name,
    l.code,
    l.accountType,
    l.debitCents ? toDollars(l.debitCents) : '',
    l.creditCents ? toDollars(l.creditCents) : '',
    l.memo,
  ]);
  return [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
}

/**
 * IIF general journal. The deposit line is the TRNS; every other line is a SPL
 * signed debit-positive, so the transaction sums to zero as IIF requires.
 */
export function journalIif(j: Journal): string {
  const [y, m, d] = j.range.end.split('-');
  const date = `${m}/${d}/${y}`;
  const tsv = (cells: string[]) => cells.map(c => c.replace(/[\t\n]/g, ' ')).join('\t');
  const deposit = j.lines.find(l => l.accountType === 'asset');
  const rest = j.lines.filter(l => l !== deposit);
  const signed = (l: JournalLine) => toDollars(l.debitCents - l.creditCents);
  const out = [
    '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO',
    '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO',
    '!ENDTRNS',
  ];
  if (deposit) {
    out.push(tsv(['TRNS', '', 'GENERAL JOURNAL', date, deposit.name, signed(deposit), `Kenworthy Square ${j.range.start} to ${j.range.end}`]));
  }
  for (const l of rest) out.push(tsv(['SPL', '', 'GENERAL JOURNAL', date, l.name, signed(l), l.memo]));
  out.push('ENDTRNS');
  return out.join('\n');
}

/** The last full calendar month before `now`, as YYYY-MM-DD dates. */
export function previousMonth(now: Date): { start: string; end: string } {
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: iso(first), end: iso(last) };
}
