// The theatre's transaction log — read-only, admin only.
//
// WHY THIS IS SQUARE-PRIMARY
//
// Every screen in this admin that reports money reads our own tables, and our
// own tables hold almost nothing: of ~5,000 recent Square orders exactly ONE
// came through this build (docs/SQUARE-TRANSACTION-CONVENTIONS.md). POS, Square
// Online, invoices and the old site are all in Square and nowhere else. So this
// function reads Square and joins our rows onto it, not the other way round.
//
// WHAT IT WILL NEVER DO
//
// On 14 Aug 2026 a catalog push built from our own columns deleted every field
// it did not send, wiping descriptions and images across the catalog. The damage
// was invisible in both UIs. Nothing here writes: every Square call below is a
// GET or the single documented read POST `/v2/orders/search`, there is no
// `/catalog` write anywhere in this file, and the only catalog call is
// `GET /v2/catalog/list`. `deno test` asserts that (see transactions_test.ts).
//
// THE CACHE DOES NOT CURRENTLY DO ANYTHING — MEASURED, 23 Aug 2026
//
// A wide range is many round-trips to Square, and the tab's search box would
// otherwise re-run all of them on every keystroke-pause, so the fetched range
// is held in module scope for ten minutes and searched in memory.
//
// On staging it never hits. Not a bug in the logic: `BOOT_ID` below was added
// to settle exactly that question, and it differs on EVERY response with
// `served: 1` — the edge runtime gives each request a fresh isolate, so module
// scope does not survive from one request to the next and no in-memory cache of
// any design can help. `square-analytics` caches the same way and is therefore
// in the same position.
//
// It is kept because it costs nothing, is correct if isolates are ever reused
// (a warmer production project may well reuse them — untested), and because
// removing it would remove the instrument that measured this. The real fix, if
// production shows the same thing, is a cache TABLE, which is a migration and
// a deliberate decision rather than something to slip in here. `isolate` is
// reported in the response so this stays checkable instead of remembered.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';
import { loadSquareConfig, squareErrorMessage, squareFetch } from '../_shared/square.ts';
import {
  attachSiteMatches,
  buildCatalogIndex,
  buildFacets,
  type CatalogIndex,
  filterRows,
  hasTender,
  normalizeOrder,
  resolveTransactionRange,
  type SiteRecord,
  siteOnlyRows,
  type SortKey,
  sortRows,
  totalsFor,
  type TransactionRow,
} from '../_shared/transactions.ts';
import { pollLoad, totalsQuery } from '../_shared/square-reporting.ts';

// Deno globals
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

/** Square's own ceiling for this endpoint. */
const ORDERS_PAGE_LIMIT = 500;
/**
 * ~50,000 orders. The account does roughly 5,000 a year, so this is years of
 * history and still a hard stop against a runaway cursor. When it trips the
 * response says so — a silently truncated ledger is worse than a slow one.
 */
const MAX_ORDER_PAGES = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;
/** The catalog changes far more slowly than the orders do. */
const CATALOG_TTL_MS = 30 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
/** An export is one file a human opens in a spreadsheet, not a data dump. */
const MAX_EXPORT_ROWS = 5000;

// ---------------------------------------------------------------------------
// Module-scope caches
// ---------------------------------------------------------------------------

interface RangeCache {
  fetchedAt: number;
  rows: TransactionRow[];
  truncated: boolean;
  untendered: number;
  crossCheck: CrossCheck | null;
}

/**
 * Our figure for the range, beside Square's own for the same range.
 *
 * The brief's acceptance test is "the tab's transactions match Square Dashboard
 * → Transactions in count and totals". That is a test somebody has to remember
 * to run by hand, against a dashboard, once. This runs it on every load: the
 * Reporting API IS the engine behind that dashboard, so a disagreement here is
 * a disagreement with Square.
 *
 * It also puts a number on the open question left by
 * FINDINGS-square-reporting-api.md §2 — whether paging /v2/orders/search can be
 * made to agree with Square at all. If `deltaCents` sits near zero across
 * ranges, dropping `state_filter` was the fix and that finding can be closed.
 */
