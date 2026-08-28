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

## Leading hypothesis — untiered showings

Both failures show **no tier**; both successes show **`Adult`**. That points at
the single-price path, where `canonicalTier()` returns `''` and
`variationName()` returns the bare showtime.

Treat this as a hypothesis, not a finding. It is drawn from four data points and
the two failing sales differ in another way too — one carried a donation and one
did not, which at least rules the donation out as the sole cause. `The Odyssey`
having no donation is the useful control here.

Worth testing directly: a `showing_square_variations` row for an untiered
showing has to store *something* in `tier_name`. If it stores `NULL` while
`loadTicketGroups` looks up `''`, every untiered showing misses its variation.
That alone would produce ad-hoc lines rather than a bare payment — so if the log
says branch 1 or 3, look at the **tax** arithmetic instead, since the donation
group is `taxable: false` and the processing-fee group is its own line.

## Steps

1. **Read the log** for the 11:41 am order (`order 2qYZ2GcXbz2ucDMjC8VitrSSU9SZY`,
   payment `7BOwpk5h3ekl5kXbY8mEtyVx0ORZY`) and identify which of the four
   branches fired. Everything below depends on the answer.
2. Reproduce on **staging**, which has a real Square sandbox and can be hit
   destructively for free (`square-staging-has-a-real-sandbox`). Buy an untiered
   showing and a tiered one and diff the two order payloads.
3. Fix the cause. Do **not** relax the total-equality guards to make the order
   go through — those guards are the reason no patron has been overcharged.
4. Re-verify by purchase, and confirm in Square's **Item Sales** report, not
   just the transaction list.
5. Consider whether a fallback should be **visible**: today it is a
   `console.error` nobody reads. A counter on the admin transactions screen, or
   the existing `square-catalog-guard` check, would make the next occurrence
   noticeable within a day rather than at the next spot-check.

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
