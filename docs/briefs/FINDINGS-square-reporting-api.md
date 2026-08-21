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

## 3. What to do

**Rewrite `square-analytics` on the Reporting API.** It removes the page cap,
removes the catalog join, and — the real point — makes the numbers *match Square
by construction*, because it is the same engine that draws Square's own reports.
The acceptance criterion stops being a manual comparison and becomes true by
definition.

Keep the current implementation behind it only as long as the beta label
justifies a fallback.

**Until that lands, the deployed Overview under-reports.** It is live and it is
wrong by about a third. Either fast-follow the rewrite or caption the cards.

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