interface CrossCheck {
  available: boolean;
  reason?: string;
  squareCollectedCents?: number;
  squareOrderCount?: number;
  ourCollectedCents?: number;
  ourOrderCount?: number;
  deltaCents?: number;
  /** How far our order COUNT is from Square's, as a percentage. */
  countDeltaPct?: number;
}

const rangeCache = new Map<string, RangeCache>();
let catalogCache: { fetchedAt: number; index: CatalogIndex } | null = null;

/**
 * Identity of this isolate, and how many requests it has served.
 *
 * A module-scope cache is only worth anything if the module outlives a single
 * request, and that is a property of the platform, not of this code. Without
 * these two values a permanent cache miss is indistinguishable from a caching
 * bug — which is exactly the hour this cost the first time. If `boot` changes
 * on every response, the isolate is being recycled and no in-memory cache of
 * any design will help; if it repeats while `cached` stays false, the bug is
 * here.
 */
const BOOT_ID = crypto.randomUUID().slice(0, 8);
let servedCount = 0;

// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  // `verify_jwt` accepts the anon key, which is public and in a public repo, so
  // it is not authentication. The gate is here.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader.includes(ANON_KEY)) {
    return json({ error: 'Admin sign-in required' }, 401);
  }

  let body: Record<string, any> = {};
  if (req.method === 'POST') {
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Admin sign-in required' }, 401);

  const { data: isAdmin } = await admin.rpc('has_role', { _user_id: user.id, _role: 'admin' });
  if (!isAdmin) return json({ error: 'Admin access required' }, 403);

  // -------------------------------------------------------------------------
  // Range
  // -------------------------------------------------------------------------
  const range = resolveTransactionRange(body.start_date, body.end_date);
  if ('error' in range) return json({ error: range.error }, 400);

  const square = loadSquareConfig();
  if (!square.ok) return json({ error: square.error }, 500);
  const config = square.config;

  // -------------------------------------------------------------------------
  // The Square side, cached
  // -------------------------------------------------------------------------
  const cacheKey = `${config.environment}:${range.startAt}:${range.endAt}`;
  const now = Date.now();
  let cached = rangeCache.get(cacheKey);
  const fresh = cached && now - cached.fetchedAt < CACHE_TTL_MS && body.refresh !== true;

  if (!fresh) {
    let catalog: CatalogIndex;
    try {
      catalog = await loadCatalogIndex(config, now);
    } catch (err) {
      // A missing category must never hide a transaction.
      console.error('[square-transactions] catalog index unavailable', err);
      catalog = new Map();
    }

    let fetched;
    try {
      fetched = await fetchOrders(config, range.startAt, range.endAt, catalog);
    } catch (err) {
      console.error('[square-transactions] order search failed', err);
      return json({ error: String((err as Error)?.message ?? err) }, 502);
    }

    const crossCheck = await crossCheckAgainstSquare(config, range, fetched.rows);

    cached = {
      fetchedAt: now,
      rows: fetched.rows,
      truncated: fetched.truncated,
      untendered: fetched.untendered,
      crossCheck,
    };
    rangeCache.set(cacheKey, cached);
    pruneCache(now);
  }

  // -------------------------------------------------------------------------
  // Our side, joined on
  // -------------------------------------------------------------------------
  //
  // Re-read our tables every request rather than caching them alongside the
  // Square page-set. They are small, and they are the half that changes while
  // someone is looking at this screen — a refund issued in another tab should
  // show up on the next search, not in ten minutes.
  //
  // The Square rows are cloned first: they live in a module-scope cache, and
  // attachSiteMatches() mutates what it is given, so joining onto the cached
  // objects directly would accumulate matches across requests.
  const rows = cached!.rows.map(cloneRow);

  let records: SiteRecord[] = [];
  let joinFailed = false;
  try {
    records = await loadSiteRecords(admin, range.startAt, range.endAt);
  } catch (err) {
    // Degrading to a Square-only log is the right fallback, but it must be
    // announced: with no records to match, every row reads `square_only` and
    // the reconciliation view would report a clean bill of health it never
    // checked.
    console.error('[square-transactions] site records unavailable', err);
    joinFailed = true;
  }

  const { unmatched } = attachSiteMatches(rows, records);
  const allRows = [...rows, ...siteOnlyRows(unmatched)];

  // -------------------------------------------------------------------------
  // Filter, sort, page — all here, so the browser never sees the whole range
  // -------------------------------------------------------------------------
  const facets = buildFacets(allRows);
  const filtered = filterRows(allRows, {
    q: typeof body.q === 'string' ? body.q : '',
    sources: stringArray(body.sources),
    tenders: stringArray(body.tenders),
    categories: stringArray(body.categories),
    statuses: stringArray(body.statuses),
    states: stringArray(body.states),
    reconciliation: stringArray(body.reconciliation) as any,
  });
  const sorted = sortRows(filtered, sortKey(body.sort));

  const isExport = body.export === true;
  const pageSize = isExport
    ? MAX_EXPORT_ROWS
    : clamp(Number(body.page_size) || DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const page = isExport ? 0 : Math.max(0, Number(body.page) || 0);
  const pageRows = sorted.slice(page * pageSize, page * pageSize + pageSize);

  const notes: string[] = [];
  if (joinFailed) {
    notes.push(
      'Our own ticket and donation records could not be read, so nothing here is reconciled — treat the site links and the mismatch counts as unknown, not as clean.',
    );
  }
  if (cached!.truncated) {
    notes.push(
      `This range exceeds ${MAX_ORDER_PAGES * ORDERS_PAGE_LIMIT} orders and was cut off. Narrow the dates to see all of it.`,
    );
  }
  if (isExport && sorted.length > MAX_EXPORT_ROWS) {
    notes.push(`Export limited to the first ${MAX_EXPORT_ROWS} of ${sorted.length} rows.`);
  }

  return json({
    rows: pageRows,
    page,
    page_size: pageSize,
    total: sorted.length,
    range_total: allRows.length,
    totals: totalsFor(sorted),
    facets,
    mismatches: {
      square_only: allRows.filter((r) => r.reconciliation === 'square_only').length,
      site_only: allRows.filter((r) => r.reconciliation === 'site_only').length,
      matched: allRows.filter((r) => r.reconciliation === 'matched').length,
    },
    range: {
      start_date: range.startDate,
      end_date: range.endDate,
      start_at: range.startAt,
      end_at: range.endAt,
    },
    cross_check: cached!.crossCheck,
    untendered_orders: cached!.untendered,
    environment: config.environment,
    fetched_at: new Date(cached!.fetchedAt).toISOString(),
    cached: fresh === true,
    isolate: { boot: BOOT_ID, served: ++servedCount, ranges_held: rangeCache.size },
    notes,
  });
});

