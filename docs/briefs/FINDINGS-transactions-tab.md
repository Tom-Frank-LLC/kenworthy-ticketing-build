# What building the Transactions tab established

**23 August 2026.** Written after building `square-transactions` and the
Transactions tab, and measuring both against staging.

Four findings. One **closes** the open question from
`FINDINGS-square-reporting-api.md` §2 and replaces it with a narrower one; one
invalidates a decision that had already been made on this brief; one is a stale
premise in the brief itself.

**The headline, measured on production (§8):** order counts now agree with
Square within ~1% at every window from 7 days to year-to-date — the old
implementation counted 2,377 where Square counted 2,894. `state_filter:
["COMPLETED"]` was the cause, confirmed: the `OPEN` orders it discarded are
worth $13,499 of a $49,200 month.

The money was a different story, and its resolution is the lesson. Our sum of
the fetched rows disagreed with Square by an amount that **changed sign** —
−30% over 7 days, +17% in June, +0.6% over 180 days — because we range on when
an order was rung up and Square ranges on when it collected. The first instinct
was to explain that on screen. The right answer was to **stop summing and ask
Square**, which is what `square-analytics` had already concluded and what this
now does. A closed month matches Square to the cent because it is Square's
number.

## 1. The brief's premise was already out of date

`BRIEF-transactions-tab.md` says there is "no committed Square orders/payments
read function yet" and instructs: build one read-only function and let this tab
and `BRIEF-analytics-square.md` share it.

