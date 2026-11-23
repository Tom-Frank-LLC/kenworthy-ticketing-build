---
brief: tier-ticket-limits
title: A general-admission price tier can have its own ticket limit, so a block like Preferred Seating sells out while General Admission keeps selling
status: built
track: feature
severity: P1
date: 2026-11-22
verified: false
evidence: migration 20261123060222_tier_ticket_limits.sql; supabase/tests/tier_limits (incl. a two-session race with a lock-removed control that fails)
---

# Brief: per-tier ticket limits (general admission)

**Requested by:** box-office staff, via Tom, for the ballet: *"an option to sell
out a certain type of ticket for events … preferred seating tickets that will
sell out before the general admission ones."* The ballet is general admission.

## What was true before (verified in code, 2026-11-22)

- **Assigned seating already did this.** Each tier owns specific seats on the
  map (`showing_seat_tiers`), so a tier is gone when its seats are.
- **General admission did not.** A GA tier was a name and a price.
  `enforce_showing_capacity()` counted the whole showing against
  `showings.total_seats` and nothing else, as did the patron page's and the
  POS's steppers. Preferred Seating could sell every seat in the room.
  `supabase/tests/tier_limits/before.sql` demonstrates it on the shipped trigger.
- The only lever staff had was removing the tier, which makes it vanish rather
  than read "Sold out".

## The change

**Data.** `showing_price_tiers.max_tickets integer NULL`, `CHECK >= 0`.
NULL = no limit (every existing tier). `0` = closed, allowed on purpose: it is
the "sell this tier out now" switch, so staff get option 2 (a manual toggle)
for free.

**Enforcement: one trigger, every path.** `enforce_showing_capacity()` now
also refuses a GA ticket that would push its tier past `max_tickets`, under the
same showing row lock and with the same `PT409`. Every way a ticket is issued
(website, box office, Square Terminal and Stand, comps, pass redemption) is held
to it. Every one of those inserts happens *before* a card is charged (online and
the terminal write rows as `pending` first), so a refusal never lands after the
money moved. The tier check runs before the showing check, so when both are
exhausted the buyer hears the specific thing ("Preferred Seating is sold out for
this showing.") and can still choose General Admission.

Deliberately **not** online-only, unlike the manual sold-out flag
(`BRIEF-manual-sold-out`). That flag means "close the website", and the counter
staying open is the point. A tier limit is a physical block of seats, and the
box office overselling it is the same failure as the website doing so. Staff
who genuinely have more simply raise the limit.

**Availability.** `showing_availability()` gained a `tiers jsonb` column:
per live tier `{tier_id, max_tickets, held, available}`, where `available` is
null when there is no limit. Return type changed, so the migration drops and
recreates it in one transaction. Old columns are unchanged (§0 of the test
compares them to a pre-migration baseline), and the grants are restated.

**Writer.** `set_showing_price_tiers()` accepts `max_tickets`: number sets,
`null` clears, **absent keeps**. Absent-keeps matters because `SeatTierEditor`
saves through the same function and knows nothing of limits. Bad values
(negative, fractional, string, boolean, > 100000) are refused with `PT400`.

**UI.**
- *Showing form* (`/admin/showings/:id/edit`, Price Tiers): a "Limit" box per
  tier, blank = no limit, with a line explaining it. Validated before any write.
- *Patron page*: a tier at its limit says **Sold out** beside its price and its
  + is disabled. The stepper also caps at what is left of the tier. If every
  tier is out, the whole showing reads Sold Out even with seats left. Counts are
  still not shown to patrons (existing policy).
- *POS*: each limited tier shows "N of M left" / "Sold out", and the + stops.
  `refreshAfterSale` now re-reads through `showing_availability` instead of
  reading `tickets` directly. The direct read is filtered by RLS (see the note
  on the POS's first load) and cannot give per-tier counts.
- *ticket-checkout*: an advisory per-tier check beside the existing capacity
  check, so the refusal comes before a guest account is created and can say
  "Only 1 Preferred Seating ticket is left for this showing."

## Out of scope / known edges

- **A limit is per showtime.** A batch-created run gives each night its own
  limit of N, which is what a block of seats means.
- **Tickets with no tier** on a tiered showing (if any path issues one) count
  against the showing, not against any tier.
- **Listings** ("Get Tickets" on home/calendar cards) do not reflect capacity
  sold-out today, and still don't.
- Production-level tier templates (`production_price_tiers`) carry no limit;
  GA tiers are written per showing by the form.

## Verification

- `sh supabase/tests/tier_limits/run.sh`. §0 is production's shapes (untiered
  GA, tiered GA with no limit, seated) behaving exactly as before. Then the
  limits, holds, multi-row orders, `0`/NULL, seated tiers, NULL capacity,
  availability, grants, the writer, and a two-session race for the last
  Preferred ticket. A control run with the row lock removed sells 2 tickets
  against a limit of 1, so the race test can fail.
- `anon_surface` 61/61 under both privilege models; `price_tiers` 39/39.
- vitest 1339 pass (new: form load/save/clear/zero/refuse; patron page tier
  sold out, unlimited, all-tiers-out, each mutation-checked); deno 755 pass
  (new: checkout tier refusal before account, "Only 1 … left", room sells).

## Still to do

- [ ] Staging: db push, functions deploy (`ticket-checkout`), Worker deploy;
      set a limit on a staging GA showing and buy through it, online and POS.
- [ ] Production: same, then set the ballet's Preferred limit with staff.