// ---------------------------------------------------------------------------
// Square reads
// ---------------------------------------------------------------------------

/**
 * Ask Square what it thinks the same range totals, and record both figures.
 *
 * Deliberately non-fatal in every direction. The Reporting API is an open beta
 * and is production-only — `connect.squareupsandbox.com/reporting/v1` is a 404,
 * measured 2026-08-20 — so on staging there is simply nothing to compare
 * against. A transaction log that refused to render because its optional
 * self-audit was unavailable would be a worse screen than one that says so.
 */
async function crossCheckAgainstSquare(
  config: any,
  range: { startDate: string; endDate: string },
  rows: TransactionRow[],
): Promise<CrossCheck> {
  const ourCollectedCents = rows.reduce((sum, r) => sum + r.totalCents, 0);
  const ourOrderCount = rows.length;

  if (config.environment !== 'production') {
    return {
      available: false,
      reason: "Square's Reporting API is production-only, so there is nothing to check against on staging.",
      ourCollectedCents,
      ourOrderCount,
    };
  }

  try {
    const data = await pollLoad({
      environment: 'production',
      accessToken: config.accessToken,
      query: totalsQuery({ start: range.startDate, end: range.endDate }),
      label: 'transactions cross-check',
    });
    const row = data?.[0] ?? {};
    // The Reporting API answers in decimal dollars, not integer cents.
    const squareCollectedCents = Math.round(
      Number(row['Sales.total_collected_amount'] ?? 0) * 100,
    );
    const squareOrderCount = Number(row['Sales.order_count'] ?? 0);

    return {
      available: true,
      squareCollectedCents,
      squareOrderCount,
      ourCollectedCents,
      ourOrderCount,
      deltaCents: ourCollectedCents - squareCollectedCents,
      // The count is the honest test of completeness; the money is not.
      //
      // Measured on the live account 23 Aug 2026: order counts agree within
      // ~1% at every window from 7 days to year-to-date, while the money delta
      // swings from -30% (7 days) through +17% (June alone) to +0.6% (180
      // days). A shortfall that changes sign is not missing money — it is the
      // same money in a different bucket. We range on `order.created_at`;
      // Square's Sales cube ranges on when it collected. An invoice is created
      // when it is drafted and paid weeks later, and this account's invoices
      // average $566.
      countDeltaPct: squareOrderCount > 0
        ? ((ourOrderCount - squareOrderCount) / squareOrderCount) * 100
        : 0,
    };
  } catch (err) {
    console.error('[square-transactions] cross-check unavailable', err);
    return {
      available: false,
      reason: String((err as Error)?.message ?? err),
      ourCollectedCents,
      ourOrderCount,
    };
  }
}

