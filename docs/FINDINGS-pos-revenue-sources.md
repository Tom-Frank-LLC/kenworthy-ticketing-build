# Which revenue the box office can actually see

Established 2026-09-02, while adding a breakdown to the POS "Today's Revenue"
card. The question was "show ticket / film pass / concession / rental /
donation revenue for today". Three of those are readable. Two are not, for
different reasons, and neither reason is obvious from the schema.

## Summary

| stream | table | staff can SELECT | usable as *today's revenue* |
|---|---|---|---|
| Tickets | `tickets.total_price` | yes | **yes** — filter `status='confirmed'` |
| Film passes | `film_pass_orders.amount_paid` | yes | **yes** — filter `status='paid'` |
| Concessions | `concession_sales.total` | yes | **yes**, but always $0 today (see below) |
| Rentals | `rental_invoice_lines.unit_price` | yes | **no — the fact is not recorded** |
| Donations | `donations.amount_cents` | **admin only** | not for staff |

## Square can be *read* today, safely — and it has both missing streams

Asked later the same day: can we just read concession revenue out of Square,
without any of the write-path risk? **Yes**, and it is already built.

`square-analytics` is deployed and ACTIVE on production. It uses Square's
**Reporting API**, which is a different API from the Catalog one that caused the
14 Aug damage and is **read-only structurally** — it has no write endpoint at
all, so there is no path from it to a catalog object.

It already returns `concessionRevenueCents` plus per-day
`ticketsCents / concessionsCents / otherCents`. Concessions is the union of ten
real categories (`1 Combos`, `2 Candy`, `3 Bottles`, `3 Soda`, `4 Beer`,
`4 Wine`, `5 Popcorn`, `Cafe`, `Cocktails`, `Concessions`), all measured
carrying revenue on the live account.

**Rentals are in there too.** `FINDINGS-square-reporting-api.md` records
Square's own category breakdown as including `Theater Rental` ($9,000),
`Fall Fundraiser Ticket` ($5,700) and `Rehearsal Hours`. So the rental figure
that is unreachable from our tables (below) *is* reachable from Square.

Two constraints:

- **Admin-gated.** `square-analytics` answers `403 "Admin only"`. Fine for the
  admin dashboard; it would need a narrower endpoint to serve a staff screen.
- **Production-only.** `connect.squareupsandbox.com/reporting/v1/meta` returns
  **404**. It cannot be exercised on staging at all.

## Rentals: a data gap, not a permissions gap

This is the surprising one. Staff *can* read both rental tables —
`rental_requests` and `rental_invoice_lines` each carry an `admin OR staff`
policy, and the latter has a full GRANT. Permissions are not the obstacle.

The obstacle is that **the build never learns a rental was paid**:

- `rental_requests` has no amount column and no paid-at.
- The money lives in `rental_invoice_lines` as `unit_price * quantity`. That is
  what was **billed**, not what came in.
- `square_invoice_status` is written exactly once, at creation —
  `supabase/functions/square-invoice/index.ts:294`,
  `square_invoice_status: created.status || 'DRAFT'`. Nothing ever updates it.
- There is **no Square webhook** in this repo. The only webhook function is
  `mailchimp-webhook`.
- There is no `paid_at` / `invoice_paid` column anywhere in the generated types.

So the status is frozen at DRAFT/UNPAID from the moment the invoice is made. We
cannot say which rentals are settled, let alone when the money arrived. Any
rental figure computed from our tables is "invoiced", never "received".

**Where the truth lives:** Square — concretely, as a `Theater Rental` category
in the Reporting API (see above). `square-analytics` (the Reporting API) is
already wired up and is this codebase's designated authority for revenue —
`AnalyticsTab` reads it precisely because our own tables under-report. It is
production-only. See `docs/briefs/FINDINGS-square-reporting-api.md`.

If a rental figure is ever wanted in the build, the honest fixes are a Square
invoice webhook, or a `paid_at` column populated by polling the Invoices API.
Adding a column alone would not help; nothing would fill it.

## Donations: admin-only, and it fails silently

`donations` has two SELECT policies: `has_role(auth.uid(),'admin')` and
`user_id = auth.uid()`. `has_role` lets admin satisfy `staff` but not the
reverse, so a **staff-only account sees zero donation rows**.

The failure mode is the dangerous kind: no error, no empty state — the sum is
simply `$0.00`. The same screen would report a different day total depending on
who was logged in, and the admin checking it would never see the discrepancy.

If donations are ever wanted here, prefer a `SECURITY DEFINER` function
returning **only the aggregate**, over granting staff SELECT on the table.
Staff need a number; the table holds donor names, emails, phones and messages.
`showing_attendees` and `check_in_ticket` are the existing precedents for
exactly this shape.

## Concessions: readable, and permanently zero

`concession_sales` is staff-readable and the query is correct, but
`CONCESSION_POS_ENABLED` is off in both environments and the table has no rows.
The line renders `$0.00` and will keep doing so until the tab takes payment.
That is the intended state, not a bug — the line is where the number will
appear. See the flag's own comment in `src/lib/flags.ts`.

## A stale claim worth not inheriting

`AnalyticsTab.tsx` opens with "exactly one order has ever come through this
build". That was true when written and is not now — the POS took 21 tickets and
$381.60 on 2 Sep 2026 alone. The *conclusion* it supports (theatre-wide revenue
belongs to Square) still holds, because the Square terminal and Square Online
carry traffic this build never sees. But the sentence should not be quoted as
evidence that the build's own tables are empty. They are not.

The two are different questions and both are legitimate:

- **POS "Today's Revenue"** — what this counter rang up today. Build-sourced.
- **Admin Analytics** — what the theatre took. Square-sourced.

They will never agree, and should not be made to.
