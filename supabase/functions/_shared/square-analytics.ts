// Aggregating the theatre's Square sales into the admin Overview's numbers.
//
// Why this exists at all: the Overview used to compute its KPIs from our own
// `tickets` and `concession_sales` tables, and read ~zero for every card. That
// was not a bug in the arithmetic. Exactly ONE order has ever come through this
// build (docs/SQUARE-TRANSACTION-CONVENTIONS.md); the theatre's revenue is in
// Square — Point of Sale (4,054 orders), Square Online (913), invoices and
// payment links. The Overview was pointed at the wrong source.
//
// Square stays the right source after `BRIEF-square-line-items.md` lands, too:
// once our own checkout writes orders to Square, a Square-sourced Overview
// counts web sales *and* the box office in one place, with no double-count and
// no second pipeline to keep in step.
//
// ---------------------------------------------------------------------------
// The one thing that makes this harder than "sum the orders"
// ---------------------------------------------------------------------------
//
// An order line item does NOT carry its reporting category. It carries a
// `catalog_object_id` (an ITEM_VARIATION id) and the name/price captured at the
// time of sale. The category lives on the *item* that owns that variation, in
// the catalog. So any per-category number — "Tickets Sold", "Revenue by
// Category", "Concession Rev" — needs a variation -> category map built from a
// catalog read, joined to the orders.
//
// This is not a guess. The prototype this function replaces hit the same wall
// and stubbed the lookup out rather than solve it:
//
//     // square-event-probe/index.ts:398
//     const c = li.catalog_object_id ? null : null;
//
// Building that map costs an extra round-trip per 1,000 distinct variations
// sold in the range, which is why the caller caches the finished aggregate
// rather than rebuilding it every time an admin opens the tab.
//
// ---------------------------------------------------------------------------
// Which Square number each figure corresponds to
// ---------------------------------------------------------------------------
//
// Square reports two different bases and they are legitimately different
// numbers. Mixing them silently is how a report stops reconciling, so each
// figure below names the one it uses:
//
//   grossSalesCents    Sum of line-item `gross_sales_money` — BEFORE tax, tips
//                      and discounts. This is what Square's Item Sales and
//                      Category Sales reports call "Gross Sales". Every
//                      per-category and per-title figure uses it, so the pie,
//                      the bars and the day chart all reconcile with each other.
//
//   totalCollectedCents  Sum of order `total_money` — the money that actually
//                      moved, INCLUDING tax and tips. This is Square's "Total
//                      collected". The Total Revenue KPI uses it.
//
// The two will not be equal, and should not be. The gap is tax plus tips.

/** Reporting categories whose line items count as a ticket sold. */
export const TICKET_CATEGORIES = new Set([
  "6 Film Tickets",
  "6 METLive Tickets",
  "6 Live Event Tickets",
  "6 NT Live Tickets",
  "6 Rental Tickets",
]);

/**
 * Reporting categories that count as concessions.
 *
 * The numbered taxonomy splits the concession stand across several categories
 * (`1 Combos`, `2 Candy`, `4 Beer`, `5 Popcorn`, ...) plus three unnumbered
 * ones. The Concession Rev card means "the stand", so it is the union, not just
 * the category literally named `Concessions`.
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

/** variation id -> the reporting-category name of the item that owns it. */
export type CategoryLookup = Map<string, string>;

export interface DayRevenue {
  date: string;
  ticketsCents: number;
  concessionsCents: number;
  otherCents: number;
  totalCents: number;
}

export interface AnalyticsAggregate {
  range: { start: string; end: string };
  totals: {
    totalCollectedCents: number;
    grossSalesCents: number;
    ticketsSold: number;
    avgPerTicketCents: number;
    concessionRevenueCents: number;
    refundCount: number;
    refundCents: number;
  };
  revenueByDay: DayRevenue[];
  revenueByCategory: Array<{ name: string; amountCents: number }>;
  topPerformers: Array<{ title: string; revenueCents: number; count: number }>;
  meta: {
    orders: number;
    lineItems: number;
    /** Lines whose category could not be resolved — see `bucketFor`. */
    uncategorizedLineItems: number;
    /**
     * What those unresolved lines actually are, biggest first.
     *
     * Without this the Uncategorised wedge is unfalsifiable: you can see that
     * revenue went somewhere unnamed but not whether that is a bug in the
     * variation lookup or a genuine uncatalogued sale. `hadCatalogId`
     * distinguishes the two — false means the line never referenced the
     * catalog (a CUSTOM_AMOUNT keyed in at the POS), true means it did and our
     * lookup failed, which IS a bug.
     */
    uncategorizedSamples: Array<{ name: string; hadCatalogId: boolean; amountCents: number; lines: number }>;
    /** True if paging stopped at the page cap before Square ran out of orders. */
    truncated: boolean;
  };
}

