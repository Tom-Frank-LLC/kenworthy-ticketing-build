---
brief: free-no-ticket-showings
title: A free showing can be marked "no ticket needed", and then says Free instead of offering a purchase
status: built
track: feature
severity: P2
date: 2026-08-25
shipped_in: []
shipped_at:
verified: false
---

> **Decisions taken (2026-08-26).** All four went to the recommended option.
> **1 — boolean `no_ticket_required`**, not a `ticketing_mode` enum: it matches
> the flag style already on `showings`, and a boolean plus a CHECK cannot
> express the contradiction an enum sitting beside `ticket_price` would allow.
> **2 — keep the donation ask** on a no-ticket page. **3 — "Free · Details"** as
> a link, so the reader can still reach the time and venue. **4 — all three
> production types**, since they share one `showings` table and one code path.

> **Built, not shipped.** The code is on `main` but the migration has not been
> applied to either database and nothing has been deployed. Applying
> `20260827113402_showings_no_ticket_required.sql` to staging and then
> production, followed by `npx wrangler deploy`, is what makes this real — see
> `docs/RUNBOOK-deploy-staging-prod.md`. Until then every showing behaves
> exactly as it did before, because the flag defaults to false.

**Requested by:** Tom — for free movies, let the admin decide whether it
**requires (free) tickets** or **needs no ticket at all**, in which case the
ticketing page just shows **"Free"** in place of the purchase button.

## Current state (verified)

- A **$0 showing already has a free path**: `Showing.tsx` computes
  `isFree = chargeTotal <= 0`, hides the card step, and the button becomes
  **"Reserve N Ticket(s)"** — it still issues (free) tickets, holds seats, and
  counts toward capacity. `ticket-checkout` skips Square for a $0 charge but
  still confirms the tickets.
- So today "free" = **free but still ticketed (RSVP / seat hold)**. There is
  **no** "no ticket needed" option.
- **Purchasability is one rule stated in three places that must agree**
  (`src/lib/purchasable.ts` → `supabase/functions/_shared/purchasable.ts` →
  `public.showing_ends_at()` + the BEFORE INSERT trigger on `tickets`). Any
  "this can't be bought" state has to be taught to all three, per that file's
  own instruction.
- Showing creation is `ShowingForm.tsx` (price at `ticketPrice`, default
  `8.00`).

### Two corrections to the brief as written

The brief listed the listing CTAs as `ShowingPreview.tsx`, `BoothNote.tsx`,
`UpcomingList.tsx` and `TrailerFeed.tsx`. On `origin/main`:

- `UpcomingList.tsx` has **no CTA of its own** — it renders `ShowingPreview`,
  which owns the button.
- `EditorialCalendar.tsx` **no longer has one either**. Its rows open the
  detail drawer rather than offering a ticket, so there is no CTA there to
  reword; it got a **badge** in the same slot as the existing RSVP badge, which
  is the only place that surface can say a night is free.
- `SilentFilmFestival.tsx` carries a **fourth** per-screening "Get Tickets"
  that the brief did not list, and it needed the same treatment.

`src/lib/greenCta.ts` documents the set of green CTAs and its list is stale in
the same way — it names `EditorialCalendar` (which no longer has one) and omits
`BoothNote` and `SilentFilmFestival` (which do). Left alone here; correcting a
registry is a different change from the one this brief asks for.

## The three states, as built

1. **Paid** — `ticket_price > 0` (unchanged).
2. **Free, ticketed** — price 0, flag false. Reserves a free ticket, holds a
   seat, counts against capacity (unchanged).
3. **Free, no ticket** *(new)* — price 0, flag true. No ticketing at all.

The two free states are **not** distinguishable from the price, which is the
whole reason the flag exists rather than being inferred.

## The data model

`showings.no_ticket_required boolean NOT NULL DEFAULT false`, in
`supabase/migrations/20260827113402_showings_no_ticket_required.sql`.

- `CHECK (NOT no_ticket_required OR ticket_price = 0)` — the flag is only legal
  on a free showing.
- Tiers live in another table and cannot be reached from a table-level CHECK, so
  a trigger on `showing_price_tiers` refuses a **priced** tier for a flagged
  showing. A zero-priced tier is allowed: it contradicts nothing.
- That tier guard is deliberately **one-directional**. Guarding the `showings`
  side too would break the ordinary edit, because `ShowingForm` writes the
  showing row *before* it reconciles tiers — flipping a tiered showing to
  no-ticket would be refused for rows the very next statement deletes.

## Server enforcement — the three-place rule

| layer | file | behaviour |
|---|---|---|
| SQL (authority) | the migration above, folded into `enforce_showing_not_past()` | refuses **any** ticket insert for a flagged showing, `PT409` → HTTP 409 |
| Deno | `_shared/purchasable.ts` → `_shared/pricing.ts` | refuses to price the order, `PricingError` |
| Browser | `src/lib/purchasable.ts` | renders no purchase panel; `isPurchasable` returns false |

All three carry the identical sentence, **"This showing does not require a
ticket."**, so a stale tab, a direct POST and a POS insert are all told the same
thing the page would have said.

