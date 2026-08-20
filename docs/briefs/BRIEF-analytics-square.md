---
brief: analytics-square
title: The admin Overview reads the theatre's real revenue, from Square
status: needs-triage
track: bug
severity: P2
date: 2026-08-18
shipped_in: ["#142", "#144"]
shipped_at: 2026-08-20
findings: FINDINGS-analytics-square.md
verified: false
---

# Brief (for Claude Code): Wire the analytics Overview to Square (it currently reads empty build tables)

**Status:** 🟡 The Overview renders, but every metric is ~zero because it reads the wrong source.
**Date:** August 18, 2026
**Requested by:** Tom — the admin **Analytics → Overview** shows no results; it isn't reading Square, where the sales actually are.

## Diagnosis (verified in repo)
`src/components/admin/AnalyticsTab.tsx` computes all its KPIs and charts from the build's own tables — `tickets` (`:63`) and `concession_sales` (`:67`). But per `docs/SQUARE-TRANSACTION-CONVENTIONS.md`, the theatre's revenue lives in **Square** (POS, Square Online, the old site): **only 1 order has ever come through the build**. So `tickets`/`concession_sales` are essentially empty and every card — Total Revenue, Tickets Sold, Avg/Ticket, Concession Rev, Refunds, Revenue Over Time, Revenue by Category, Top Performers, Venue Utilization — reads zero. The Overview isn't broken; it's pointed at the wrong source.

This is also the correct long-term source: once `BRIEF-square-line-items.md` lands, the build's own sales register in Square too, so a **Square-sourced** Overview captures *everything* (online + POS + Square Online) in one place. Wiring analytics to Square is the future-proof fix, not a stopgap.

## The fix — a read-only Square analytics function + rewire the tab
### 1. `square-analytics` edge function (read-only, admin-gated)
Productionize the read that the temporary `square-event-probe` already prototyped (`accounting_audit` / `orders_audit` in the conventions doc — that function was never committed; this is its committed, scoped replacement).
- Input: a **date range** (default last 30 days) + optional granularity.
- Pull **`POST /v2/orders/search`** for `COMPLETED` orders (and refunds via `/v2/refunds` or order returns) in the range, paginated (the prototype handled 5–10k orders). Use `_shared/square.ts` (`squareFetch`, `loadSquareConfig`) so env/host/secrets stay consistent.
- Aggregate server-side and return exactly what the Overview needs (below), so the browser does no heavy work.
- **Guardrails (from the 14 Aug incident):** strictly **read-only** — never write `/catalog`, never any non-GET catalog call; admin-gated via `has_role(caller,'admin')`; reuse the shared Square client. It reads the same account `SQUARE_ENV` points at.

### 2. Point `AnalyticsTab` at it
Replace the `tickets`/`concession_sales` queries with a call to `square-analytics`; render the returned aggregates in the existing cards (keep the current chart components/layout). Add a small **date-range selector** (30 / 90 days / YTD / custom) since Square makes any range cheap.

## Metric mapping (Square → the existing cards)
| Card | Square source |
|---|---|
| **Total Revenue** | Σ order `total_money` (or captured payments) in range |
| **Tickets Sold** | Σ line-item quantity where the item's `reporting_category` ∈ `6 Film Tickets`, `6 METLive Tickets`, `6 Live Event Tickets`, `6 NT Live Tickets`, `6 Rental Tickets` |
| **Avg / Ticket** | revenue ÷ ticket count |
| **Concession Rev** | Σ line items in Concessions/`Cafe`/`Cocktails` categories |
| **Refunds** | count/amount of Square refunds in range |
| **Revenue Over Time** | daily Σ order totals across the range |
| **Revenue by Category** | group line items by `reporting_category` (the numbered taxonomy) |
| **Top Performers** | group line items by item/variation **name** (title/showtime), revenue + count |

Two cards don't map cleanly and need a decision:
- **Genre Popularity** — genre is a *build* concept (`movies.genre`, …), not in Square. Drop it, or join Square item → build production by title to recover genre (sparse for legacy items).
- **Venue Utilization** — needs seat **capacity**, which lives on build `showings`, not Square. Either drop, or a **hybrid**: sold counts from Square × capacity from `showings` (only works where the showing exists in the build).

## Decisions for Tom
1. **Source of truth:** Square-only for the money metrics (recommended — it's where the sales are), or **combine** Square + the build tables (double-counts once the line-items brief makes the build write to Square, so *not* recommended after that ships).
2. **Genre & Venue Utilization:** drop both, keep them build-sourced (will stay sparse), or do the title/showings joins to reconstruct them?
3. **Default range + selector:** 30 days default with 90/YTD/custom (recommended)?
4. **Tenders/tips breakdown:** the account has CASH/CARD/WALLET and 1,367 tipped tenders — add a tender-mix card and surface tips, or keep the Overview lean for now?
5. **Caching:** cache the aggregates briefly (e.g. 5–15 min) so opening the tab doesn't re-scan thousands of orders each time?

## Test plan (acceptance = matches Square's own reports)
- With a known range (e.g. last 30 days), the Overview's **Total Revenue and Tickets Sold match Square Dashboard → Reports/Item Sales** for the same range (±rounding) — not just "non-zero."
- Revenue by Category matches Square's category report; Top Performers matches Item Sales' top items.
- Refunds count/amount matches Square's refunds for the range.
- Changing the date range re-queries and the numbers move accordingly.
- The function is **read-only** — a grep/confirm shows it makes no non-GET catalog call and never writes `/catalog`; it's admin-gated (anon/non-admin rejected).
- Empty-but-valid states render cleanly (a range with no sales shows zeros, not a crash).
- `npm run build` + tests pass.

---

## What was built (2026-08-20)

`supabase/functions/square-analytics/` + `_shared/square-analytics.ts`
(aggregation, 15 tests in `_shared/square_analytics_test.ts`), and
`AnalyticsTab.tsx` rewired onto it with a 30 / 90 / YTD / custom range selector.

**Tom's decisions on the five questions:**

1. **Source of truth** — Square only for the money metrics.
2. **Genre & Venue Utilization** — kept, still build-sourced. Both cards now
   carry a caption saying so, because a sparse chart beside a full one otherwise
   reads as a bug rather than as a limit of what the build knows.
3. **Range** — 30 days default, with 90 / YTD / custom.
4. **Tenders/tips** — not surfaced. The data is in the same `/orders/search`
   response, so a tender-mix card can be added later with no extra Square call.
5. **Caching** — 10-minute in-isolate cache, `refresh: true` bypasses it.

**Shipped 2026-08-20.** Edge function deployed to staging and production;
frontend deployed (worker version `0a07041a`, rollback `65d43c47`). Verified
against the live account: 2,377 orders, $45,421.69 collected, 754 tickets.

**The reconciliation FAILED.** Measured against Square's own Reporting API on
20 Aug, these figures are ~35% low (concessions agree; ticket categories are out
2x). Status is `needs-triage`, not `shipped`, because the feature is deployed
and wrong. The tab now says so on screen. Cause not yet found — see
`FINDINGS-square-reporting-api.md` §2 for the three suspects.

**Original note on the reconciliation:** Nobody has yet opened Square
Dashboard → Reports for the same range and confirmed those figures. See
`FINDINGS-analytics-square.md` §4 for the two Square reporting bases the
comparison has to keep straight, and §7 for what the live run exposed.

**Follow-up filed:** the 40-page cap on `/orders/search` is a deferred failure,
not a fix. See `FINDINGS-square-reporting-api.md`.
