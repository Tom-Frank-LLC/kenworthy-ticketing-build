# The Reporting API, and why the Overview's numbers are low

**20 August 2026.** Written after shipping `square-analytics` (#142, #144) and
then measuring it against Square's own reporting engine.

Two findings, one good and one bad, and they are the same finding:

1. Square has a **Reporting API** that aggregates server-side with no
   pagination and a native category dimension. It answers the "don't just kick
   the pagination can down the road" question completely.
2. Running it revealed that **the Overview we just shipped under-reports
   revenue by roughly a third.** The acceptance test does not pass.

## 1. The Reporting API exists, and our token already works

Square shipped a Cube-based Reporting API to **open beta in April 2026**. Two
endpoints — `/reporting/v1/meta` (schema) and `/reporting/v1/load` (query) — on
the `connect.squareup.com` host, *not* under `/v2`.

Measured against the live account with `square-reporting-probe`:

- **Reachable with the access token we already hold.** No `REPORTING_READ`
  OAuth scope needed, no new secret, no application change.
- **82 cubes**, including `ItemTransactions`, `Sales`, `PaymentAndRefunds`,
  `CatalogCategory`, `CatalogItem`, `CatalogItemVariation`.
- `ItemTransactions` carries **`category_name`** and `combo_aware_category_name`
  as dimensions, alongside `item_name`, `item_variation_name`, `item_id`,
  `item_variation_id`.
- Measures include `sales_gross_amount`, `sales_net_amount`,
  `items_sold_count`, `returns_gross_amount`, `returns_quantity`,
  `item_tax_money`, `item_discount_money`.

### What that replaces

Our function does two expensive things the Reporting API makes unnecessary:

- **The paging loop** over `/v2/orders/search`, capped at 40 pages / 20,000
  orders. The cap is a deferred failure — correct today, silently short at some
  future range.
- **The catalog `batch-retrieve` join**, which exists *only* because order line
  items do not carry a category (see `FINDINGS-analytics-square.md` §2). It is
  the most fragile part of the function, and `category_name` deletes the whole
  problem — including for archived items, which is what forced address-by-id in
  the first place.

One `POST /reporting/v1/load` returns revenue grouped by category for any range.

### Practical notes

- **The query must be wrapped in `{"query": {...}}`.** Without it: `Query param
  is required`.
- **`/load` is asynchronous.** While computing it returns **HTTP 200** with a
  body of `{"error":"Continue wait"}` rather than results. A naive caller reads
  a 200, finds no rows, and reports zero. Poll until it resolves.
- Names are fully qualified: `ItemTransactions.sales_gross_amount`.
- `dateRange` takes `["2026-07-21","2026-08-20"]` or `"last 30 days"`.
- Amounts come back as **decimal dollars**, not integer cents.
- Standard cubes refresh on a **~15 minute** interval, so it is not real-time.
- It is **open beta**. That is the main argument for caution.

## 2. The bad news: our numbers are low

Same nominal window (21 Jul – 20 Aug 2026):

| | ours | Square | gap |
|---|---|---|---|
| gross sales | $44,355.52 | **$68,217.98** | **−35%** |
| items sold | 754 tickets | 6,355 items | — |
| film tickets (qty) | 754 *(all ticket categories)* | **1,497** *(`6 Film Tickets` alone)* | **−50%+** |

Per category, the picture is diagnostic:

| category | ours | Square |
|---|---|---|
| `4 Beer` | $2,354.50 | $2,354.50 — **exact** |
| `2 Candy` | $2,848.50 | $2,948.50 |
| `5 Popcorn` | $3,725.50 | $3,790.00 |
| `3 Soda` | $4,397.00 | $4,513.50 |
| `6 Film Tickets` | $5,420.00 | **$11,870.00** |
| `Uncategorized` | $8,117.52 | **$28,747.48** |

Concessions agree to within a percent or two — consistent with a window edge,
since our range is a rolling 30 days from the request instant while Square's is
calendar days in venue-local time. **Tickets and the uncategorised bucket do
not agree at all**, and no window shift explains a 2× gap.

### What this rules in and out

- Not truncation: `meta.truncated` was `false`.
- Not the category join alone: if lookups were failing, our *uncategorised*
  figure would be too high. It is too **low**, by $20k.
- Both our gross **and** our uncategorised are short, so we are most likely
  **missing whole line items or whole orders**, not mis-filing them.

The leading suspects, in order:

1. **`state_filter: ["COMPLETED"]`.** The conventions doc counts 674 `OPEN` and
   221 `DRAFT` orders per ~5,000. If `OPEN` includes paid-but-unclosed checks,
   we drop real revenue.
2. **Filtering on `closed_at`.** Any order with a null `closed_at` is invisible
   to a `closed_at` date filter — it cannot match a range at all.
3. **`gross_sales_money` missing on some line items**, silently summing as 0.

None of these is confirmed. That is the next session's first job, and the
Reporting API is now the instrument to check against.

## 3. Done — rewritten, 20 Aug

`square-analytics` now runs entirely on the Reporting API. The
`/v2/orders/search` paging loop, the `/catalog/batch-retrieve` join and
`_shared/square-analytics.ts` are deleted; `square-reporting-probe` is deleted
and undeployed.

Five server-side aggregates run in parallel — totals (`Sales`), category×day
(`ItemTransactions`), top performers, the Uncategorized breakdown, and refunds
(`PaymentAndRefunds`). Measured on production:

| range | orders | wall clock | buckets |
|---|---|---|---|
| 30 days | 2,719 | 3.3 s | 30 days |
| 90 days | 9,043 | 1.8 s | 89 days |
| **year to date** | **22,243** | **1.7 s** | 8 months |

**YTD is the point.** 22,243 orders is past the old 20,000-order cap — the
previous implementation would have truncated and shown a short total. There is
now no pagination to cap.

Ticket counts more than doubled (754 → 1,680 for 30 days), which is the
under-reporting bug going away rather than a change in the theatre's business.

An empty range returns clean zeros. Long ranges switch to month granularity so
the chart stays readable.

### Two things learned in the rewrite

- **`order` is rejected.** Cube's object form (`{"Measure":"desc"}`) comes back
  as a bare `Invalid request` with no indication of the offending field. `limit`
  alone is accepted, so ordering is done in `shape()`. Errors now carry the
  query name, because a 400 with five parallel queries is otherwise unattributable.
- **The Reporting API is production-only.** `connect.squareupsandbox.com/reporting/v1/meta`
  returns **404** — the sandbox does not serve it. The function detects a
  non-production environment and says so plainly rather than surfacing an
  upstream error. Staging's sandbox has no sales history to report on anyway,
  but it does mean **the Overview cannot be exercised on staging at all**.

### What the Uncategorized wedge turned out to be

Square's own breakdown, which the tab now renders: `Theater Rental` ($9,000),
`Fall Fundraiser Ticket` ($5,700), `Rehearsal Hours`, and similar. Real
uncatalogued items keyed in at the POS — not a defect in our lookup, which is
what the previous implementation could not distinguish.

## 4. Industry practice, for the record

The pattern across payment platforms is consistent, and the Kenworthy is at the
easy end of it:

- **Aggregate at the source when the vendor offers it.** Square's Reporting API,
  Shopify's ShopifyQL/Analytics, Stripe Sigma are all "let the vendor's
  warehouse do the GROUP BY". Paginating raw transactions to sum them in your
  own process is the fallback, not the default.
- **Where no reporting endpoint exists, sync incrementally into your own store
  and query that.** Pull once by cursor, then keep current with webhooks
  (`order.created` / `order.updated`) plus a scheduled reconciliation pass.
  Dashboard reads then hit your database, so cost scales with *new* orders
  rather than with range length.
- **Webhooks alone are not a pipeline.** Delivery is at-least-once with no
  ordering guarantee, so anything built on them owns idempotency, replay and
  backfill forever. The consensus is webhooks for freshness, scheduled sync for
  correctness.
- **Don't over-sync.** Hourly for transactions, daily for aggregates; sub-15-minute
  polling adds load without adding information — which matches Square's own
  ~15-minute cube refresh.

For our volume — a few thousand orders a month — the Reporting API alone is
sufficient. The incremental-sync architecture is the answer if we ever outgrow
it or need sub-15-minute freshness, and it is worth knowing we do not need it
yet.

## 5. Method note

The docs do not document `ItemTransactions`' dimensions; the schema explorer and
`/reporting/v1/meta` do. This was measured, not inferred — deliberately, because
inferring a vendor limitation from documentation instead of testing it is
exactly fault 3 in `docs/INCIDENT-2026-08-14-square-catalog.md`. The check cost
one probe function and about ten minutes, and it overturned the shipped
implementation.

Sources: [Reporting API overview](https://developer.squareup.com/docs/reporting-api/overview) ·
[Getting started](https://developer.squareup.com/docs/reporting-api/getting-started) ·
[Query construction](https://developer.squareup.com/docs/reporting-api/query-construction) ·
[Core cubes](https://developer.squareup.com/docs/reporting-api/cubes/core-cubes) ·
[Open beta announcement](https://developer.squareup.com/forums/t/reporting-api-open-beta/25897)
