// Turning Square orders into a transaction log our admin can search.
//
// The theatre's ledger is Square's, not ours. 99.7% of its line items are
// catalogued, and of ~5,000 recent orders exactly ONE came through this build
// (docs/SQUARE-TRANSACTION-CONVENTIONS.md). So a "transactions" screen sourced
// from `tickets` would show one row and call it the theatre's sales history.
// Square is the primary source here; our tables are what gets joined ONTO it.
//
// The join runs both ways, and the second direction is the useful one:
//
//   Square order  -> our rows   via reference_id = order_token, and via
//                                tender.payment_id = square_payment_id
//   our rows      -> Square     the same keys, read from the other side
//
// A Square order with no site row is normal (POS, Square Online). A *site* row
// that should be in Square and isn't is a fault — the patron was charged by a
// path that never registered, or was never charged at all. That asymmetry is
// why `reconciliation` exists as a field rather than a boolean.
//
// Everything in this module is pure: it takes already-fetched Square orders and
// already-fetched DB rows and returns rows, facets and counts. The fetching,
// the auth and the caching live in ../square-transactions/index.ts, so the
// matching rules — the part with judgement in it — can be tested without a
// Square token or a database.

import { VENUE_TZ, venueDate } from './square-reporting.ts';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Square money is always integer minor units. Never build one from a float. */
type Cents = number;

export interface TenderSummary {
  type: string;
  amountCents: Cents;
  tipCents: Cents;
  paymentId: string | null;
  cardBrand: string | null;
  last4: string | null;
  /** When the money was actually taken. See `collectedAt` on the row. */
  createdAt: string | null;
}

