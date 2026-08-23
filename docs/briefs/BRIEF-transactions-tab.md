---
brief: transactions-tab
title: A searchable Transactions log of confirmed Square and site sales, with reconciliation
status: built
track: feature
severity: P2
date: 2026-08-18
findings: FINDINGS-transactions-tab.md
verified: false
---

# Brief (for Claude Code): Add a "Transactions" admin tab — searchable log of confirmed Square + site sales

**Status:** 🟢 New admin tab backed by a read-only Square read. No writes anywhere.
**Date:** August 18, 2026
**Requested by:** Tom — a Transactions tab holding a **searchable log of confirmed transactions** (Square and site) with the corresponding data.

## Where the data lives (verified)
- The theatre's transactions live in **Square** — POS, Square Online, invoices, the old site — and per `docs/SQUARE-TRANSACTION-CONVENTIONS.md` that's **99.7% catalogued** with a `catalog_object_id` per line. Square is the complete ledger; it should be the primary source for this log.
- Our build tags site-originated sales with the reconciliation keys already on the tables: `tickets`/`donations` carry `square_payment_id`, `order_token`/`reference_id`, and `payment_method`. So a Square transaction that came from the site can be **joined back** to our rows (which showing, which buyer, our ticket ids) via `reference_id = order_token` and/or `square_payment_id`.
- There is **no committed Square orders/payments read function** yet (only `_shared/square.ts` `squareFetch`, and `square-invoice` which *creates* orders). This tab needs a read-only one — the **same read the analytics brief needs** (`BRIEF-analytics-square.md`); build one function and let both use it.

> **Stale by the time it was executed.** `square-analytics` and
> `_shared/square-reporting.ts` shipped on 20 Aug, two days after this was
> written. They read Square's **Reporting API**, which aggregates server-side
> and returns no per-order rows — so it cannot back a transaction log, and there
> was nothing to share. See `FINDINGS-transactions-tab.md` §1.

## The build
### 1. `square-transactions` edge function (read-only, admin-gated)
- Query **`POST /v2/orders/search`** for orders (COMPLETED, plus refunds/returns) in a date range, **paginated server-side**; enrich with tender/`/v2/payments` detail as needed. Use `_shared/square.ts` (`squareFetch`, `loadSquareConfig`).
- **Join our DB**: for each order, look up `tickets`/`donations` by `reference_id`(=`order_token`) and `square_payment_id` to attach site context (buyer name/email, showing/title, our ticket/order ids, `payment_method`) and a flag `originated_on_site`.
- Return a **page of transaction rows** + total count + facet values for filters. Search/filter/sort happen **server-side** (the account has thousands of orders — never ship them all to the browser).
- **Guardrails (14 Aug incident):** strictly read-only — no non-GET catalog call, never writes `/catalog`; admin-gated via `has_role(caller,'admin')`; reuse the shared Square client (respects `SQUARE_ENV`).

> **Built without `state_filter: ["COMPLETED"]`.** That filter is suspect #1 in
> `FINDINGS-square-reporting-api.md` §2 for a measured 35% revenue shortfall.
> Selection is `hasTender(order)` instead, and `created_at` is filtered rather
> than `closed_at`. `FINDINGS-transactions-tab.md` §2.

### 2. "Transactions" tab (`src/components/admin/TransactionsTab.tsx`, register in `AdminDashboard.tsx`)
A searchable table, one row per transaction:

| Column | Source |
|---|---|
| Date / time | Square order `created_at` |
| Source | Square `source.name` — POS / Square Online / Kenworthy Website / Invoice / Payment Link |
| Tender | CASH / CARD / WALLET (from the payment) |
| Buyer | from our DB join when site-originated (Square rarely carries a customer) |
| Items | line-item names/variations (title · showtime · tier), rolled up |
| Amount / Tax / Tip | order `total_money`, tax, tender tip |
| Status | Completed / Refunded (+ partial) |
| Square ref | order id + `reference_id`; link out to the Square dashboard |
| Site link | when `originated_on_site`, link to our ticket/order |

- **Search + filters:** free-text (buyer, item/title, order/payment id, `reference_id`), date range, source, tender, category, status. Debounced; drives the server query.
- **Row detail** (drawer/expand): full line items with categories, tender breakdown, refund history, and the reconciliation match (which of our rows, if any).
- **Export CSV** of the current filtered result (Decision 4).
- Fits the collapsible-section / readability conventions from the other admin briefs.

## Reconciliation (the high-value extra — Decision 3)
Because the function already joins Square ↔ our DB, it can surface mismatches: a **filter/badge** for *Square transaction with no matching site row* and *site row with no matching Square payment*. That turns this tab into the reconciliation surface the incident work kept needing. Include now, or ship the plain log first and add the mismatch view next.

## Relationship to the other Square briefs
- Shares its read-only function with **`BRIEF-analytics-square.md`** (Overview) — build the Square read once.
- Once **`BRIEF-square-line-items.md`** lands (site checkout writes catalogued orders to Square), site sales appear here **natively** with full category/line-item attribution and `source: Kenworthy Website` — this tab is how you'll watch that go live and reconcile it.

## Decisions for Tom — answered 23 Aug
1. **Primary source:** Square-primary joined with our DB — **taken** (the recommendation).
2. **Default range + retention:** last 30 days with 90 / YTD / custom — **taken**. Capped at 400 days; ranges are venue-local calendar days, matching `square-analytics`.
3. **Reconciliation view:** **include now** — Tom's call. Shipped with a
   `matched` / `square_only` / `site_only` facet, a badge per row, and a
   count-up banner when any `site_only` rows exist.
4. **CSV export:** **yes.** Exports the filtered result set, not the visible
   page — it re-queries with `export: true` (capped at 5,000 rows, and says so
   when it truncates).
5. **Caching:** in-memory, 10 minutes, no migration — Tom's call. **It does not
   work.** Measured: the edge runtime gives every request a fresh isolate, so
   module scope never survives. `square-analytics` has the same problem. A cache
   table is the only fix and is a migration — **open decision**. See
   `FINDINGS-transactions-tab.md` §4.

## Test plan (acceptance = matches Square)
- For a known date range, the tab's transactions **match Square Dashboard → Transactions** in count and totals (±rounding).
- Search by buyer email, film title, and `reference_id`/payment id each return the right rows; filters by source/tender/status/date narrow correctly; sorting works.
- A **site-originated** sale shows its buyer + showing (DB join) and links to our order; a **POS/Square Online** sale shows with no site link.
- A **refunded** order shows Refunded with the refund in the detail.
- Reconciliation (if included): a deliberately unmatched case shows in the mismatch filter.
- The function is **read-only** (grep confirms no `/catalog` write, no non-GET catalog call) and admin-gated (anon/non-admin rejected); large ranges stay paginated (browser never receives thousands of rows at once).
- `npm run build` + tests pass.

### Where the test plan stands

Verified against staging with a real admin JWT — auth gates, the DB join,
multi-ticket collapse, mismatch detection (5 real cases), search by every key,
all filters and sorts, paging, export, range guards, and the read-only guardrail
(now an enforced test, not a grep). Full table in
`FINDINGS-transactions-tab.md` §5.

**Outstanding:** the headline criterion — matching Square's own totals — needs
**production**. Square's Reporting API is production-only, and staging's sandbox
has no real sales to match. The function now runs that comparison itself on
every load and reports both figures as `cross_check`; on staging it correctly
reports why it cannot. Also unverified on production: real-volume performance,
and whether production isolates are reused (Decision 5).
