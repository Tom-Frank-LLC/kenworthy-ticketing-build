---
brief: square-order-falls-back-to-bare-payment
title: Some online sales still register in Square as "Custom Amount", not catalogued line items
status: queued
track: bug
severity: P1
date: 2026-08-28
verified: true
---

# Brief: some online sales still register as "Custom Amount"

**Status:** 🔴 Open. Found 28 Aug 2026 by the first real-card purchase on the
newly live kenworthy.org.
**Prerequisite reading:** `docs/SQUARE-TRANSACTION-CONVENTIONS.md`,
`BRIEF-square-line-items.md` (the work this partially completes), and
`docs/INCIDENT-2026-08-14-square-catalog.md`.

## What was seen

A $9.48 ticket purchase (1 ticket + a $1.00 donation) for *1776 ~ Roots of a
Nation: An Idaho Film Festival* appears in Square as:

```
Custom Amount                                             $9.48
Note: 1776 ~ Roots of a Nation: An Idaho Film Festival — 1 ticket(s) + $1.00 donation
```

**"Custom Amount" plus a note is the signature of a bare `POST /payments`** —
the pre-#103 shape. It is not an order with line items.

The same day, four sales, and they split:

| Time | Square shows | Shape |
|---|---|---|
| 1:14 pm | `The Odyssey — 1 ticket(s)` | ❌ note — bare payment |
| 11:41 am | `1776 ~ Roots of a Nation… — 1 ticket(s) + $1.00 donation` | ❌ note — bare payment |
| 11:15 am | `Silent Film Festival: THE CROWD (Adult - Wednesday…)` | ✅ item (variation) |
| 10:33 am | `HADESTOWN: THE MUSICAL (Adult - Monday…)` | ✅ item (variation) |

So order-then-pay **works** — and then silently degrades for some sales.

In our own admin (`/admin` → transactions) the same sale reads **"Unnamed
item"** until expanded. That is not a second bug: `_shared/transactions.ts:198`
falls back to that string when a line has neither a known `catalog_object_id`
nor a `name`, which is exactly what a bare payment produces. Fix the checkout
and this display resolves itself.

## Why this matters

It is the attribution failure `BRIEF-square-line-items.md` was written to end.
Every sale that takes this path is invisible to Square's item-sales and
category reporting, and the two ledgers agree only on the grand total — the
condition that made the 14 Aug damage so hard to see. **No money is at risk:**
the charge, the ticket and the confirmation email are all correct. This is
reporting, not revenue.

It also means the readiness note written for the domain cutover
(`RUNBOOK-golive-kenworthy-org.md`) was **over-stated**. It recorded "online
sales register catalogued line items" on the strength of the deployed bundle
containing `POST /orders`. The code path being present is not the same as the
order being accepted, and only a real purchase showed the difference.

## The fallback is deliberate, so the question is *which* branch fired

`ticket-checkout/index.ts` treats the order as best-effort and drops to a bare
payment rather than risk charging a different number than the site quoted. That
judgement is right and should not change. There are **four** distinct exits,
each with its own log line — so the first step is not code, it is reading one
log entry.

| # | Condition | Log line |
|---|---|---|
| 1 | our two totals disagree | `order build total <n> != charge <n>; falling back to a bare payment` |
| 2 | Square rejected the order | `order create failed <status> <body>` |
| 3 | Square totalled it differently | `Square totalled <n> but we charge <n>; abandoning order <id>` |
| 4 | the build threw | `order build threw, falling back to bare payment` |

There is also a non-fatal warning worth capturing in the same search, because it
indicates a *different* degradation (a named ad-hoc line, which still reports
badly but does not produce "Custom Amount"):

```
<n> tier(s) had no Square variation for showing <id>; billed as ad-hoc lines
```

## Leading hypothesis — dangling `catalog_object_id` from the Aug 14 restore

Revised 28 Aug after reading the arithmetic. **Branch 1 can be close to ruled
out on inspection**: `expectedTotalCents` and `chargeCents` are equal by
construction. Every ticket's `tax_amount` is `taxCents / 100` where
`taxCents = Math.round(priceCents * TAX_RATE)`, so `Math.round(tax_amount * 100)`
returns exactly `taxCents` again; groups key on `tier|priceCents` so every
member shares one price and one tax; and the processing-fee and donation groups
are added to both sides. The sums cannot drift. `pricing.ts` works in integer
cents precisely to avoid this, and the comment there says so.

That points at **branch 2 — Square rejected the order** — and there is a known
mechanism.

