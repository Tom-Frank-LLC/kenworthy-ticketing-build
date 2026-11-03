// The QuickBooks journal for a date range, from Square's own reporting engine.
//
// Why this exists: the QBO Export used to add up this build's own tables
// (tickets, concession_sales, donations, passes, rental lines). Most of the
// theatre's money never touches those tables — the concession stand, Square
// Online, invoices and items keyed in at the till live only in Square — so the
// export came out far below both Square and the Overview (Nov 2026). It also
// read each table in one request, which PostgREST caps at 1,000 rows without an
// error, and cut months at UTC midnight.
//
// Every sale the build makes is also a Square order (card, cash via
// square-cash-sale, donations via square-donation, rentals via square-invoice),
// so Square is a complete source and the only one. Nothing here reads our
// tables for money; reading both would count the build's sales twice.
//
// Shape of the entry, one per range:
//
//   credit  each Square category's account   gross − discounts − comps
//   debit   Returns                          returns
//   credit  Sales Tax Collected              Square's tax
//   credit  Tips                             Square's tips
//   credit  Service charges                  Square's service charges
//   debit   Undeposited Funds                Square's total collected
//
// and, when Square's own figures do not close (gift card sales, partial
// refunds of tax and the like are not in the item cube), one
// line that makes the difference visible instead of quietly absorbing it.
//
// Pure: queries and shaping only. The caller runs the queries and supplies the
// mappings, so all of it is testable without Square or a database.

import { type CubeQuery, cents, RECOGNIZED_ONLY } from "./square-reporting.ts";

const ITEM_TIME = "ItemTransactions.local_reporting_timestamp";
const SALES_TIME = "Sales.local_reporting_timestamp";

/** Square's own label for items with no reporting category. */
export const UNCATEGORIZED = "Uncategorized";

/** The debit side. QuickBooks' built-in name; not a chart_of_accounts row. */
export const DEPOSIT_ACCOUNT = "Undeposited Funds";

const ITEM_MEASURES = [
  "ItemTransactions.sales_gross_amount",
  "ItemTransactions.item_discount_money",
  "ItemTransactions.item_comps_money",
  "ItemTransactions.returns_gross_amount",
  "ItemTransactions.sales_net_amount",
  "ItemTransactions.items_sold_count",
];

/** No time granularity: one row per category for the whole range. */
export function journalCategoryQuery(range: { start: string; end: string }): CubeQuery {
  return {
    measures: ITEM_MEASURES,
    dimensions: ["ItemTransactions.category_name"],
    timeDimensions: [{ dimension: ITEM_TIME, dateRange: [range.start, range.end] }],
    // Unpaid orders' lines are not income. See RECOGNIZED_ONLY.
    filters: [RECOGNIZED_ONLY],
    limit: 1000,
  };
}

/**
 * What is inside Uncategorized, item by item. Rentals and fundraiser tickets
 * keyed in at the till land here, so a single Uncategorized account would book
 * a theatre rental and a banquet seat to the same line.
 */
export const JOURNAL_ITEM_LIMIT = 1000;
export function journalUncategorizedQuery(range: { start: string; end: string }): CubeQuery {
  return {
    measures: ITEM_MEASURES,
    dimensions: ["ItemTransactions.item_name"],
    timeDimensions: [{ dimension: ITEM_TIME, dateRange: [range.start, range.end] }],
    filters: [
      { member: "ItemTransactions.category_name", operator: "equals", values: [UNCATEGORIZED] },
      RECOGNIZED_ONLY,
    ],
    limit: JOURNAL_ITEM_LIMIT,
  };
}

export function journalTotalsQuery(range: { start: string; end: string }): CubeQuery {
  return {
    measures: [
      "Sales.total_collected_amount",
      "Sales.net_sales",
      "Sales.sales_tax_amount",
      "Sales.tips_amount",
      "Sales.order_count",
      // Read for reconciliation only: what Square's own Sales Summary says the
      // item cube should add up to. Names measured from /reporting/v1/meta on
      // 3 Nov 2026 (see FINDINGS-qbo-export-from-square.md).
      "Sales.top_line_product_sales",
      "Sales.discounts_amount",
      "Sales.comps_amount",
      "Sales.itemized_returns",
      "Sales.refunds_by_amount_amount",
      "Sales.service_charges_only_sum",
      "Sales.gift_card_sales_amount",
    ],
    timeDimensions: [{ dimension: SALES_TIME, dateRange: [range.start, range.end] }],
  };
}

export interface Mapping { source_type: string; source_key: string; account_id: string }
export interface Account { id: string; code: string; qbo_account_name: string; account_type: string }