Two ordering decisions, made the same way in all three: the no-ticket check runs
**before** the past-showing check, so a walk-in night that has also finished is
reported as the former. "This showing has passed" would send staff looking for a
date problem on a screening whose real answer is that it never had tickets.

The trigger is what covers `StaffPOS.tsx` and `HostDashboard.tsx`, which insert
ticket rows straight through PostgREST and touch no edge function. Both surface
`error.message`, so both already show the right sentence with no change.

**No payment method is exempt** — card, comp and film pass are all refused
(verified). `admit_with_film_pass()` was deliberately left alone: `ShowingForm`
now clears pass eligibility for a walk-in showing, so the door case can only
arise from hand-tagging in SQL, and the trigger catches that.

## Admin form (`ShowingForm.tsx`)

The choice appears **only when the showing is actually free** — base price 0
*and* no priced tier. A priced showing has no such choice to make, and hiding
the control rather than disabling it keeps the form from offering a state the
save would reject.

The saved flag is **derived** (`noTicketRequired && isFreeShowing`) rather than
read straight from the radio, so a price typed in after the box was ticked
silently wins, with no effect fighting the admin mid-edit.

When on, saving also: forces `requires_seat_selection` false, clears price
tiers, clears pass eligibility, and **skips the Square `ensure_showing` call** —
nothing will ever sell against the showing, so minting a $0 variation would be
dead weight in a catalog that is already the theatre's entire sales history.

## Ticketing page (`Showing.tsx`)

`FreeAdmissionNotice` replaces the entire buy column, the way `PassedNotice`
does. Leaving disabled steppers on screen would pose a question the night does
not have.

**The donation ask is a link to `/donate`, not the `DonationPrompt` component.**
Tom asked to keep the ask, and this is that ask — but `DonationPrompt` is a cart
add-on: it sets an amount that rides on the ticket charge and is bundled into the
same Square payment by the server. There is no charge on this page for it to ride
on, so rendering it would collect a number and silently drop it. Same ask, the
only mechanism that can actually take the money.

The price line reads "Free — no ticket needed" instead of "$0.00 per ticket",
and the Sold Out badge is suppressed — capacity is not what limits a showing
that sells nothing.

## Listings

`no_ticket_required` rides through **both** feed builders (`useFeed.ts` and
`Index.tsx`) as `FeedItem.noTicketRequired`, and per-date through
`attachUpcomingShowings` as `UpcomingShowing.no_ticket_required` — per date
because a run can mix the two: a paid week with one free community screening in
it is ordinary, not an exception.

| surface | walk-in showing shows |
|---|---|
| `ShowingPreview` | "Free · Details" (still links to the showing page) |
| `BoothNote` | "Free · Details" |
| `TrailerFeed` | "Free · Details" |
| `SilentFilmFestival` | "Free · Details" |
| `EditorialCalendar` | a "Free · no ticket" badge, beside the RSVP badge |
| `ShowtimeChips` | "· Free" on the chip, and a matching `aria-label` |

The chips got a **visible** marker as well as the accessible name: marking free
dates for screen readers only would leave the two audiences reading different
lists.

## What was verified

- **The migration, in a throwaway `postgres:15`** with stub tables and the
  `anon`/`authenticated`/`service_role` roles — 15 assertions, all passing:
  the CHECK in both directions; ticket inserts refused for card, comp and film
  pass; a walk-in *and* past showing reported as walk-in (PT409, not PT410); a
  past paid showing still reported as passed (PT410, regression guard); priced
  tier refused, zero-priced tier allowed; the `ShowingForm` edit order (flag,
  then clear tiers) succeeding; and flipping back to ticketed restoring inserts.
  SQLSTATEs confirmed `PT409`/`PT410` via `GET STACKED DIAGNOSTICS`.
- `npx tsc -p tsconfig.app.json --noEmit` — clean.
- `npx vitest run` — 45 files, 540 passing. New cases cover `needsNoTicket`, the
  `isPurchasable` branch, and the listing labels including the mixed-run chips.
- `deno test supabase/functions/_shared/pricing_test.ts` — 22 passing, 5 new:
  the refusal, the refusal on the flag alone whatever the price says, the
  ordering against a past showing, the free-ticketed case still pricing, and an
  absent column reading as ticketed.
- `npm run build:production` — the strings are in the emitted chunks and the
  bundle carries the production Supabase ref.

**Not verified:** behaviour against a running database. The migration has been
applied nowhere.

`deno check supabase/functions/**/*.ts` and `deno test --allow-env
supabase/functions` (whole-directory) both fail on this machine for an unrelated
npm-specifier resolution error in the mailchimp functions — confirmed identical
on a pristine `origin/main` worktree, so it is pre-existing and not from this
change. The touched files check clean individually.

## Out of scope, deliberately

A walk-in showing has no tickets to scan or comp, and the POS showing picker
still lists it — a staff member who picks one is told why by the trigger's
sentence rather than finding the showing mysteriously absent. If staff ever need
a head-count for such a night, that is a separate ask.
