// The admin Overview's numbers, from Square's own reporting engine.
//
// This replaces an implementation that paged /v2/orders/search and summed the
// line items itself. That version is worth understanding, because its failure
// is the reason this one exists: it under-reported gross revenue by ~35% and
// ticket categories by ~50%. Square counted 2,894 orders in the window where it
// counted 2,377 — it was dropping whole orders, not mis-filing them, most
// likely on `state_filter: ["COMPLETED"]` and on filtering by `closed_at` (an
// order with a null closed_at can never match a date range).
//
// Rather than hunt that bug, we deleted the arithmetic. The Reporting API IS
// the engine behind Square's own Dashboard reports, so figures agree with
// Square by construction instead of by reconciliation. See
// docs/briefs/FINDINGS-square-reporting-api.md.
//
// Three things it also removes:
//
//   * The 40-page cap. There is no pagination — aggregation happens server-side.
//   * The /catalog/batch-retrieve join, which existed only because order line
//     items carry no category. `ItemTransactions.category_name` is native.
//   * The whole class of "our arithmetic disagrees with Square's" bug.
//
// ---------------------------------------------------------------------------
// Three traps, all of which cost time to find
// ---------------------------------------------------------------------------
//
// 1. The query must be wrapped: {"query": {...}}. Otherwise Square answers
//    `Query param is required`.
// 2. /load is ASYNCHRONOUS. While a query is still computing it returns
//    **HTTP 200** with a body of {"error":"Continue wait"} instead of results.
//    A caller that treats 200 as success reads no rows and reports zero
//    revenue — the exact silent-wrong-number failure this rewrite is meant to
//    end. Hence pollLoad().
// 3. Amounts come back as **decimal dollars** (28747.479999999996), not
//    integer cents. Everything below converts at the boundary so the rest of
//    the app keeps working in cents.
//
// It is still an open beta. If it is withdrawn, the fallback is not the old
// implementation — it is fixing the old implementation's order filter.

declare const Deno: any;

export type ReportingEnv = "sandbox" | "production";

const REPORTING_HOST: Record<ReportingEnv, string> = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
};

/** The venue's wall clock. Square reports in local time; so must our ranges. */
export const VENUE_TZ = "America/Los_Angeles";

/** Reporting categories whose items count as a ticket sold. */
export const TICKET_CATEGORIES = new Set([
  "6 Film Tickets",
  "6 METLive Tickets",
  "6 Live Event Tickets",
  "6 NT Live Tickets",
  "6 Rental Tickets",
]);

/**
 * Categories that make up the concession stand.
 *
 * The numbered taxonomy splits the stand across several categories, so the
 * Concession Rev card is their union rather than the one literally named
 * `Concessions`. Measured against the live account, all of these carry revenue.
 */
export const CONCESSION_CATEGORIES = new Set([
  "1 Combos",
  "2 Candy",
  "3 Bottles",
  "3 Soda",
  "4 Beer",
  "4 Wine",
  "5 Popcorn",
  "Cafe",
  "Cocktails",
  "Concessions",
]);

export type Bucket = "tickets" | "concessions" | "other";

export function bucketFor(category: string | null | undefined): Bucket {
  if (category && TICKET_CATEGORIES.has(category)) return "tickets";
  if (category && CONCESSION_CATEGORIES.has(category)) return "concessions";
  return "other";
}

/** Square's dollars -> our cents. Floats arrive as 28747.479999999996. */
export const cents = (dollars: unknown): number =>
  Math.round((Number(dollars) || 0) * 100);

/** Refund figures arrive negative; the UI wants a magnitude. */
export const absCents = (dollars: unknown): number => Math.abs(cents(dollars));