/**
 * Every location, not just the configured one.
 *
 * `loadSquareConfig()` carries the single location our checkout charges
 * against, but the ledger this screen reports is the account's. A second
 * register — a festival box office, a lobby iPad — would post orders to its own
 * location, and scoping to one id would drop those sales with no error at all.
 */
async function activeLocationIds(config: any): Promise<string[]> {
  const res = await squareFetch(config, '/locations');
  if (!res.ok) {
    console.error('[square-transactions] /locations failed', res.status, JSON.stringify(res.data));
    return [config.locationId];
  }
  const ids = (res.data?.locations ?? [])
    .filter((l: any) => l?.status !== 'INACTIVE' && l?.id)
    .map((l: any) => l.id as string);
  return ids.length > 0 ? ids : [config.locationId];
}

async function fetchOrders(
  config: any,
  startAt: string,
  endAt: string,
  catalog: CatalogIndex,
): Promise<{ rows: TransactionRow[]; truncated: boolean; untendered: number }> {
  const locationIds = await activeLocationIds(config);

  const rows: TransactionRow[] = [];
  let cursor: string | undefined;
  let pages = 0;
  /** Carts and unpaid drafts. Counted, so the exclusion is never silent. */
  let untendered = 0;

  do {
    // The one non-GET call in this function, and it is a documented read.
    const res = await squareFetch(config, '/orders/search', {
      method: 'POST',
      body: {
        location_ids: locationIds,
        limit: ORDERS_PAGE_LIMIT,
        cursor,
        query: {
          filter: {
            // NO state_filter, and `created_at` rather than `closed_at`.
            //
            // Both are deliberate, and both are the mistakes that
            // FINDINGS-square-reporting-api.md caught the analytics function
            // making: an order with a null `closed_at` cannot match a
            // `closed_at` range at all, and filtering to COMPLETED may drop
            // paid-but-unclosed checks. Together they were the leading
            // explanation for a 35% shortfall against Square's own figure.
            // Selection happens on `hasTender()` instead, after the fetch.
            date_time_filter: { created_at: { start_at: startAt, end_at: endAt } },
          },
          // Square requires the sort field to match the filtered date field.
          sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' },
        },
      },
    });

    if (!res.ok) {
      throw new Error(squareErrorMessage(res.data, `Square returned ${res.status}`));
    }

    for (const order of res.data?.orders ?? []) {
      // No state filter — a tender is the test. See hasTender() for the 35%
      // under-report this avoids repeating.
      if (!hasTender(order)) {
        untendered += 1;
        continue;
      }
      rows.push(normalizeOrder(order, catalog));
    }

    cursor = res.data?.cursor;
    pages += 1;
  } while (cursor && pages < MAX_ORDER_PAGES);

  return { rows, truncated: Boolean(cursor), untendered };
}