/** One Square category, or one item within Uncategorized. */
export interface JournalSource {
  kind: "category" | "item";
  key: string;
  grossCents: number;
  discountCents: number;
  /** A comp is a 100% discount; Square reports it apart from discounts. */
  compsCents: number;
  returnsCents: number;
  /** Square's own net, carried for reconciliation; not used in the entry. */
  netCents: number;
  quantity: number;
  /** null = unmapped. */
  accountId: string | null;
  /** Which mapping supplied the account, so the screen can say why. */
  mappedBy: "square_category" | "square_item" | null;
}

export interface JournalLine {
  accountId: string | null;
  code: string;
  name: string;
  accountType: string;
  debitCents: number;
  creditCents: number;
  memo: string;
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
    /** credits − debits before the review line: (gross − discounts − comps + tax + tips + service charges) − (returns + collected). 0 when Square closes. */
    unreconciledCents: number;
    /** Square's Sales Summary figures, for explaining a non-zero unreconciled. */
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

const mag = (v: unknown) => Math.abs(cents(v));

function readSource(row: any, kind: JournalSource["kind"], key: string): JournalSource {
  return {
    kind,
    key,
    grossCents: cents(row?.["ItemTransactions.sales_gross_amount"]),
    discountCents: mag(row?.["ItemTransactions.item_discount_money"]),
    compsCents: mag(row?.["ItemTransactions.item_comps_money"]),
    returnsCents: mag(row?.["ItemTransactions.returns_gross_amount"]),
    netCents: cents(row?.["ItemTransactions.sales_net_amount"]),
    quantity: Number(row?.["ItemTransactions.items_sold_count"]) || 0,
    accountId: null,
    mappedBy: null,
  };
}

const isEmpty = (s: JournalSource) =>
  s.grossCents === 0 && s.discountCents === 0 && s.compsCents === 0 && s.returnsCents === 0;

export function buildJournal(input: {
  range: { start: string; end: string };
  totalsRows: any[];
  categoryRows: any[];
  uncategorizedRows: any[];
  mappings: Mapping[];
  accounts: Account[];
}): Journal {
  const { range, totalsRows, categoryRows, uncategorizedRows, mappings, accounts } = input;

  const find = (type: string, key: string) =>
    mappings.find((m) => m.source_type === type && m.source_key === key)?.account_id ?? null;
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const sources: JournalSource[] = [];
  let uncategorizedRow: any = null;
  for (const row of categoryRows ?? []) {
    const name = row?.["ItemTransactions.category_name"] ?? UNCATEGORIZED;
    if (name === UNCATEGORIZED) { uncategorizedRow = row; continue; }
    const s = readSource(row, "category", name);
    s.accountId = find("square_category", name);
    s.mappedBy = s.accountId ? "square_category" : null;
    sources.push(s);
  }

  // Uncategorized, item by item. An item mapping wins; otherwise the item falls
  // back to whatever Uncategorized itself is mapped to.
  const uncategorizedAccount = find("square_category", UNCATEGORIZED);
  const items = (uncategorizedRows ?? []).map((row) =>
    readSource(row, "item", row?.["ItemTransactions.item_name"] ?? "(unnamed)")
  );
  for (const s of items) {
    const byItem = find("square_item", s.key);
    s.accountId = byItem ?? uncategorizedAccount;
    s.mappedBy = byItem ? "square_item" : uncategorizedAccount ? "square_category" : null;
    sources.push(s);
  }
  // The category row is Square's authority for the bucket's size. Whatever the
  // item rows do not account for (a truncated list, an unnamed custom amount)
  // is kept as its own line rather than dropped.
  if (uncategorizedRow) {
    const whole = readSource(uncategorizedRow, "category", UNCATEGORIZED);
    const rest: JournalSource = {
      ...whole,
      key: `${UNCATEGORIZED} (not itemised)`,
      grossCents: whole.grossCents - items.reduce((n, s) => n + s.grossCents, 0),
      discountCents: whole.discountCents - items.reduce((n, s) => n + s.discountCents, 0),
      compsCents: whole.compsCents - items.reduce((n, s) => n + s.compsCents, 0),
      returnsCents: whole.returnsCents - items.reduce((n, s) => n + s.returnsCents, 0),
      netCents: whole.netCents - items.reduce((n, s) => n + s.netCents, 0),
      quantity: whole.quantity - items.reduce((n, s) => n + s.quantity, 0),
      accountId: uncategorizedAccount,
      mappedBy: uncategorizedAccount ? "square_category" : null,
    };
    if (!isEmpty(rest)) sources.push(rest);
  }

  const kept = sources.filter((s) => !isEmpty(s))
    .sort((a, b) => b.grossCents - a.grossCents);

  // --- lines, one per account -------------------------------------------------
  const lines = new Map<string, JournalLine>();
  const line = (accountId: string | null, fallbackName: string, memoKey: string) => {
    const key = accountId ?? `__UNMAPPED__:${memoKey}`;
    let l = lines.get(key);
    if (!l) {
      const a = accountId ? accountById.get(accountId) : undefined;
      l = {
        accountId: a ? accountId : null,
        code: a?.code ?? "UNMAPPED",
        name: a?.qbo_account_name ?? fallbackName,
        accountType: a?.account_type ?? "income",
        debitCents: 0,
        creditCents: 0,
        memo: "",
      };
      lines.set(key, l);
    }
    return l;
  };
  const memoParts = new Map<JournalLine, string[]>();
  const note = (l: JournalLine, s: string) => {
    const parts = memoParts.get(l) ?? [];
    parts.push(s);
    memoParts.set(l, parts);
  };

  let grossCents = 0, discountCents = 0, compsCents = 0, returnsCents = 0, squareNet = 0;
  for (const s of kept) {
    grossCents += s.grossCents;
    discountCents += s.discountCents;
    compsCents += s.compsCents;
    returnsCents += s.returnsCents;
    squareNet += s.netCents;
    // An unmapped source gets its own line, named for itself, so the CSV says
    // exactly what needs mapping instead of one anonymous UNMAPPED total.
    // Keyed by kind too: a category and an Uncategorized item can share a name
    // ("Film Sponsorship" is both) and need separate decisions.
    const l = line(s.accountId, `UNMAPPED — ${s.kind === "item" ? "Uncategorized · " : ""}${s.key}`, `${s.kind}:${s.key}`);
    l.creditCents += s.grossCents - s.discountCents - s.compsCents;
    note(l, s.key);
  }

  const t = totalsRows?.[0] ?? {};
  const taxCents = cents(t["Sales.sales_tax_amount"]);
  const tipsCents = cents(t["Sales.tips_amount"]);
  const collectedCents = cents(t["Sales.total_collected_amount"]);

  if (returnsCents) {
    const l = line(find("refund", "_all"), "UNMAPPED — Returns", "Returns");
    l.debitCents += returnsCents;
    note(l, "Square returns");
  }
  if (taxCents) {
    const l = line(find("sales_tax", "collected"), "UNMAPPED — Sales tax", "Sales tax");
    l.creditCents += taxCents;
    note(l, "Square sales tax");
  }
  // Invoice surcharges (about 3% on rental invoices). Collected money that is
  // not an item sale, so without its own line it reads as unreconciled.
  const serviceCents = cents(t["Sales.service_charges_only_sum"]);
  if (serviceCents) {
    const l = line(find("service_charge", "_all"), "UNMAPPED — Service charges", "Service charges");
    l.creditCents += serviceCents;
    note(l, "Square service charges (invoice surcharges)");
  }
  if (tipsCents) {
    const l = line(find("tip", "_all"), "UNMAPPED — Tips", "Tips");
    l.creditCents += tipsCents;
    note(l, "Square tips");
  }

  const deposit: JournalLine = {
    accountId: null, code: "", name: DEPOSIT_ACCOUNT, accountType: "asset",
    debitCents: collectedCents, creditCents: 0, memo: "Square total collected",
  };

  const out = [...lines.values()].sort((a, b) => a.code.localeCompare(b.code));
  for (const l of out) l.memo = (memoParts.get(l) ?? []).join("; ");

  const credits = out.reduce((n, l) => n + l.creditCents, 0);
  const debits = out.reduce((n, l) => n + l.debitCents, 0) + collectedCents;
  const unreconciledCents = credits - debits; // >0: more income than money in
  out.push(deposit);
  if (unreconciledCents !== 0) {
    out.push({
      accountId: null,
      code: "REVIEW",
      name: "Unreconciled — review before posting",
      accountType: "suspense",
      debitCents: unreconciledCents > 0 ? unreconciledCents : 0,
      creditCents: unreconciledCents < 0 ? -unreconciledCents : 0,
      memo: "Square's total collected does not equal its item sales + tax + tips − returns for this range",
    });
  }

  return {
    range,
    sources: kept,
    lines: out,
    totals: {
      grossCents,
      discountCents,
      compsCents,
      returnsCents,
      taxCents,
      tipsCents,
      collectedCents,
      squareNetSalesCents: cents(t["Sales.net_sales"]),
      orders: Number(t["Sales.order_count"]) || 0,
      unreconciledCents,
      sales: {
        grossCents: cents(t["Sales.top_line_product_sales"]),
        discountsCents: mag(t["Sales.discounts_amount"]),
        compsCents: mag(t["Sales.comps_amount"]),
        itemizedReturnsCents: mag(t["Sales.itemized_returns"]),
        refundsByAmountCents: mag(t["Sales.refunds_by_amount_amount"]),
        serviceChargesCents: cents(t["Sales.service_charges_only_sum"]),
        giftCardSalesCents: cents(t["Sales.gift_card_sales_amount"]),
      },
    },
    unmapped: kept.filter((s) => !s.accountId).length,
    truncated: (uncategorizedRows?.length ?? 0) >= JOURNAL_ITEM_LIMIT,
  };
}