By the time it was executed that was no longer true. `square-analytics` shipped
on 20 August (#142, #144, #145, #147) along with `_shared/square-reporting.ts`.
So there was nothing to share — and, more importantly, nothing that *should* be
shared:

| | needs | endpoint |
|---|---|---|
| `square-analytics` | aggregates for a range | Reporting API (`/reporting/v1/load`) |
| `square-transactions` | individual orders with line items, tenders, `reference_id` | `/v2/orders/search` |

The Reporting API aggregates server-side and returns no per-order rows, so it
cannot back a transaction log. `/v2/orders/search` returns orders but its own
totals were measured 35% low. **Both are needed, and they are different reads.**
The two functions share `_shared/square.ts` and the venue-local range
convention, and nothing else.

*Lesson, again: check what is committed before building to a brief's "there is
no X". This one was four days stale.*

## 2. The 35% shortfall: `state_filter` is now avoidable, not merely suspected

`FINDINGS-square-reporting-api.md` §2 measured the old orders-based analytics at
**35% below** Square's own figure and left three suspects, unconfirmed, as "the
next session's first job":

1. `state_filter: ["COMPLETED"]` dropping paid-but-unclosed checks
2. filtering on `closed_at`, which a null `closed_at` can never match
3. `gross_sales_money` missing on some line items

A transaction log cannot dodge the question the way the analytics rewrite did —
it needs the individual orders. So `square-transactions` avoids all three by
construction:

- **No `state_filter` at all.** Selection is `hasTender(order)` — an order with
  a tender is a payment, whatever its state says. An abandoned cart has none.
- **Filters on `created_at`**, never `closed_at`.
- **Never sums line items** to get an order total; reads `total_money`.

The order `state` is carried on every row and is a facet, so an `OPEN` check is
visible rather than silently included or silently dropped. The count of
untendered orders excluded is returned as `untendered_orders` — on staging's
sandbox, 29 excluded against 19 kept, so this is not a small population.

**Suspect 1 is now confirmed, on production — see §8.** In a 30-day window the
`OPEN` orders this rule keeps are worth **$13,499.40** against a total of
$49,199.62. `state_filter: ["COMPLETED"]` was discarding roughly **28% of
revenue**, which is the right order of magnitude for the measured 35%.

## 3. The tab cross-checks itself against Square, every load

The brief's acceptance test is "matches Square Dashboard → Transactions in count
and totals" — a manual check somebody does once and never repeats.

Instead, `square-transactions` runs `totalsQuery()` from
`_shared/square-reporting.ts` for the same range and returns both figures as
`cross_check`. The Reporting API *is* the engine behind that dashboard, so a
disagreement here is a disagreement with Square. The tab renders it as a line of
provenance under the table.

This also turns §2 into a measurement. If `deltaCents` sits near zero across
ranges on production, dropping `state_filter` was the fix and
`FINDINGS-square-reporting-api.md` §2 can be closed.

**Not yet run against production.** The Reporting API is production-only —
`connect.squareupsandbox.com/reporting/v1` is a 404 — so on staging
`cross_check.available` is `false` with that as the reason. **This is the one
acceptance criterion still outstanding**, and it needs a production deploy.

## 4. The in-memory cache does not work, and neither does `square-analytics`'s

Decision 5 on the brief chose "in-memory cache, 10 min, no migration" over a DB
cache table. **Measured on staging: it never hits.**

The function now returns an `isolate` block — a module-scope `BOOT_ID` and a
per-isolate request counter — added specifically to tell a caching bug apart
from a platform property. Six sequential requests for an identical range:

```
call 1: boot=d60ee617 served=1 ranges_held=1 cached=False
call 2: boot=a60976bb served=1 ranges_held=1 cached=False
call 3: boot=e46774cd served=1 ranges_held=1 cached=False
call 4: boot=18646822 served=1 ranges_held=1 cached=False
call 5: boot=c2d2f085 served=1 ranges_held=1 cached=False
call 6: boot=abd19a46 served=1 ranges_held=1 cached=False
```

`boot` changes every time and `served` is always 1: **the edge runtime hands
each request a fresh isolate.** Module scope does not survive between requests,
so no in-memory cache of any design can hit. Concurrent requests behave the
same way.

Consequences:

- **`square-analytics` caches identically** (`const cache = new Map(...)` at
  module scope, 10-minute TTL) and is therefore in the same position. Its
  `cached: true` branch has, in all likelihood, never been taken. Nobody has
  measured it, because it does not return an isolate id — that is why this one
  does.
- Each keystroke-pause in the search box re-scans Square. On staging that is
  ~1.4 s. On production a 30-day range is ~2,700 orders — six pages plus the
  catalog listing — so it will be materially slower.
- The mitigation Decision 5 rejected (a cache table) is the only one that can
  work, and it is a migration. **Not done; it needs a decision, not a
  side-effect.**

The cache is kept: it costs nothing, it is correct if isolates are ever reused,
and a warmer production project may behave differently — untested. `isolate` is
in the payload so this is checkable rather than remembered. **If `served` ever
climbs above 1, the cache has started working.**

## 5. What was verified, and how

Against staging (`rpqzrpboyhshdrfdwayk`, Square **sandbox**), calling the
deployed function with a real admin JWT minted via `generate_link` + `verify`
(`token_hash`, not `token` — the plain-token form is rejected with
`validation_failed`):

| check | result |
|---|---|
| unauthenticated POST | 401 |
| anon key as bearer | 401 |
| admin JWT | 200, 24 rows |
| DB join | `match` resolved showing titles, tokens, ticket ids |
| multi-ticket order | 3 tickets on one token collapsed to 1 row |
| mismatch detection | 5 `site_only`, confirmed in the DB as `status=confirmed`, `payment_method=online`, `square_payment_id=null` |
| search | by order token, payment id, film title, buyer email, two terms across different fields |
| filters | source, tender, reconciliation |
| sort / paging / export | all four sorts, `page_size`, `export: true` |
| range guards | reversed range and >400 days both refused |
| empty range | clean zeros, no crash |
| read-only | asserted by `square-transactions/readonly_test.ts`, which parses the source |

**Not verified:** anything requiring production — the Reporting API
cross-check, real-volume performance, and whether production isolates are
reused.

## 6. The read-only guardrail is enforced, not documented

After 14 Aug, "no non-GET catalog call" has been a rule written in comments.
`square-transactions/readonly_test.ts` parses the function's own source, extracts
every `squareFetch(config, …)` call with its method, and fails if a `/catalog`
call is anything but GET or if any non-GET call is not the documented
`POST /orders/search` read. It also asserts the anon-key rejection and the
`has_role(..., 'admin')` check are present.

It self-skips without `--allow-read`, so the documented
`deno test --allow-env supabase/functions` stays green. **CI should run
`deno test --allow-env --allow-read supabase/functions`** or the guardrail is
inert. The regex was probed against known violations
(`POST /catalog/batch-retrieve`, `PUT /catalog/object`, `POST /payments`) before
being trusted.

## 8. On production: counts match, money is a DATE question

Deployed to production 23 Aug and measured against the live account with an
admin JWT. This is the acceptance test §3 was built to run.

### The order count now agrees with Square, at every window

| window | Square orders | ours | Δ |
|---|---:|---:|---:|
| 7 days | 786 | 784 | −0.3% |
| 30 days | 2,825 | 2,838 | +0.5% |
| 90 days | 8,910 | 8,988 | +0.9% |
| 180 days | 15,858 | 15,963 | +0.7% |
| year to date | 22,720 | 22,887 | +0.7% |

For contrast, the implementation `FINDINGS-square-reporting-api.md` measured
counted **2,377 where Square counted 2,894**. Dropping `state_filter` closed
that. **Suspect 1 is confirmed.** In the 30-day window:

| order state | orders | value |
|---|---:|---:|
| COMPLETED | 2,292 | $35,109.38 |
| **OPEN** | **526** | **$13,499.40** |
| CANCELED | 20 | $590.84 |

The `OPEN` orders are overwhelmingly Square Online, and they are real money —
paid checks nobody closed out. Excluding them, as the old filter did, loses 28%
of the window's revenue on its own.

### The money still differs — but it changes sign, so it is not missing

| window | Square | ours | Δ |
|---|---:|---:|---:|
| 7 days | $19,347.91 | $13,553.87 | **−29.95%** |
| 30 days | $57,597.61 | $49,199.62 | −14.58% |
| 90 days | $168,053.51 | $158,494.23 | −5.69% |
| **180 days** | **$281,804.41** | **$283,507.85** | **+0.60%** |
| year to date | $401,277.86 | $392,673.96 | −2.14% |
| Jan 2026 | $78,752.84 | $71,994.28 | −8.58% |
| Apr 2026 | $29,663.67 | $30,363.93 | +2.36% |
| **Jun 2026** | **$49,993.71** | **$58,725.12** | **+17.47%** |

**A shortfall that becomes a surplus is not a shortfall.** Over 180 days the
two agree to 0.6%. The money is not missing; it is in a different bucket.

Ruled out along the way, on the live 30-day set:

- **Not tenders disagreeing with orders.** Tenders equal `order.total_money`
  exactly on all 2,838 orders — zero exceptions.
- **Not tips.** $1,492.39 of them, already inside `order.total_money`.
- **Not truncation.** `notes` empty, `truncated` false.

### The cause: we date a sale when it was rung up, Square when it collected

We filter and display `order.created_at`. Square's `Sales` cube ranges on its
own reporting timestamp — when the money came in. For a POS sale those are the
same instant. For an **invoice** they are weeks apart: it is created when
drafted and paid whenever the customer gets round to it. This account's
invoices average **$565.81**, so a handful landing either side of a boundary
moves a month's total by thousands.

That explains every feature of the table: worst over 7 days (few offsetting
orders), converging as the window widens, and sign-flipping by month depending
on which side of the boundary that month's invoices fell.

### Resolved: stop doing the arithmetic

The first response to this was to explain it — a `cross_check` block reporting
both figures, a paragraph under the table about why they differed, and a
`collectedAt` on every row. All of that was machinery for describing a
discrepancy rather than removing one.

Tom's call, and it is the right one: **take the numbers from Square instead.**

`squareTotals()` now asks `/reporting/v1/load` for the range — `Sales` for what
was collected, `PaymentAndRefunds` for what went back out — and those are the
figures on the cards. `totalsFor()` is deleted from `_shared/transactions.ts`
and its tests with it. Nothing on the screen adds money up any more, so nothing
can disagree with Square.

This is the same move `square-analytics` made (§3 of
`FINDINGS-square-reporting-api.md`): *"Rather than hunt that bug, we deleted the
arithmetic."* It had already been made once in this repo and was worth making
again rather than re-deriving.

Measured after the change, against the live account:

| range | cards now show | Square | our old sum |
|---|---:|---:|---:|
| Jun 2026 | **$49,993.71** | $49,993.71 | $58,725.12 |

A closed month matches to the cent, because it *is* Square's number.

Two things came free with it:

- **Refunds appear.** The row-sourced figure was $0.00 for every range, because
  `/v2/orders/search` does not populate `order.refunds`. Square's
  `PaymentAndRefunds` cube does: $63.21 across 4 in the last 30 days.
- **No pagination limit on the money.** The totals are a server-side aggregate,
  so they are correct even for a range whose rows would be truncated.

### The shape this leaves

Two Square endpoints, one job each:

| | source | scope |
|---|---|---|
| summary cards | `/reporting/v1/load` | the whole **range**, unfiltered |
| table rows | `/v2/orders/search` | filtered, searched, sorted, paged |

**The cards deliberately do not narrow with the filters.** Verified on
production — filtering to CASH (636 rows), searching "popcorn" (665 rows) or
`site_only` (12 rows) leaves the collected figure at $57,669.21 throughout,
while the row count moves. Filtering the table does not change what the theatre
took last month, and re-summing under the same heading is how a filtered view
ends up quoted as a month's revenue. The pager reports the filtered count, so
the two are never confused.

`collectedAt` stayed. It is a fact about a transaction, not part of the
explaining apparatus, and it is what makes an invoice legible: the table shows
"paid *date*" when the two differ, and the CSV carries both.

On staging the cards say plainly that Square's Reporting API is
production-only; the rows still render, because they come from the other
endpoint.

## 7. Why `GET /v2/catalog/list` and not `batch-retrieve`

Order line items carry no category, so a category column needs a catalog
lookup. `POST /v2/catalog/batch-retrieve` is the natural call and is read-only
in effect — but the standing rule is *no non-GET catalog call of any kind*, and
honouring that literally costs one extra page fetch and removes the whole class
of mistake. The index is built from `GET /v2/catalog/list?types=ITEM,CATEGORY`.

`list` omits archived objects and this account has years of retired showtimes,
so older line items resolve no category. That is deliberate and degradable: a
missing category leaves the column blank and never hides a transaction.
