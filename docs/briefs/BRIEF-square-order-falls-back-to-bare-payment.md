---
brief: square-order-falls-back-to-bare-payment
title: Every online sale registers in Square as "Custom Amount" — the DIGITAL fulfillment is malformed
status: queued
findings: confirmed from production logs 28 Aug 2026
track: bug
severity: P0
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

## CAUSE CONFIRMED — 28 Aug 2026, from the production log

Not a hypothesis any more. `ticket-checkout` logged:

```
order create failed 400 {"errors":[{"code":"MISSING_REQUIRED_PARAMETER",
"detail":"Fulfillments of type DIGITAL must have digital_details supplied.",
"field":"order.fulfillments[0].digital_details",
"category":"INVALID_REQUEST_ERROR"}]}
```

`orderRequestBody` (`_shared/square-order.ts:176`) attaches
**`delivery_details`** to a fulfillment of **`type: 'DIGITAL'`**.
`delivery_details` belongs to type `DELIVERY`. Square requires
`digital_details` on a DIGITAL fulfillment and rejects the order without it.

So **branch 2 fires on every attempt**. The order is never created, and the
payment goes through bare — which is exactly the behaviour #103 was written to
eliminate.

### Scope: all three online money paths, not "some sales"

Three callers pass `fulfillment: 'DIGITAL'`, and the parameter defaults to
`'DIGITAL'` when omitted:

| Caller | Covers |
|---|---|
| `ticket-checkout:400` | every online ticket sale |
| `film-pass-checkout:900` | every online film-pass sale |
| `square-donation:204` | every online donation |

All three build the same malformed body, so **every online sale has registered
as a bare `Custom Amount` since #103 shipped on 19 Aug** — the whole point of
that work, defeated by one wrong field name.

The two sales that looked correct the same day (*Silent Film Festival*,
*HADESTOWN*) carry a tier and a variation name, so they came through a
different path — POS, Terminal, or Square Online — not `ticket-checkout`.

`square-cash-sale` passes `IN_STORE` and takes no details block; it also returns
502 rather than falling back, so if it were broken it would be loud. Confirm it
separately rather than assuming.

### Both earlier hypotheses were wrong, and one was wrong usefully

- **Dangling catalog id from the Aug 14 restore**: wrong. The reasoning that
  `showing_square_variations` is never re-pointed after a restore still holds and
  is worth its own brief, but it is not what is happening here.
- **Untiered showings**: wrong as a cause, but it correctly predicted a *named
  ad-hoc line* rather than `Custom Amount` — and the same log confirms that
  problem is real and separate:
  ```
  1 tier(s) had no Square variation for showing 369a2c42-55a2-432d-9229-f4ac8ecc21da;
  billed as ad-hoc lines
  ```
  That showing has no mapping. Once the order actually succeeds, it will sell as
  a named ad-hoc line with no item-sales or category rollup. **Fixing the
  fulfillment exposes this rather than solving it.**

### The fix — measured on the staging sandbox, 28 Aug 2026

A throwaway probe posted seven order shapes to the staging Square sandbox
(`SQUARE_SANDBOX_*`, cannot touch the live catalog). Ad-hoc lines only, so no
catalogue was referenced.

| # | Shape | Result |
|---|---|---|
| A | no `fulfillments` at all | ✅ **200** |
| B | `DIGITAL` + `delivery_details`, `state: COMPLETED` — what ships today | ❌ 400 |
| C | `DIGITAL` + `digital_details: {}` | ❌ 400, same error |
| D | `DIGITAL` + `digital_details.recipient` | ❌ 400, same error |
| E | `PICKUP` + `pickup_details.recipient`, `state: PROPOSED` | ✅ **200, recipient stored** |
| F | `DIGITAL` + `digital_details.recipient`, `state: PROPOSED` | ❌ 400, same error |
| G | as F, but `Square-Version: 2025-01-23` | ❌ 400, same error |

**`DIGITAL` cannot be made to work.** C, D, F and G all supply
`digital_details` and Square still answers *"must have `digital_details`
supplied"* — including under a 2025 API version. Whatever the message says, this
account/API will not accept a DIGITAL fulfillment, so renaming the field would
not have fixed it. Guessing the shape from the error text would have burned a
deploy and produced the same failure.

**A second, independent bug in the same block.** Shape E first failed with
*"Fulfillments must be created with `state` of PROPOSED or HELD"*. Our code
sends `state: 'COMPLETED'`, which is invalid at creation for **every**
fulfillment type. Fixing only the type would have hit this next.

### Recommendation: PICKUP, not "drop the fulfillment"

Both A and E work. **E is better**, and it resolves a second complaint at the
same time:

- Square **stored the recipient** — `display_name` and `email_address` came back
  on the order. That is the buyer contact data that "never reaches Square"
  today, and it lands without any extra call.
- `PICKUP` is arguably more truthful than `DIGITAL` for this theatre anyway:
  the ticket is presented at the door.
- `pickup_details.pickup_at` is required, and there is an obviously correct
  value for it — **the showing's start time** — which makes the order carry the
  showtime as structured data rather than only inside a variation name.

So the change to `orderRequestBody` is:

```
type:  'DIGITAL'          ->  'PICKUP'
state: 'COMPLETED'        ->  'PROPOSED'
delivery_details: {...}   ->  pickup_details: { pickup_at: <showtime ISO>, recipient: {...} }
```

Fall back to shape A (no fulfillments, the `square-invoice` pattern) only if
`pickup_at` turns out to be awkward to thread through every caller —
`square-donation` has no showtime, so it likely wants A regardless.

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