/**
 * Item and category names, so a line item can say which category it sold under.
 *
 * `GET /v2/catalog/list` deliberately, not `POST /v2/catalog/batch-retrieve`:
 * the standing rule after 14 Aug is that this function makes no non-GET catalog
 * call of any kind, and honouring that literally costs one extra page fetch and
 * removes the whole class of mistake.
 */
async function loadCatalogIndex(config: any, now: number): Promise<CatalogIndex> {
  if (catalogCache && now - catalogCache.fetchedAt < CATALOG_TTL_MS) {
    return catalogCache.index;
  }

  const objects: any[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const query = new URLSearchParams({ types: 'ITEM,CATEGORY' });
    if (cursor) query.set('cursor', cursor);
    const res = await squareFetch(config, `/catalog/list?${query}`);
    if (!res.ok) {
      throw new Error(squareErrorMessage(res.data, `catalog/list returned ${res.status}`));
    }
    objects.push(...(res.data?.objects ?? []));
    cursor = res.data?.cursor;
    pages += 1;
  } while (cursor && pages < 40);

  const index = buildCatalogIndex(objects);
  catalogCache = { fetchedAt: now, index };
  return index;
}

// ---------------------------------------------------------------------------
// Our own records
// ---------------------------------------------------------------------------

/**
 * Read every sale of ours in the range, whatever table it landed in.
 *
 * PostgREST silently caps a select at 1000 rows, so each read pages explicitly.
 * Getting that wrong here would not error — it would quietly report a matched
 * sale as missing from Square, which is precisely the alarm this screen raises.
 */
