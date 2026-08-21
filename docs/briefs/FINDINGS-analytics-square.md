# Reading the theatre's revenue out of Square

**20 August 2026.** What had to be established to point the admin Overview at
Square, including three things the brief got wrong or did not know. Written so
the next session does not re-derive them.

Companion to `docs/briefs/BRIEF-analytics-square.md`.

## 1. The prototype *was* committed

The brief says of `square-event-probe`: *"that function was never committed;
this is its committed, scoped replacement."* It is committed, and it has been
all along — `supabase/functions/square-event-probe/index.ts`, with both
`accounting_audit` (line 353) and `orders_audit` (line 421) intact.

That matters beyond pedantry. Working code in the repo is the authoritative
reference for how to call Square, and believing it was gone would have meant
re-deriving the `/orders/search` paging shape from vendor docs. It was there to
copy.

The general lesson is the one this project keeps re-learning: **an inherited
claim that something is missing or impossible is a claim, not a fact.** Checking
this one cost one `ls`.

## 2. Order line items do not carry a reporting category

This is the finding that shapes the whole function.

A Square order line item carries a `catalog_object_id` — an ITEM_VARIATION id —
plus the name and price captured at the time of sale. It does **not** carry the
category. The category lives on the *item* that owns the variation, in the
catalog.

So every per-category figure the brief asks for — Tickets Sold (defined as line
items whose `reporting_category` is one of the five ticket categories), Revenue
by Category, Concession Rev — requires a **variation → item → category** join
against the catalog. It cannot be read off the orders.

The prototype hit the same wall and left the evidence in place, at
`square-event-probe/index.ts:398`:

```ts
const c = li.catalog_object_id ? null : null;
tally(cat, li.item_type === "CUSTOM_AMOUNT" ? `CUSTOM: ${li.name ?? "?"}` : "(catalog)");
```

A lookup stubbed to `null`, and a category tally that therefore only ever
records "(catalog)". That is why the conventions doc reports line-item *types*
and never a revenue-by-category breakdown.

## 3. The catalog must be addressed by id, never walked

The obvious way to build that lookup is to list the catalog and index it. That
is wrong here, and wrong silently.

`/catalog/list` and `/catalog/search` **both omit archived items.** A report over
any historical range is full of sales against variations that have since been
archived — archiving a finished screening is exactly what a theatre does. Walking
the catalog would file every one of those under "Uncategorised", under-report
ticket counts, and raise no error.

`/catalog/batch-retrieve` returns an object by id whether it is archived or not.
So the function collects the distinct `catalog_object_id`s actually referenced
by the orders in range, batch-retrieves them (≤900 per call) with
`include_related_objects: true` — which returns the parent ITEMs — and builds the
map from that. It also scales with the *range* rather than the catalog: a 30-day
window touches a few hundred variations, not all ~1,584.

Items name their category in three different shapes depending on API version, so
all three are read, `reporting_category` first because that is the field Square's
revenue reports group by:

```ts
d.reporting_category?.id ?? d.category_id ?? d.categories?.[0]?.id
```

Anything that still fails to resolve is grouped under an explicit
**"Uncategorised"** wedge and counted in `meta.uncategorizedLineItems`. Dropping
it would make the pie disagree with the total with nothing to notice. A
persistently non-zero count there means the lookup is missing something and is
worth investigating.

## 4. Two Square reporting bases, and they are not interchangeable