/** A date as the venue sees it, YYYY-MM-DD (en-CA formats that way natively). */
export function venueDate(d: Date, timeZone = VENUE_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Resolve a preset to an inclusive [start, end] of venue-local calendar dates.
 *
 * Calendar dates, not instants, because that is what Square's dateRange means
 * and what a theatre means by "the last 30 days". The old implementation used a
 * rolling UTC window from the request moment, which cut the current evening's
 * screening off one end and added a stray evening at the other.
 */
export function resolveRange(
  preset: string | undefined,
  now: Date,
  custom?: { start?: string; end?: string },
  timeZone = VENUE_TZ,
): { start: string; end: string } {
  if (preset === "custom" && custom?.start && custom?.end) {
    return { start: custom.start, end: custom.end };
  }
  const end = venueDate(now, timeZone);
  if (preset === "ytd") {
    return { start: `${end.slice(0, 4)}-01-01`, end };
  }
  const days = preset === "90d" ? 90 : preset === "365d" ? 365 : 30;
  // Inclusive of today, so "30 days" spans 30 dated buckets.
  const start = venueDate(new Date(now.getTime() - (days - 1) * 86400_000), timeZone);
  return { start, end };
}

/** Day buckets get unwieldy over a long range; months stay readable. */
export function granularityFor(range: { start: string; end: string }): "day" | "month" {
  const span = (Date.parse(range.end) - Date.parse(range.start)) / 86400_000;
  return span > 120 ? "month" : "day";
}

export interface CubeQuery {
  measures: string[];
  dimensions?: string[];
  timeDimensions?: Array<{ dimension: string; dateRange: string[] | string; granularity?: string }>;
  filters?: Array<{ member: string; operator: string; values: string[] }>;
  limit?: number;
}

/**
 * Run one Cube query, waiting out the async "Continue wait" phase.
 *
 * `sleep` is injected so tests do not actually wait.
 */
export async function pollLoad(
  opts: {
    environment: ReportingEnv;
    accessToken: string;
    query: CubeQuery;
    /** Names the query in any error, so a 400 is attributable to one of five. */
    label?: string;
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
    fetchImpl?: typeof fetch;
  },
): Promise<any[]> {
  const {
    environment,
    accessToken,
    query,
    label = "query",
    maxAttempts = 30,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    fetchImpl = fetch,
  } = opts;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetchImpl(`${REPORTING_HOST[environment]}/reporting/v1/load`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      // The wrapper is mandatory.
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    let payload: any = null;
    try { payload = JSON.parse(text); } catch { /* handled below */ }

    if (!res.ok) {
      const detail = payload?.error ?? text.slice(0, 300);
      throw new Error(`Reporting API ${res.status} on ${label}: ${detail}`);
    }
    // A 200 that is really "not finished yet".
    if (payload?.error === "Continue wait") {
      await sleep(1000);
      continue;
    }
    if (payload?.error) throw new Error(`Reporting API on ${label}: ${payload.error}`);
    return payload?.data ?? [];
  }
  throw new Error(`Reporting API did not finish computing ${label} in time`);
}

// --- query builders ---------------------------------------------------------
//
// Kept as pure functions so a test can assert the exact shape sent to Square
// without a network call. Every measure and dimension name below was read from
// /reporting/v1/meta against the live account, not from documentation — the
// docs do not list ItemTransactions' dimensions at all.

const ITEM_TIME = "ItemTransactions.local_reporting_timestamp";
const SALES_TIME = "Sales.local_reporting_timestamp";
const PAY_TIME = "PaymentAndRefunds.reporting_timestamp";

export function totalsQuery(range: { start: string; end: string }): CubeQuery {
  return {
    measures: [
      "Sales.total_collected_amount", // Square's own "Total collected"
      "Sales.net_sales",
      "Sales.order_count",
      "Sales.tips_amount",
      "Sales.sales_tax_amount",
    ],
    timeDimensions: [{ dimension: SALES_TIME, dateRange: [range.start, range.end] }],
  };
}

/** One query serves both the daily chart and the category pie. */
export function categoryByDayQuery(
  range: { start: string; end: string },
  granularity: "day" | "month",
  limit = 10000,
): CubeQuery {
  return {
    measures: ["ItemTransactions.sales_gross_amount", "ItemTransactions.items_sold_count"],
    dimensions: ["ItemTransactions.category_name"],
    timeDimensions: [{ dimension: ITEM_TIME, dateRange: [range.start, range.end], granularity }],
    limit,
  };
}

/**
 * NOTE: no `order`. Square rejects Cube's object form of it with a bare
 * `Invalid request` and no indication of which field is at fault, so ordering
 * is done in shape() instead. `limit` on its own is accepted.
 */
export function topPerformersQuery(range: { start: string; end: string }, limit = 500): CubeQuery {
  return {
    measures: ["ItemTransactions.sales_gross_amount", "ItemTransactions.items_sold_count"],
    dimensions: ["ItemTransactions.item_name"],
    timeDimensions: [{ dimension: ITEM_TIME, dateRange: [range.start, range.end] }],
    filters: [{
      member: "ItemTransactions.category_name",
      operator: "equals",
      values: [...TICKET_CATEGORIES],
    }],
    limit,
  };
}

/**
 * What is actually inside Square's own "Uncategorized" bucket.
 *
 * On the live account this is the single largest category, so leaving it as an
 * unexplained wedge would make the whole pie untrustworthy. Unlike the previous
 * implementation, this is not a diagnostic for a bug in our code — Square
 * genuinely has no category on these items.
 */
export function uncategorizedQuery(
  range: { start: string; end: string },
  categoryName = "Uncategorized",
  limit = 500,
): CubeQuery {
  return {
    measures: ["ItemTransactions.sales_gross_amount", "ItemTransactions.items_sold_count"],
    dimensions: ["ItemTransactions.item_name"],
    timeDimensions: [{ dimension: ITEM_TIME, dateRange: [range.start, range.end] }],
    filters: [{ member: "ItemTransactions.category_name", operator: "equals", values: [categoryName] }],
    limit,
  };
}

export function refundsQuery(range: { start: string; end: string }): CubeQuery {
  return {
    measures: ["PaymentAndRefunds.count", "PaymentAndRefunds.refund_total_amount"],
    dimensions: ["PaymentAndRefunds.type"],
    timeDimensions: [{ dimension: PAY_TIME, dateRange: [range.start, range.end] }],
  };
}

// --- shaping ----------------------------------------------------------------

export interface AnalyticsPayload {
  range: { start: string; end: string };
  granularity: "day" | "month";
  totals: {
    totalCollectedCents: number;
    netSalesCents: number;
    grossSalesCents: number;
    ticketsSold: number;
    avgPerTicketCents: number;
    concessionRevenueCents: number;
    refundCount: number;
    refundCents: number;
    tipsCents: number;
    taxCents: number;
  };
  revenueByDay: Array<{
    date: string;
    ticketsCents: number;
    concessionsCents: number;
    otherCents: number;
    totalCents: number;
  }>;
  revenueByCategory: Array<{ name: string; amountCents: number; quantity: number }>;
  topPerformers: Array<{ title: string; revenueCents: number; count: number }>;
  uncategorized: Array<{ name: string; amountCents: number; quantity: number }>;
  meta: { orders: number; categories: number; truncated: boolean; source: "reporting-api" };
}

const num = (row: any, key: string) => Number(row?.[key]) || 0;

/** Square returns the granularity-suffixed key, e.g. `....local_...timestamp.day`. */
function dayKey(row: any, granularity: "day" | "month"): string | null {
  const k = `${ITEM_TIME}.${granularity}`;
  const raw = row?.[k] ?? row?.[ITEM_TIME];
  return typeof raw === "string" ? raw.slice(0, 10) : null;
}

export function shape(input: {
  range: { start: string; end: string };
  granularity: "day" | "month";
  totalsRows: any[];
  categoryRows: any[];
  topRows: any[];
  uncategorizedRows: any[];
  refundRows: any[];
  categoryRowLimit: number;
}): AnalyticsPayload {
  const { range, granularity, totalsRows, categoryRows, topRows, uncategorizedRows, refundRows } = input;

  const t = totalsRows?.[0] ?? {};

  const byDay = new Map<string, AnalyticsPayload["revenueByDay"][number]>();
  const byCategory = new Map<string, { amountCents: number; quantity: number }>();
  let grossSalesCents = 0;
  let ticketsSold = 0;
  let ticketRevenueCents = 0;
  let concessionRevenueCents = 0;

  for (const row of categoryRows ?? []) {
    const category = row?.["ItemTransactions.category_name"] ?? null;
    const amount = cents(row?.["ItemTransactions.sales_gross_amount"]);
    const qty = num(row, "ItemTransactions.items_sold_count");
    const bucket = bucketFor(category);

    grossSalesCents += amount;
    if (bucket === "tickets") { ticketsSold += qty; ticketRevenueCents += amount; }
    else if (bucket === "concessions") concessionRevenueCents += amount;

    // Square's own label wins. It reports literally "Uncategorized" for items
    // with no category, so there is no need to invent a bucket name.
    const label = category ?? "Uncategorized";
    const c = byCategory.get(label) ?? { amountCents: 0, quantity: 0 };
    c.amountCents += amount;
    c.quantity += qty;
    byCategory.set(label, c);

    const day = dayKey(row, granularity);
    if (!day) continue;
    const d = byDay.get(day) ??
      { date: day, ticketsCents: 0, concessionsCents: 0, otherCents: 0, totalCents: 0 };
    if (bucket === "tickets") d.ticketsCents += amount;
    else if (bucket === "concessions") d.concessionsCents += amount;
    else d.otherCents += amount;
    d.totalCents += amount;
    byDay.set(day, d);
  }

  const refundRow = (refundRows ?? []).find(
    (r) => r?.["PaymentAndRefunds.type"] === "REFUND",
  );

  return {
    range,
    granularity,
    totals: {
      totalCollectedCents: cents(t["Sales.total_collected_amount"]),
      netSalesCents: cents(t["Sales.net_sales"]),
      grossSalesCents,
      ticketsSold,
      avgPerTicketCents: ticketsSold > 0 ? Math.round(ticketRevenueCents / ticketsSold) : 0,
      concessionRevenueCents,
      refundCount: refundRow ? num(refundRow, "PaymentAndRefunds.count") : 0,
      refundCents: refundRow ? absCents(refundRow["PaymentAndRefunds.refund_total_amount"]) : 0,
      tipsCents: cents(t["Sales.tips_amount"]),
      taxCents: cents(t["Sales.sales_tax_amount"]),
    },
    revenueByDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    revenueByCategory: [...byCategory.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .filter((c) => c.amountCents !== 0)
      .sort((a, b) => b.amountCents - a.amountCents),
    // Ordered here rather than by Square — see topPerformersQuery.
    topPerformers: (topRows ?? [])
      .map((r) => ({
        title: r?.["ItemTransactions.item_name"] ?? "Unknown",
        revenueCents: cents(r?.["ItemTransactions.sales_gross_amount"]),
        count: num(r, "ItemTransactions.items_sold_count"),
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, 8),
    uncategorized: (uncategorizedRows ?? [])
      .map((r) => ({
        name: r?.["ItemTransactions.item_name"] ?? "(unnamed)",
        amountCents: cents(r?.["ItemTransactions.sales_gross_amount"]),
        quantity: num(r, "ItemTransactions.items_sold_count"),
      }))
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 15),
    meta: {
      orders: num(t, "Sales.order_count"),
      categories: byCategory.size,
      // Cube truncates at the limit silently, exactly like PostgREST does.
      truncated: (categoryRows?.length ?? 0) >= input.categoryRowLimit,
      source: "reporting-api",
    },
  };
}