1. The 14 Aug incident deleted catalog variations.
2. `square-variation-restore` put them back, and
   `RUNBOOK-square-catalog-integrity.md:108` records that **restored variations
   come back with new ids** — Square will not reissue a deleted one.
3. **Nothing re-points `showing_square_variations` after a restore.** Searching
   the functions, that table is written only by `square-showing-variations` (the
   mapping front door) and read by `_shared/square-order.ts` and
   `square-cash-sale`. No restore path updates it.

So any showing mapped **before** the damage still stores the **pre-restore id**.
Checkout sends that dead id as `catalog_object_id`, Square rejects the order,
and the code does exactly what it was told to do: log it and charge bare rather
than risk the money. Sales for showings mapped *after* the restore — or never
damaged — go through catalogued, which is why *Silent Film Festival* and
*HADESTOWN* look right on the same day.

This also predicts the failure is **per showing and permanent**, not
intermittent: the same showing will fail every time until its mapping is
repaired. That is a sharper and more falsifiable claim than the tier hypothesis
below, and it should be tested first.

### Demoted: the untiered hypothesis

Both failures showed no tier and both successes showed `Adult`, which first
suggested the single-price path. Keep it as a fallback explanation, but note it
predicts an **ad-hoc named line** (`variationName()` always returns at least the
showtime), *not* the `Custom Amount` that was actually seen. It cannot on its
own produce this symptom.

## Steps

1. **Read the log** for the 11:41 am order (`2qYZ2GcXbz2ucDMjC8VitrSSU9SZY`,
   payment `7BOwpk5h3ekl5kXbY8mEtyVx0ORZY`) — Supabase dashboard → Edge
   Functions → `ticket-checkout` → Logs. If the hypothesis holds it reads
   `order create failed 400 {...}` naming an invalid `catalog_object_id`.
   Everything below assumes that; a different branch means re-plan.
2. **Confirm the id is dead.** Take that showing's `square_variation_id` from
   `showing_square_variations` and retrieve it from Square. A 404 proves it.
   `square-catalog-guard` with `{"action":"check"}` also reports `vanished` and
   writes nothing to Square.
3. **Size it.** Count how many `showing_square_variations` rows point at ids
   Square no longer serves. This decides whether it is a handful of showings or
   most of the catalogue mapping, and therefore whether step 4 is a script or a
   migration.
4. **Re-point the mappings.** Match each stale row to its restored variation —
   `sameVariation()` in `_shared/square-catalog.ts` already compares tier and
   showtime while tolerating both separators, which is exactly the matching
   needed. Prefer re-running the existing `square-showing-variations` front door
   over hand-written SQL.
5. **Close the hole that created it.** A restore mints new ids and leaves our
   mapping pointing at the old ones. Either the restore path should re-point
   `showing_square_variations`, or the guard's `check` should report mappings
   that no longer resolve. Without this, the next restore silently recreates the
   whole problem.

## Degrade per line, not per order

Independent of the cause, one design change is worth making: today a **single**
bad `catalog_object_id` fails the whole `POST /orders`, and the sale loses *all*
attribution — every line, including the ones that were fine.

Falling back per line would be strictly better. A line whose catalog id Square
rejects becomes a **named ad-hoc line** (`variationName()` already produces
`Friday, August 28 at 7 PM`), while its siblings keep their catalog link. The
sale would then read `1776 ~ Roots of a Nation… (Friday, August 28 at 7 PM)` in
Square instead of `Custom Amount` — degraded reporting rather than none.

This does not weaken the money guard, which is the part worth protecting: the
totals are still compared, and a genuine mismatch still falls back to a bare
payment. It only stops one dead id from discarding the attribution of an entire
order.

## Acceptance

- An untiered, single-price showing purchased online appears in Square as a
  catalogued item with its variation, not as "Custom Amount".
- The same sale reads with its real item name in `/admin` transactions.
- Square's Item Sales report attributes it to the right title and category.
- A deliberate mismatch still falls back to a bare payment rather than
  mischarging — the guard survives the fix.

## Related, not covered here

Buyer contact data reaching Square is a separate gap, found in the same
purchase and worth its own brief:

- **Phone is never sent.** `orderRequestBody` populates the digital
  fulfillment recipient with `display_name` and `email_address` only;
  Square's recipient supports `phone_number` and we never set it.
- **Email is sent but hard to find** — it lives on the order's fulfillment
  details, not the receipt or the transaction row.
- **Our own transactions view shows neither**, carrying buyer name alone.

A bare-payment sale has no fulfillment at all, so fixing this brief is a
prerequisite for the contact data appearing on those orders anyway.