Square reports two different numbers, and the acceptance test ("matches Square's
own reports") only passes if the comparison keeps them straight:

| our field | = | Square calls it |
|---|---|---|
| `grossSalesCents` | Σ line-item `gross_sales_money` | **Gross Sales** (Item Sales, Category Sales) — before tax, tips, discounts |
| `totalCollectedCents` | Σ order `total_money` | **Total collected** — including tax and tips |

The gap between them is tax plus tips, and 4,603 of 5,000 recent orders carry
tax, so the gap is large and constant. The Total Revenue KPI uses *collected*;
every per-category, per-title and per-day figure uses *gross*, so the pie, the
bars and the day chart all reconcile with each other. A test asserts that they
sum to the same number.

**When comparing against the dashboard, compare like with like.** Total Revenue
against "Total collected"; Revenue by Category against the Category Sales report's
gross figures.

## 5. `closed_at`, not `created_at`

Orders are filtered and sorted on `closed_at`. Square requires the sort field to
match the field a `date_time_filter` filters on, so this is partly forced — but
it is also correct: `closed_at` is when the sale completed, which is the instant
Square attributes the money to. `created_at` can be weeks earlier for an invoice
raised long before it was paid, which would file the revenue in the wrong month.

Only `COMPLETED` orders are counted. `OPEN` (674) and `DRAFT` (221) are carts and
unsent invoices; `CANCELED` (75) never completed. Refunds come from
`GET /refunds`, and only `COMPLETED`/`PENDING` ones count — a `FAILED` or
`REJECTED` refund moved no money.

## 6. A bug inherited from the old tab: UTC day bucketing

The previous build-sourced code bucketed revenue by day with

```ts
new Date(t.purchased_at).toISOString().slice(0, 10)
```

Moscow, Idaho is UTC-7/-8. A **7 PM screening** — the single most common showtime
in this catalog — is 02:00 the *next day* in UTC. That silently shifted a whole
evening's takings into the following day, and truncated both ends of any range.

The replacement formats in `America/Los_Angeles` via `Intl.DateTimeFormat`
(`en-CA` gives `YYYY-MM-DD` directly). There is a test pinning the 7 PM case.

This was invisible while the tables were empty. It would not have stayed
invisible once real money flowed through it.

## 7. Measured against the live account, 2026-08-20

Deployed to production and called with an admin session, 30-day range
(21 Jul – 20 Aug 2026). It works, in ~12 s uncached:

| | |
|---|---|
| orders | 2,377 |
| line items | 4,070 |
| distinct variations resolved | 96 |
| total collected | $45,421.69 |
| gross sales | $44,355.52 |
| tickets sold | 754 |
| avg / ticket | $9.38 |
| concessions | $14,829.50 |
| refunds | 4, $63.21 |

The gap between collected and gross is $1,066.17 — tax and tips, as expected.

**Two things this exposed.**

**a) "Uncategorised" is the largest single category: $8,117.52, ~18% of gross.**
194 of 4,070 lines. The conventions doc measured 99.7% of line items as
catalogued over a 5–10k order sample; over this 30-day window it is 95.2%. The
doc's figure is not wrong, but it should not be relied on as "essentially all".

A wedge that large cannot ship unexplained, so `meta.uncategorizedSamples` now
breaks it down and the tab renders it. The column that matters is
`hadCatalogId`:

- `false` — the line never referenced the catalog. A CUSTOM_AMOUNT keyed in at
  the POS. Genuinely uncategorisable, and nothing to fix.
- `true` — the line *did* point at a variation and our lookup failed to resolve
  it. **That is a bug**, and the number should be zero.

Whoever next opens this: read that breakdown first. It is the difference between
"the theatre keys a lot of sales in by hand" and "the category join is broken".

**b) `Theater Rental` is a real category that the conventions doc does not
list.** It took $7,827.50 in the window — the second largest after the
Uncategorised wedge. The numbered taxonomy in
`SQUARE-TRANSACTION-CONVENTIONS.md` is therefore **incomplete**, not merely
ordered. It is correctly bucketed as neither a ticket nor a concession (it is
the venue hire fee, distinct from `6 Rental Tickets`), so no figure is wrong —
but any future work that assumes the documented list is exhaustive will be.

## 8. What is NOT verified

**The numbers above have not been reconciled against Square's own reports.**
The function returns plausible, internally consistent figures from the live
account, but nobody has yet opened Square Dashboard → Reports for 21 Jul – 20 Aug
and checked that $45,421.69 and 754 tickets are what Square says.

That comparison is the brief's actual acceptance criterion and it is the one
step still outstanding. **Compare like with like** (§4): Total Revenue against
"Total collected", Revenue by Category against the Category Sales report's gross
figures.

**The frontend is not deployed.** The edge function is live on staging and
production; the rewired tab is on `main` but not shipped, so the Overview an
admin sees today is still the old build-sourced one.

## Checks

`tsc -p tsconfig.app.json --noEmit` clean · `vitest` 266 passed / 27 files ·
`deno check` clean on both new files · 15 new `deno test` cases.

`deno test --allow-env supabase/functions` fails to *type-check* the whole
directory on `npm:pngjs@7.0.0`, imported by `_shared/tickets_test.ts:106`. That
is pre-existing on `main` and unrelated to this work; the new tests run clean
when the file is targeted directly.