const money = (m: any): number => Number(m?.amount ?? 0) || 0;

/**
 * Day key for an order, in the venue's timezone.
 *
 * Deliberately NOT `toISOString().slice(0,10)`, which is what the old
 * build-sourced tab did. Moscow, Idaho is UTC-7/-8, so a 7 PM screening — the
 * single most common showtime in this catalog — lands on the FOLLOWING day in
 * UTC. That silently shifted a whole evening's takings into tomorrow and made
 * every daily total wrong at both ends of the range.
 */
export function venueDay(iso: string, timeZone = "America/Los_Angeles"): string {
  // en-CA formats as YYYY-MM-DD, which is the key format we want.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * CATEGORY object id -> name, from a `/catalog/list?types=CATEGORY` page.
 */
export function categoryNames(objects: any[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const o of objects ?? []) {
    if (o?.type === "CATEGORY" && o?.id && o?.category_data?.name) {
      names.set(o.id, o.category_data.name);
    }
  }
  return names;
}

/**
 * Build variation id -> reporting category name.
 *
 * `variations` are ITEM_VARIATION objects and `items` their parent ITEMs, as
 * returned by `/catalog/batch-retrieve` (`objects` and `related_objects`).
 *
 * Addressing the catalog by id, rather than walking `/catalog/list`, is
 * deliberate and load-bearing. List and search BOTH omit archived items, and a
 * report over any historical range is full of sales against variations that
 * have since been archived — a screening from three months ago is exactly the
 * thing a theatre archives. Walking the catalog would silently file every one
 * of those under "Uncategorised" and under-report ticket counts, with no error
 * to notice. Batch-retrieve returns an object by id whether it is archived or
 * not.
 *
 * It also scales with the range rather than the catalog: a 30-day window
 * touches a few hundred variations, not all ~1,584.
 */
export function buildCategoryLookup(
  variations: any[],
  items: any[],
  categories: Map<string, string>,
): CategoryLookup {
  const itemCategory = new Map<string, string>();
  for (const item of items ?? []) {
    if (item?.type !== "ITEM" || !item?.id) continue;
    const d = item.item_data ?? {};
    // Three shapes, because which one Square populates varies by API version.
    // `reporting_category` first: it is the field Square's revenue reports
    // actually group by, per docs/SQUARE-TRANSACTION-CONVENTIONS.md.
    const categoryId = d.reporting_category?.id ?? d.category_id ?? d.categories?.[0]?.id ?? null;
    const name = categoryId ? categories.get(categoryId) : undefined;
    if (name) itemCategory.set(item.id, name);
  }

  const lookup: CategoryLookup = new Map();
  for (const v of variations ?? []) {
    if (v?.type !== "ITEM_VARIATION" || !v?.id) continue;
    const parent = v.item_variation_data?.item_id;
    const name = parent ? itemCategory.get(parent) : undefined;
    if (name) lookup.set(v.id, name);
  }
  return lookup;
}

export type Bucket = "tickets" | "concessions" | "other";

export function bucketFor(category: string | undefined): Bucket {
  if (category && TICKET_CATEGORIES.has(category)) return "tickets";
  if (category && CONCESSION_CATEGORIES.has(category)) return "concessions";
  return "other";
}

/**
 * Reduce Square orders + refunds to exactly the figures the Overview renders.
 *
 * Aggregating here rather than in the browser is the point of the edge
 * function: a 90-day range is thousands of orders, and shipping them to an
 * admin's laptop to be summed there would be slow and would leak the theatre's
 * full transaction log into a browser tab.
 *
 * `orders` are expected to be COMPLETED only — the caller filters by state, so
 * OPEN (674) and DRAFT (221) orders never reach revenue. Those are carts and
 * unsent invoices, not money.
 */
export function aggregate(params: {
  orders: any[];
  refunds: any[];
  lookup: CategoryLookup;
  range: { start: string; end: string };
  timeZone?: string;
  truncated?: boolean;
}): AnalyticsAggregate {
  const { orders, refunds, lookup, range, timeZone, truncated = false } = params;

  const byDay = new Map<string, DayRevenue>();
  const byCategory = new Map<string, number>();
  const byTitle = new Map<string, { revenueCents: number; count: number }>();

  let totalCollectedCents = 0;
  let grossSalesCents = 0;
  let ticketsSold = 0;
  let ticketRevenueCents = 0;
  let concessionRevenueCents = 0;
  let lineItems = 0;
  let uncategorized = 0;
  const unresolved = new Map<string, { name: string; hadCatalogId: boolean; amountCents: number; lines: number }>();

  for (const order of orders ?? []) {
    totalCollectedCents += money(order?.total_money);

    // closed_at is when the sale completed, which is the instant Square's own
    // reports attribute it to. created_at can be much earlier for an invoice
    // raised weeks before it was paid.
    const stamp = order?.closed_at ?? order?.created_at;
    const day = stamp ? venueDay(stamp, timeZone) : null;
    if (day && !byDay.has(day)) {
      byDay.set(day, { date: day, ticketsCents: 0, concessionsCents: 0, otherCents: 0, totalCents: 0 });
    }
    const dayRow = day ? byDay.get(day)! : null;

    for (const li of order?.line_items ?? []) {
      lineItems++;
      const gross = money(li?.gross_sales_money);
      grossSalesCents += gross;

      const category = li?.catalog_object_id ? lookup.get(li.catalog_object_id) : undefined;
      if (!category) {
        uncategorized++;
        const key = `${li?.name ?? "(unnamed)"}|${li?.catalog_object_id ? "id" : "no-id"}`;
        const row = unresolved.get(key) ??
          { name: li?.name ?? "(unnamed)", hadCatalogId: Boolean(li?.catalog_object_id), amountCents: 0, lines: 0 };
        row.amountCents += gross;
        row.lines++;
        unresolved.set(key, row);
      }
      const bucket = bucketFor(category);

      // A line's quantity is a decimal string ("2", "1.5" for weighed goods).
      const qty = Number(li?.quantity ?? "1") || 0;

      if (bucket === "tickets") {
        ticketsSold += qty;
        ticketRevenueCents += gross;
      } else if (bucket === "concessions") {
        concessionRevenueCents += gross;
      }

      if (dayRow) {
        if (bucket === "tickets") dayRow.ticketsCents += gross;
        else if (bucket === "concessions") dayRow.concessionsCents += gross;
        else dayRow.otherCents += gross;
        dayRow.totalCents += gross;
      }

      // Uncategorised revenue is still revenue, so it is grouped under a name
      // that says so rather than being dropped. A pie chart that quietly omits
      // a slice is worse than one with an honest "Uncategorised" wedge.
      const categoryLabel = category ?? "Uncategorised";
      byCategory.set(categoryLabel, (byCategory.get(categoryLabel) ?? 0) + gross);

      // Top performers group by the item name as sold — the film/production
      // title. `variation_name` is the tier and showtime, which would split one
      // film across a dozen rows.
      if (bucket === "tickets") {
        const title = li?.name ?? "Unknown";
        const row = byTitle.get(title) ?? { revenueCents: 0, count: 0 };
        row.revenueCents += gross;
        row.count += qty;
        byTitle.set(title, row);
      }
    }
  }

  // Square returns every refund in the window regardless of outcome; a FAILED
  // or REJECTED refund moved no money and must not be counted.
  const settled = (refunds ?? []).filter((r) => r?.status === "COMPLETED" || r?.status === "PENDING");
  const refundCents = settled.reduce((s, r) => s + money(r?.amount_money), 0);

  return {
    range,
    totals: {
      totalCollectedCents,
      grossSalesCents,
      ticketsSold,
      avgPerTicketCents: ticketsSold > 0 ? Math.round(ticketRevenueCents / ticketsSold) : 0,
      concessionRevenueCents,
      refundCount: settled.length,
      refundCents,
    },
    revenueByDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    revenueByCategory: [...byCategory.entries()]
      .map(([name, amountCents]) => ({ name, amountCents }))
      .filter((c) => c.amountCents > 0)
      .sort((a, b) => b.amountCents - a.amountCents),
    topPerformers: [...byTitle.entries()]
      .map(([title, v]) => ({ title, ...v }))
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, 8),
    meta: {
      orders: (orders ?? []).length,
      lineItems,
      uncategorizedLineItems: uncategorized,
      uncategorizedSamples: [...unresolved.values()]
        .sort((a, b) => b.amountCents - a.amountCents)
        .slice(0, 15),
      truncated,
    },
  };
}

/**
 * Resolve a named range to an absolute [start, end) in ISO-8601.
 *
 * `now` is injected rather than read from the clock so the resolution is
 * testable and so a caller can pin a range.
 */
export function resolveRange(
  preset: string | undefined,
  now: Date,
  custom?: { start?: string; end?: string },
): { start: string; end: string } {
  if (preset === "custom" && custom?.start && custom?.end) {
    return { start: new Date(custom.start).toISOString(), end: new Date(custom.end).toISOString() };
  }
  const end = now.toISOString();
  if (preset === "ytd") {
    return { start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(), end };
  }
  const days = preset === "90d" ? 90 : preset === "365d" ? 365 : 30;
  return { start: new Date(now.getTime() - days * 86400_000).toISOString(), end };
}
