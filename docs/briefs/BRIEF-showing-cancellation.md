---
brief: showing-cancellation
title: Staff can cancel a showing, and a cancelled showing disappears from every public listing
status: shipped
track: feature
date: 2026-10-10
shipped_in: ["#378"]
shipped_at: 2026-10-11
verified: true
evidence: "#378 squash-merged as 3840dc9; migration 20261011005202 applied to production 2026-10-11 (column, CHECK and policy verified; anon surface 0 rows); prod Worker 1093cc24 (rollback c753b0a6); staging 8b24250f; Tom tested Cancel/Restore on staging; kenworthy.org showing heads 200 with EventScheduled, calendar history loads"
---

# Brief: Cancel a showing

**Requested by:** Tom, 10 Oct 2026, after the calendar history shipped (#376):
"once cancelled they should no longer be visible."

## The problem

The database has no way to say "cancelled". The nearest thing is
`showings.is_active = false`, which means two different things:

- **The archive.** 1,749 of 1,827 past showings were imported inactive on
  10–11 Aug 2026, and they really did play. The calendar's history (#376) has
  to ignore the flag to show them.
- **"Hide this."** The host dashboard's Hide button, and the only way to take a
  showing off sale for good without deleting it.

So history cannot tell a night that was cancelled from one that played. A
cancelled showing would reappear on the calendar, marked "Ended", once its date
passed.

Deleting is not a substitute. Since 6 Oct (`20261006225933`) a showing that has
sold tickets or pass admissions cannot be deleted, because the sales must
outlive it. Those are exactly the showings that most need cancelling.

Measured on production, 10 Oct 2026: **no showing has been set inactive since
the import**, so nothing needs backfilling.

## The change

**`showings.cancelled_at timestamptz`**, set by a Cancel action in the admin.

- **Cancelling also makes the showing inactive, enforced by the database.**
  `CHECK (cancelled_at IS NULL OR is_active = false)`. Every surface that
  already filters `is_active = true` then hides a cancelled showing with no
  change: the home feed, the calendar's upcoming days, the showing page's date
  list, the box-office counter, the sitemap and Square variation sync. Online
  and counter sales are refused by `price_ticket_order`, which raises PT409 for
  an inactive showing. The CHECK makes "cancelled but still listed"
  impossible, rather than a rule each surface must remember.
- **Calendar history skips cancelled showings** (`cancelled_at IS NULL`). This
  is the one place that has to ask, because history deliberately ignores
  `is_active`.
- **A direct link still works and says "This showing was cancelled."** Tom
  asked for cancelled showings to be invisible, and they are: listed nowhere,
  in no search, in no sitemap. But a patron holding a ticket has a link to the
  showing in their email, and "not found" would be the worst answer to give
  them. So the anon read policy also admits `cancelled_at IS NOT NULL`, and the
  page swaps the buy flow for a cancellation notice. The Worker marks the page
  `noindex` and sets schema.org `eventStatus: EventCancelled`.
- **Admin:** each showing row gets Cancel (or Restore) next to Sold out, and a
  "Cancelled" badge. Cancel confirms first and names the tickets already sold:
  cancelling does not refund them. Restore clears the date and makes the
  showing active again. Both writes `.select()` and check the row count, since
  an RLS denial looks like success.
- **Host dashboard:** a cancelled showing shows "Cancelled" in place of the
  Hide/Show toggle. Re-showing it there would break the CHECK; restoring is the
  admin's call.

## Not in scope

- **Refunds and patron notification.** Cancelling stops new sales and hides the
  showing. Existing tickets stay valid records to refund through Square as now.
  The confirm dialog says so.
- **Square catalog cleanup.** A cancelled showing's counter items stay in the
  Square catalog, as a hidden showing's do today. Variation sync skips inactive
  showings.

## Deploy order

**Migration first, then the Worker.** The Worker's showing read and the
calendar history both name `cancelled_at`. Against a database without the
column, PostgREST refuses the read: every `/showing/:id` head would 404 and
history would fail to load. `db push` to production, verify the column, then
`wrangler deploy`.

## Verified on staging (2026-10-11)

- Migration applied. The anon-surface check returns 0 rows.
- In a throwaway `postgres:15`: cancelling an active showing alone is refused
  by the CHECK; cancel+inactive works; re-activating a cancelled showing is
  refused; anon reads a cancelled upcoming showing but still not a merely
  hidden one; restore works.
- A real upcoming showing, cancelled the way the admin button does it,
  disappeared from the feed and the calendar. Its direct link showed "This
  showing was cancelled" with no buy flow, and `price_ticket_order` refused it
  (PT409). A cancelled past showing disappeared from the calendar history.
  Both were restored afterwards; their `updated_at` moved.
- The admin Cancel/Restore buttons: Tom tested them on staging (2026-10-11)
  and confirmed they work.