async function loadSiteRecords(admin: any, startAt: string, endAt: string): Promise<SiteRecord[]> {
  const [tickets, donations, passOrders] = await Promise.all([
    pagedSelect(
      admin
        .from('tickets')
        .select(
          'id, order_token, square_payment_id, square_receipt_url, payment_method, total_price, processing_fee, purchased_at, status, showing_id, user_id, comp_recipient_name, comp_recipient_email, showings(start_time, movies(title), events(title), live_performances(title))',
        )
        .in('status', ['confirmed', 'refunded'])
        .gte('purchased_at', startAt)
        .lte('purchased_at', endAt),
    ),
    pagedSelect(
      admin
        .from('donations')
        .select(
          'id, order_token, square_payment_id, square_receipt_url, donor_name, donor_email, amount_cents, created_at, status, payment_channel',
        )
        .eq('status', 'completed')
        .gte('created_at', startAt)
        .lte('created_at', endAt),
    ),
    pagedSelect(
      admin
        .from('film_pass_orders')
        .select(
          'id, square_payment_id, square_receipt_url, buyer_name, buyer_email, amount_paid, created_at, status, payment_method',
        )
        .gte('created_at', startAt)
        .lte('created_at', endAt),
    ),
  ]);

  // Buyer names live on `profiles`, which is a separate read: the service-role
  // client bypasses RLS, but tickets have no embeddable FK to profiles.
  const userIds = [...new Set(tickets.map((t: any) => t.user_id).filter(Boolean))] as string[];
  const profiles = new Map<string, { display_name: string | null; email: string | null }>();
  for (const chunk of chunked(userIds, 200)) {
    const { data } = await admin.from('profiles').select('id, display_name, email').in('id', chunk);
    for (const p of data ?? []) profiles.set(p.id, p);
  }

  const records: SiteRecord[] = [];

  // One Square order pays for a whole basket, so tickets collapse by
  // order_token. Left one row per ticket, a four-seat sale would look like
  // three unreconciled transactions sitting beside one matched one.
  const ticketOrders = new Map<string, any[]>();
  for (const t of tickets as any[]) {
    const key = t.order_token || `ticket:${t.id}`;
    const list = ticketOrders.get(key) ?? [];
    list.push(t);
    ticketOrders.set(key, list);
  }

  for (const group of ticketOrders.values()) {
    const first = group[0];
    const profile = first.user_id ? profiles.get(first.user_id) : undefined;
    records.push({
      kind: 'tickets',
      orderToken: first.order_token ?? null,
      // A basket is one charge, so any ticket in it carries the payment id.
      squarePaymentId: group.find((t) => t.square_payment_id)?.square_payment_id ?? null,
      paymentMethod: first.payment_method ?? null,
      buyerName: profile?.display_name || first.comp_recipient_name || null,
      buyerEmail: profile?.email || first.comp_recipient_email || null,
      recordIds: group.map((t) => t.id),
      showingId: first.showing_id ?? null,
      showingLabel: showingLabel(first.showings),
      totalCents: Math.round(
        group.reduce(
          (sum, t) => sum + Number(t.total_price || 0) + Number(t.processing_fee || 0),
          0,
        ) * 100,
      ),
      createdAt: first.purchased_at ?? startAt,
      receiptUrl: group.find((t) => t.square_receipt_url)?.square_receipt_url ?? null,
    });
  }

  for (const d of donations as any[]) {
    records.push({
      kind: 'donation',
      orderToken: d.order_token ?? null,
      squarePaymentId: d.square_payment_id ?? null,
      // `payment_channel` is 'online' | 'terminal' | 'cash'; a cash donation
      // taken at the desk has no Square payment and must not be flagged.
      paymentMethod: d.payment_channel ?? null,
      buyerName: d.donor_name ?? null,
      buyerEmail: d.donor_email ?? null,
      recordIds: [d.id],
      showingId: null,
      showingLabel: 'Donation',
      totalCents: Number(d.amount_cents || 0),
      createdAt: d.created_at ?? startAt,
      receiptUrl: d.square_receipt_url ?? null,
    });
  }

  for (const o of passOrders as any[]) {
    if (o.status !== 'paid' && o.status !== 'fulfilled' && o.status !== 'completed') continue;
    records.push({
      kind: 'film_pass',
      // film_pass_orders has no order_token — payment id is the only key.
      orderToken: null,
      squarePaymentId: o.square_payment_id ?? null,
      paymentMethod: o.payment_method ?? null,
      buyerName: o.buyer_name ?? null,
      buyerEmail: o.buyer_email ?? null,
      recordIds: [o.id],
      showingId: null,
      showingLabel: 'Film pass',
      totalCents: o.amount_paid != null ? Math.round(Number(o.amount_paid) * 100) : null,
      createdAt: o.created_at ?? startAt,
      receiptUrl: o.square_receipt_url ?? null,
    });
  }

  return records;
}

function showingLabel(showing: any): string | null {
  if (!showing) return null;
  const title = showing.movies?.title ?? showing.events?.title ??
    showing.live_performances?.title ?? null;
  if (!title) return null;
  return showing.start_time ? `${title} · ${showing.start_time}` : title;
}

/** Read past PostgREST's silent 1000-row ceiling. */
async function pagedSelect(query: any, pageSize = 1000): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0;; from += pageSize) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < pageSize) return out;
  }
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function sortKey(value: unknown): SortKey {
  const allowed: SortKey[] = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'];
  return allowed.includes(value as SortKey) ? value as SortKey : 'date_desc';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** Structural clone of the parts attachSiteMatches() writes to. */
function cloneRow(row: TransactionRow): TransactionRow {
  return { ...row, match: null, reconciliation: 'square_only' };
}

function pruneCache(now: number): void {
  for (const [key, entry] of rangeCache) {
    if (now - entry.fetchedAt > CACHE_TTL_MS) rangeCache.delete(key);
  }
}