export interface LineSummary {
  name: string;
  variationName: string | null;
  quantity: string;
  catalogObjectId: string | null;
  /** Resolved from the catalog when we could; null for archived/ad-hoc items. */
  category: string | null;
  grossCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

export interface RefundSummary {
  id: string;
  amountCents: Cents;
  status: string;
  reason: string | null;
  createdAt: string | null;
}

/**
 * How a Square order and our own records line up.
 *
 * `square_only` is the overwhelmingly common case and is NOT a problem — it is
 * every POS and Square Online sale the theatre has ever made. Only `site_only`
 * is a fault by construction.
 */
export type Reconciliation = 'matched' | 'square_only' | 'site_only';

export interface SiteMatch {
  /** Which of our tables the money landed in. */
  kind: 'tickets' | 'donation' | 'film_pass';
  orderToken: string | null;
  paymentMethod: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  /** Ticket ids, donation id, or film-pass order id — whatever we can link to. */
  recordIds: string[];
  showingId: string | null;
  showingLabel: string | null;
  /** Our own total, in cents, for comparison against Square's. */
  ourTotalCents: Cents | null;
}

export interface TransactionRow {
  /** Square order id, or for a site-only row, `site:<table>:<key>`. */
  id: string;
  /** When the order was rung up. This is what the range filters on. */
  createdAt: string;
  /**
   * When the money was actually taken — earliest tender, else `closed_at`.
   *
   * These are the same instant for a POS sale and can be weeks apart for an
   * invoice, which is created when it is drafted and paid whenever the customer
   * gets round to it. That difference is not cosmetic: it is the whole reason
   * this tab's totals and Square's own reports disagree over short windows.
   * Measured 23 Aug 2026 against the live account — order counts agree within
   * ~1% at every window length, but the money delta swings from −30% over 7
   * days to +17% for June alone and settles at +0.6% over 180 days. Money is
   * not missing; it is landing in a different bucket, because we range on
   * `created_at` and Square's Sales cube ranges on when it was collected.
   * See docs/briefs/FINDINGS-transactions-tab.md §8.
   */
  collectedAt: string | null;
  source: string;
  /**
   * Square's own order state — COMPLETED, OPEN, DRAFT, CANCELED.
   *
   * Carried on the row rather than filtered away at the query. See
   * `hasTender()` for why that distinction is load-bearing.
   */
  state: string;
  tenderTypes: string[];
  tenders: TenderSummary[];
  buyerName: string | null;
  buyerEmail: string | null;
  items: LineSummary[];
  itemsSummary: string;
  categories: string[];
  totalCents: Cents;
  taxCents: Cents;
  tipCents: Cents;
  discountCents: Cents;
  refundedCents: Cents;
  refunds: RefundSummary[];
  status: 'Completed' | 'Refunded' | 'Partially refunded';
  referenceId: string | null;
  receiptUrl: string | null;
  locationId: string | null;
  match: SiteMatch | null;
  reconciliation: Reconciliation;
}

/** A row of ours that should have a Square counterpart. */
export interface SiteRecord {
  kind: SiteMatch['kind'];
  /** `order_token` where the table has one. */
  orderToken: string | null;
  squarePaymentId: string | null;
  paymentMethod: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  recordIds: string[];
  showingId: string | null;
  showingLabel: string | null;
  totalCents: Cents | null;
  createdAt: string;
  receiptUrl: string | null;
}

/** variation id -> what the catalog says it is. Empty is fine; see below. */
export type CatalogIndex = Map<string, { itemName: string; category: string | null }>;

// ---------------------------------------------------------------------------
// Square order -> row
// ---------------------------------------------------------------------------

/** POS sales carry no `source.name` at all — 4,054 of ~5,000 recent orders. */
export const POS_SOURCE = 'Square Point of Sale';

const cents = (m: unknown): Cents => {
  const amount = (m as { amount?: unknown } | null)?.amount;
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
};

/**
 * A refund only counts against the sale once Square has actually approved it.
 *
 * PENDING is included deliberately: the money is on its way out and a screen
 * that showed the sale as fully Completed until settlement would tell staff a
 * refund they just issued had not happened.
 */
const REFUND_COUNTS = new Set(['APPROVED', 'PENDING', 'COMPLETED']);

export function normalizeOrder(order: any, catalog: CatalogIndex): TransactionRow {
  const tenders: TenderSummary[] = (order?.tenders ?? []).map((t: any) => ({
    type: typeof t?.type === 'string' ? t.type : 'OTHER',
    amountCents: cents(t?.amount_money),
    tipCents: cents(t?.tip_money),
    // `payment_id` is the key our tables store. Tender id is a fallback only.
    paymentId: t?.payment_id ?? t?.id ?? null,
    cardBrand: t?.card_details?.card?.card_brand ?? null,
    last4: t?.card_details?.card?.last_4 ?? null,
    createdAt: t?.created_at ?? null,
  }));

  const items: LineSummary[] = (order?.line_items ?? []).map((li: any) => {
    const catalogObjectId = li?.catalog_object_id ?? null;
    const known = catalogObjectId ? catalog.get(catalogObjectId) : undefined;
    return {
      // Prefer the catalog's item name: a line item's stored `name` is a
      // snapshot from sale time and drifts after a rename.
      name: known?.itemName || li?.name || 'Unnamed item',
      variationName: li?.variation_name ?? null,
      quantity: typeof li?.quantity === 'string' ? li.quantity : '1',
      catalogObjectId,
      category: known?.category ?? null,
      grossCents: cents(li?.gross_sales_money),
      taxCents: cents(li?.total_tax_money),
      totalCents: cents(li?.total_money),
    };
  });

  const refunds: RefundSummary[] = (order?.refunds ?? []).map((r: any) => ({
    id: r?.id ?? '',
    amountCents: cents(r?.amount_money),
    status: typeof r?.status === 'string' ? r.status : 'UNKNOWN',
    reason: r?.reason ?? null,
    createdAt: r?.created_at ?? null,
  }));

  const totalCents = cents(order?.total_money);
  const refundedCents = refunds
    .filter((r) => REFUND_COUNTS.has(r.status.toUpperCase()))
    .reduce((sum, r) => sum + r.amountCents, 0);

  const status: TransactionRow['status'] = refundedCents <= 0
    ? 'Completed'
    : refundedCents >= totalCents
    ? 'Refunded'
    : 'Partially refunded';

  const fulfillmentRecipient = firstRecipient(order?.fulfillments);

  return {
    id: order?.id ?? '',
    createdAt: order?.created_at ?? order?.closed_at ?? '',
    collectedAt: earliestTenderTime(tenders) ?? order?.closed_at ?? null,
    source: order?.source?.name?.trim() || POS_SOURCE,
    state: typeof order?.state === 'string' ? order.state : 'UNKNOWN',
    tenderTypes: [...new Set(tenders.map((t) => t.type))],
    tenders,
    // Only 26 of ~5,000 orders carry a customer, so Square is not a reliable
    // source of a buyer. The fulfillment recipient is what Square Online fills
    // in; the DB join in attachSiteMatches() overwrites this when it can.
    buyerName: fulfillmentRecipient?.display_name ?? null,
    buyerEmail: fulfillmentRecipient?.email_address ?? null,
    items,
    itemsSummary: summarizeItems(items),
    categories: [...new Set(items.map((i) => i.category).filter(Boolean) as string[])],
    totalCents,
    taxCents: cents(order?.total_tax_money),
    tipCents: cents(order?.total_tip_money),
    discountCents: cents(order?.total_discount_money),
    refundedCents,
    refunds,
    status,
    referenceId: order?.reference_id ?? null,
    receiptUrl: null,
    locationId: order?.location_id ?? null,
    match: null,
    reconciliation: 'square_only',
  };
}

/** The first time money moved on this order, or null if none of them say. */
function earliestTenderTime(tenders: TenderSummary[]): string | null {
  const times = tenders.map((t) => t.createdAt).filter(Boolean) as string[];
  return times.length > 0 ? times.reduce((a, b) => (a < b ? a : b)) : null;
}

function firstRecipient(fulfillments: any): { display_name?: string; email_address?: string } | null {
  for (const f of fulfillments ?? []) {
    const r = f?.pickup_details?.recipient ??
      f?.shipment_details?.recipient ??
      f?.delivery_details?.recipient;
    if (r?.display_name || r?.email_address) return r;
  }
  return null;
}

/**
 * Did money actually change hands on this order?
 *
 * THIS REPLACES `state_filter: ["COMPLETED"]`, DELIBERATELY.
 *
 * `docs/briefs/FINDINGS-square-reporting-api.md` measured the previous
 * analytics implementation at **35% below** Square's own figure for the same
 * window, and named `state_filter: ["COMPLETED"]` as suspect number one: the
 * account carries ~674 `OPEN` and ~221 `DRAFT` orders per ~5,000, and if `OPEN`
 * includes paid-but-unclosed checks then filtering on COMPLETED drops real
 * money. That was never confirmed — the analytics tab moved to the Reporting
 * API, which sidesteps the question rather than answering it.
 *
 * A transaction log cannot sidestep it: it needs the individual orders, and
 * `/v2/orders/search` is the only endpoint that returns them. So instead of
 * trusting a state, this asks the question the state was a proxy for — is there
 * a tender? A tender IS a payment. An abandoned cart has none, and a paid check
 * that nobody closed out has one whatever its state says.
 *
 * The state is still carried on every row, so a reader can see for themselves
 * that a sale was OPEN rather than have it silently included or silently
 * dropped.
 */
export function hasTender(order: any): boolean {
  return Array.isArray(order?.tenders) && order.tenders.length > 0;
}

/** "Adult - Sept 16 at 7 PM ×2 · Popcorn ×1" — enough to recognise a sale by. */
export function summarizeItems(items: LineSummary[]): string {
  if (items.length === 0) return '—';
  return items
    .map((i) => {
      const label = i.variationName ? `${i.name} · ${i.variationName}` : i.name;
      return i.quantity && i.quantity !== '1' ? `${label} ×${i.quantity}` : label;
    })
    .join(' · ');
}

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

/**
 * Attach our own records to the Square orders they paid for, and report which
 * of our records never found one.
 *
 * Matching is by payment id first and `reference_id` second. Payment id is the
 * stronger key — it is what Square itself returned to us at charge time — while
 * `reference_id` is a value we chose and sent, so it is only as good as the
 * write that set it. A row matched on either counts as matched.
 *
 * Returns the unmatched site records rather than throwing them away: they are
 * the entire point of the reconciliation view.
 */
export function attachSiteMatches(
  rows: TransactionRow[],
  records: SiteRecord[],
): { rows: TransactionRow[]; unmatched: SiteRecord[] } {
  const byPaymentId = new Map<string, TransactionRow>();
  const byReference = new Map<string, TransactionRow>();

  for (const row of rows) {
    for (const t of row.tenders) {
      if (t.paymentId) byPaymentId.set(t.paymentId, row);
    }
    if (row.referenceId) byReference.set(row.referenceId, row);
  }

  const unmatched: SiteRecord[] = [];

  for (const rec of records) {
    const hit = (rec.squarePaymentId && byPaymentId.get(rec.squarePaymentId)) ||
      (rec.orderToken && byReference.get(rec.orderToken)) ||
      null;

    if (!hit) {
      if (expectsSquare(rec)) unmatched.push(rec);
      continue;
    }

    hit.reconciliation = 'matched';
    hit.match = mergeMatch(hit.match, rec);
    // Our record knows the human; Square usually does not.
    hit.buyerName = rec.buyerName || hit.buyerName;
    hit.buyerEmail = rec.buyerEmail || hit.buyerEmail;
    hit.receiptUrl = hit.receiptUrl || rec.receiptUrl;
  }

  return { rows, unmatched };
}

/**
 * Should this record of ours have a Square counterpart at all?
 *
 * Comps, film-pass redemptions and till cash never touch Square, so flagging
 * them as unreconciled would bury the real faults under routine rows. A record
 * that already carries a `square_payment_id` always expects one — that id came
 * from Square, so its absence from the range means something is genuinely off
 * (or, far more often, that the sale is simply outside the window being read).
 */
export function expectsSquare(rec: SiteRecord): boolean {
  if (rec.squarePaymentId) return true;
  const method = (rec.paymentMethod ?? '').toLowerCase();
  return method !== 'comp' && method !== 'film_pass' && method !== 'cash';
}

function mergeMatch(existing: SiteMatch | null, rec: SiteRecord): SiteMatch {
  // One Square order can pay for several of our rows (four tickets, one card).
  // Merge rather than overwrite, or the drawer shows one seat of four.
  if (!existing) {
    return {
      kind: rec.kind,
      orderToken: rec.orderToken,
      paymentMethod: rec.paymentMethod,
      buyerName: rec.buyerName,
      buyerEmail: rec.buyerEmail,
      recordIds: [...rec.recordIds],
      showingId: rec.showingId,
      showingLabel: rec.showingLabel,
      ourTotalCents: rec.totalCents,
    };
  }
  return {
    ...existing,
    recordIds: [...new Set([...existing.recordIds, ...rec.recordIds])],
    buyerName: existing.buyerName || rec.buyerName,
    buyerEmail: existing.buyerEmail || rec.buyerEmail,
    showingId: existing.showingId ?? rec.showingId,
    showingLabel: existing.showingLabel ?? rec.showingLabel,
    ourTotalCents: (existing.ourTotalCents ?? 0) + (rec.totalCents ?? 0),
  };
}

/**
 * Render our unmatched records as rows, so one table can show both directions.
 *
 * These are deliberately shaped like a Square row with the money fields it can
 * support and nothing invented for the ones it cannot: there is no tender, no
 * tax breakdown and no Square id, because there is no Square order.
 */
export function siteOnlyRows(records: SiteRecord[]): TransactionRow[] {
  return records.map((rec) => {
    const label = rec.showingLabel ?? kindLabel(rec.kind);
    return {
      id: `site:${rec.kind}:${rec.orderToken ?? rec.recordIds[0] ?? 'unknown'}`,
      createdAt: rec.createdAt,
      // No Square tender, so no collection time we can vouch for.
      collectedAt: null,
      source: 'Kenworthy Website',
      // No Square order means no Square state. Left blank rather than faked as
      // COMPLETED, which would read as "Square has this" — the opposite of what
      // the row is saying.
      state: '',
      tenderTypes: [],
      tenders: [],
      buyerName: rec.buyerName,
      buyerEmail: rec.buyerEmail,
      items: [],
      itemsSummary: label,
      categories: [],
      totalCents: rec.totalCents ?? 0,
      taxCents: 0,
      tipCents: 0,
      discountCents: 0,
      refundedCents: 0,
      refunds: [],
      status: 'Completed',
      referenceId: rec.orderToken,
      receiptUrl: rec.receiptUrl,
      locationId: null,
      match: {
        kind: rec.kind,
        orderToken: rec.orderToken,
        paymentMethod: rec.paymentMethod,
        buyerName: rec.buyerName,
        buyerEmail: rec.buyerEmail,
        recordIds: rec.recordIds,
        showingId: rec.showingId,
        showingLabel: rec.showingLabel,
        ourTotalCents: rec.totalCents,
      },
      reconciliation: 'site_only',
    };
  });
}

function kindLabel(kind: SiteMatch['kind']): string {
  return kind === 'donation' ? 'Donation' : kind === 'film_pass' ? 'Film pass' : 'Tickets';
}

// ---------------------------------------------------------------------------
// Search, filter, sort
// ---------------------------------------------------------------------------

export interface TransactionFilters {
  q?: string;
  sources?: string[];
  tenders?: string[];
  categories?: string[];
  statuses?: string[];
  /** Square's order state, so an OPEN check can be isolated and looked at. */
  states?: string[];
  reconciliation?: Reconciliation[];
}

export type SortKey = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

/**
 * Free-text search across everything a person might have in hand.
 *
 * Deliberately includes the ids: the reason someone opens this screen is often
 * that a patron has quoted a receipt or a support thread has a payment id in
 * it, and a search box that only covered names would make those unfindable.
 */
export function rowHaystack(row: TransactionRow): string {
  return [
    row.id,
    row.referenceId,
    row.source,
    row.buyerName,
    row.buyerEmail,
    row.itemsSummary,
    row.status,
    row.match?.orderToken,
    row.match?.showingLabel,
    ...row.categories,
    ...row.tenders.map((t) => t.paymentId),
    ...row.tenders.map((t) => t.last4),
    ...row.match?.recordIds ?? [],
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function filterRows(rows: TransactionRow[], filters: TransactionFilters): TransactionRow[] {
  // Every term must appear somewhere in the row, but not necessarily in the
  // same field: "hendricks popcorn" should find the sale that had both.
  const terms = (filters.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const sources = setOf(filters.sources);
  const tenders = setOf(filters.tenders);
  const categories = setOf(filters.categories);
  const statuses = setOf(filters.statuses);
  const states = setOf(filters.states);
  const recon = setOf(filters.reconciliation);

  return rows.filter((row) => {
    if (sources && !sources.has(row.source)) return false;
    if (statuses && !statuses.has(row.status)) return false;
    if (states && !states.has(row.state)) return false;
    if (recon && !recon.has(row.reconciliation)) return false;
    if (tenders && !row.tenderTypes.some((t) => tenders.has(t))) return false;
    if (categories && !row.categories.some((c) => categories.has(c))) return false;
    if (terms.length > 0) {
      const hay = rowHaystack(row);
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

function setOf(values?: string[]): Set<string> | null {
  return values && values.length > 0 ? new Set(values) : null;
}

export function sortRows(rows: TransactionRow[], sort: SortKey): TransactionRow[] {
  const sorted = [...rows];
  switch (sort) {
    case 'date_asc':
      return sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case 'amount_desc':
      return sorted.sort((a, b) => b.totalCents - a.totalCents);
    case 'amount_asc':
      return sorted.sort((a, b) => a.totalCents - b.totalCents);
    case 'date_desc':
    default:
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export interface Facets {
  sources: string[];
  tenders: string[];
  categories: string[];
  statuses: string[];
  states: string[];
}

/**
 * Facets come from the whole range, not the filtered page.
 *
 * If they narrowed with the results, choosing "CASH" would remove "CARD" from
 * the tender list and there would be no way back to it without clearing the
 * filter — a dead end that looks like a bug.
 */
export function buildFacets(rows: TransactionRow[]): Facets {
  const sources = new Set<string>();
  const tenders = new Set<string>();
  const categories = new Set<string>();
  const statuses = new Set<string>();
  const states = new Set<string>();
  for (const row of rows) {
    sources.add(row.source);
    statuses.add(row.status);
    if (row.state) states.add(row.state);
    for (const t of row.tenderTypes) tenders.add(t);
    for (const c of row.categories) categories.add(c);
  }
  return {
    sources: [...sources].sort(),
    tenders: [...tenders].sort(),
    categories: [...categories].sort(),
    statuses: [...statuses].sort(),
    states: [...states].sort(),
  };
}

// There is deliberately NO totalsFor() here any more.
//
// This module used to sum the fetched rows to produce the screen's money
// figures, and that sum disagreed with Square — not because the arithmetic was
// wrong but because the two range on different things: we on when an order was
// rung up, Square on when it collected. An invoice raised in July and paid in
// August belongs to a different month for each of us, and this account's
// invoices average $566, so the delta swung from -30% over seven days to +17%
// for June alone.
//
// The totals now come from Square's Reporting API instead (see
// `squareTotals()` in ../square-transactions/index.ts), which is the engine
// behind Square's own Dashboard, so they agree with Square by construction.
// Anything re-added here would have to disagree with the number on the card
// above it. Don't.

// ---------------------------------------------------------------------------
// Catalog index
// ---------------------------------------------------------------------------

/**
 * Build variation-id -> {item name, category} from a catalog listing.
 *
 * This is best-effort by design. `/v2/catalog/list` omits archived objects, and
 * this account has years of retired showtimes, so older line items will not
 * resolve — they fall back to the name Square stored on the sale. A missing
 * category must never hide a transaction, only leave its category blank.
 */
export function buildCatalogIndex(objects: any[]): CatalogIndex {
  const categoryNames = new Map<string, string>();
  for (const obj of objects) {
    if (obj?.type === 'CATEGORY' && obj?.id) {
      categoryNames.set(obj.id, obj?.category_data?.name ?? '');
    }
  }

  const index: CatalogIndex = new Map();
  for (const obj of objects) {
    if (obj?.type !== 'ITEM') continue;
    const itemName = obj?.item_data?.name ?? 'Unnamed item';
    // `reporting_category` is what Square's revenue reports group by, so it is
    // the one to show; `categories[0]` is the fallback for older items that
    // predate the field.
    const categoryId = obj?.item_data?.reporting_category?.id ??
      obj?.item_data?.categories?.[0]?.id ??
      obj?.item_data?.category_id ??
      null;
    const category = categoryId ? categoryNames.get(categoryId) || null : null;
    for (const v of obj?.item_data?.variations ?? []) {
      if (v?.id) index.set(v.id, { itemName, category });
    }
    if (obj.id) index.set(obj.id, { itemName, category });
  }
  return index;
}

// ---------------------------------------------------------------------------
// Date range
// ---------------------------------------------------------------------------

/**
 * An unbounded range is thousands of Square round-trips behind a single click,
 * so the window is capped. 400 days still covers "this year so far" from any
 * day of it, including the ones where "last year to date" is the comparison.
 */
export const MAX_RANGE_DAYS = 400;

export interface ResolvedRange {
  /** Venue-local calendar dates, `YYYY-MM-DD`, inclusive of both ends. */
  startDate: string;
  endDate: string;
  /** The same window as UTC instants, which is what /orders/search takes. */
  startAt: string;
  endAt: string;
}

/**
 * Resolve a range to venue-local calendar days AND to the UTC instants that
 * span them.
 *
 * Calendar days in the theatre's own time zone, not a rolling UTC window,
 * for two reasons that both bite:
 *
 *   * "the last 30 days" to a cinema means thirty evenings. A rolling UTC
 *     window from the request instant cuts tonight's screening off one end and
 *     adds a stray evening at the other — the effect FINDINGS-square-reporting-api.md
 *     measured as a percent or two of drift on concessions.
 *   * `square-analytics` already reports on venue-local calendar days, because
 *     that is what Square's own `dateRange` means. If this screen used a
 *     different window, its totals could never be compared with the Overview's
 *     or with Square's Dashboard, and every real discrepancy would be buried in
 *     window noise.
 *
 * `/v2/orders/search` takes instants, so both forms are returned rather than
 * converted at the call site and quietly getting it wrong.
 */
export function resolveTransactionRange(
  start: unknown,
  end: unknown,
  nowMs: number = Date.now(),
  timeZone = VENUE_TZ,
): ResolvedRange | { error: string } {
  const endDate = isDateString(end) ? end.trim() : venueDate(new Date(nowMs), timeZone);
  if (!isCalendarDate(endDate)) return { error: 'Could not read that end date' };

  const startDate = isDateString(start)
    ? start.trim()
    // Inclusive of today, so "30 days" spans 30 dated buckets — the same
    // convention _shared/square-reporting.ts uses.
    : venueDate(new Date(Date.parse(`${endDate}T12:00:00Z`) - 29 * 86400_000), timeZone);
  if (!isCalendarDate(startDate)) return { error: 'Could not read that start date' };

  if (startDate > endDate) return { error: 'The start date is after the end date' };

  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) /
    86400_000;
  if (days + 1 > MAX_RANGE_DAYS) {
    return { error: `Ranges are limited to ${MAX_RANGE_DAYS} days. Narrow the dates.` };
  }

  return {
    startDate,
    endDate,
    startAt: venueDayStart(startDate, timeZone).toISOString(),
    // The END of the last day. Without this, "1 Jan to 31 Jan" ends at midnight
    // and silently drops every sale made on the 31st — a whole missing day that
    // reads as a quiet Saturday rather than as a bug.
    endAt: new Date(venueDayStart(endDate, timeZone).getTime() + 86400_000 - 1).toISOString(),
  };
}

const isDateString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const isCalendarDate = (v: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/**
 * Midnight of a venue-local calendar date, as a UTC instant.
 *
 * Two passes, because the offset depends on the instant we are trying to find:
 * a first guess in UTC lands in the right region for the offset lookup, and the
 * second pass corrects it. One pass is wrong for the two days a year that a DST
 * transition moves the boundary — a day that would silently start or end an
 * hour off.
 */
export function venueDayStart(date: string, timeZone = VENUE_TZ): Date {
  const target = Date.parse(`${date}T00:00:00Z`);
  let instant = target - tzOffsetMs(new Date(target), timeZone);
  instant = target - tzOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** How far ahead of UTC `timeZone` is at this instant, in milliseconds. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    // Intl renders midnight as hour 24 in some runtimes.
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - at.getTime();
}
