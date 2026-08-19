# Rule: no ticket for a showing that has already happened

**Shipped:** August 19, 2026
**Brief:** `docs/briefs/BRIEF-past-no-purchase.md`
**Migration:** `supabase/migrations/20260819143722_showing_end_and_past_sales_rules.sql`

## What was actually broken

Not the button. Purchasability was never modelled anywhere, so nothing
enforced it:

- `ticket-checkout` had no date check of any kind. It would price, charge a
  card, and confirm a scannable ticket for a screening that finished last
  March.
- The Showing page rendered its full buy flow for any showing reachable by
  URL, past or not.
- `StaffPOS.tsx` and `HostDashboard.tsx` insert ticket rows **straight from
  the browser** through PostgREST. They touch no edge function at all, so no
  amount of edge-function validation would have covered them.
- `admit_with_film_pass` would redeem a pass — real money off a physical
  card — against any showing whatsoever, including one from last year picked
  by mistake from the scanner's selector.

Hiding the button would have left every one of those intact.

Two things were *already* right and are worth knowing before you go looking
for bugs that aren't there: `useFeed` filters `start_time >= now` at query
time, so the home feed, calendar, and drawer never load a past showing on a
fresh page load; and the POS's showing dropdown filters the same way.

## The decision that shaped everything else

**Sales stop when the show ends, not when it starts** (Tom, Aug 19).

A patron arriving at 7:20 for a 7:00 film is still a patron. Cutting sales at
`start_time` would have been simpler to build and would have become a rule the
box office worked around rather than with.

That decision cost a schema change, because the schema could not answer "when
does this end?":

| table | duration column |
|---|---|
| `movies` | `duration_minutes` (NOT NULL, default 90) |
| `events` | none |
| `live_performances` | none |
| `showings` | none |

So `showings.duration_minutes` is new — nullable, an *override*. The
resolution chain is:

```
showings.duration_minutes  →  movies.duration_minutes  →  120
```

The 120-minute default is what an event or a live performance gets when nobody
sets anything, and it is deliberately generous. Too long costs a few extra
minutes of a purchasable page. Too short refuses a real sale during a real
show.

## Two windows, not one

The single-rule instinct breaks on one real case: **film-pass redemption
happens at the door, during the film.** A pass is scanned by a staff member
looking at the room, twenty minutes into a screening. Bounding that by the
online cutoff would refuse every latecomer, and staff would correctly
experience it as the system being broken.

So there are two windows, and they are two because the acts are different:

| | closes at | applies to |
|---|---|---|
| **Online sales** | `start_time + duration` | `ticket-checkout` (the web) |
| **The door** | `start_time + 4 hours` | film-pass admits, comps, walk-up POS |

Four hours is not arbitrary — it is the same span
`SHOWING_WINDOW_BEFORE_MS` in `TicketScanner.tsx` already uses to decide what
counts as "tonight".

For an ordinary 112-minute film the door outlasts the online cutoff by about
two hours. For a 10-hour marathon slot the online cutoff outlasts the door.
The trigger takes `GREATEST` of the two, so it is a floor under both.

## Where the rule lives

Three copies, in descending order of authority. **All three must agree; changing
the cutoff means changing all three.**

1. **`showing_ends_at(showings)` + the `zy_enforce_showing_not_past_on_insert`
   trigger on `tickets`** — the only layer that covers the two browser-direct
   insert paths. Raises `PT410`, which PostgREST returns as HTTP 410 Gone.
   410 rather than 404 (no such showing) or the 409 the capacity trigger
   raises: the showing exists, it just can no longer be sold.
2. **`supabase/functions/_shared/purchasable.ts`**, applied in
   `_shared/pricing.ts` — the one gate every online sale passes through, so a
   future checkout path inherits the rule instead of having to remember it.
   This is what turns a stale browser tab into a sentence a customer can read
   rather than an opaque database error.
3. **`src/lib/purchasable.ts`** — the browser's copy. Advisory. It decides what
   is *rendered*, nothing more.

This mirrors how pricing already works in this codebase: the client computes
for display, the server decides, the database refuses.

## What changed in the UI

The purchase affordance **disappears** for a past showing rather than dimming.

- `src/pages/Showing.tsx` — the seat map, GA picker, order summary and mobile
  order bar are all replaced by a "This showing has passed" notice giving the
  date it played and a link to what's on now. The page above it — title,
  poster, showtime, synopsis — stays. Past programming stays readable at a
  theatre with a hundred years of it (Tom's call: info-only past events remain
  visible as archival pages).
- `ProductionDetailDrawer.tsx` — past showings drop out of the list, which is
  what finally makes its "Upcoming Showings" heading true. An RSVP event whose
  showings have all passed loses its RSVP button.
- `TrailerFeed.tsx`, `ShowingPreview.tsx`, `EditorialCalendar.tsx` — every
  "Get Tickets" / "RSVP" CTA is gated. These only bite in a tab left open
  across a start time, since the feed excludes past showings at query time,
  but that is precisely the tab that would otherwise sell a finished film.
- `TicketScanner.tsx` — renders the new `showing_over` verdict as *"That
  screening of X is over — check which showing is selected. Nothing was
  deducted."* The last clause matters: "did that just cost them $6?" is the
  question staff would otherwise ask.
- `ShowingForm.tsx` — a "Runs For (minutes)" field, with the inherited value
  as its placeholder so the admin can see the assumption rather than having to
  know it. Without this the new column would have been unsettable for exactly
  the two production types that have no runtime of their own.

The copy is one constant, `SHOWING_PASSED_MESSAGE`, used by the page, the
edge-function error and the trigger alike. A buyer who submits a stale tab
gets the same sentence the page would have shown, not a second differently
worded version of the same fact.

## What is deliberately *not* exempt

No `payment_method` is carved out of the trigger. Comps and POS sales are
in-person acts and get the same four hours as the door; `film_pass` admits are
refused earlier and more readably by `admit_with_film_pass` itself. A host can
still comp a walk-up at 7:20; nobody can comp last month's screening.

If a genuine backfill of historical ticket rows is ever needed, the escape
hatch is `ALTER TABLE public.tickets DISABLE TRIGGER
zy_enforce_showing_not_past_on_insert;` inside that transaction — not a
carve-out in the trigger.

## How it was verified

Migration and trigger were run for real against a throwaway `postgres:15` with
stub tables, not reasoned about:

- `showing_ends_at` fallback chain: film → 112 min, event → 120 min default,
  override → 300 min. ✅
- Trigger boundary: 3h59 after start ALLOWED, 4h01 REFUSED `PT410`. ✅
- `GREATEST` branch: a 600-minute slot ALLOWED at 8h after start, REFUSED at
  11h — proving show-end can outlast the door window. ✅
- `admit_with_film_pass`: latecomer at 20 min admitted; 3 hours in (past the
  film's end, inside the door window) admitted; last month's screening returns
  `showing_over` **with the pass balance untouched**. ✅
- The `admitted` verdict still carries all 11 keys the scanner reads,
  including `admissions_left`. ✅

Plus: 220 vitest tests across 23 files, 17 `deno test` cases in
`pricing_test.ts` (5 of them new and about this rule), `deno check` on the
touched edge functions, `tsc -p tsconfig.app.json --noEmit`, and
`npm run build:staging`.

### A near-miss worth recording

This work was first written in a checkout that was **112 commits behind
`origin/main`**, and was rebased onto current `main` before merge. That rebase
caught a regression that every test above would have passed straight over.

`admit_with_film_pass` has to be reproduced whole, because `CREATE OR REPLACE`
takes the entire body. The version copied was the one visible in the stale
checkout — `20260814085500_film_pass_multi_admit.sql`. Two later migrations
that the stale checkout had never seen had since:

- replaced the function again (`20260814093200_pass_eligibility_by_type.sql`),
  moving eligibility from a boolean column to a `pass_type_showings` join table
  and adding `per_showing_use_limit`; and
- **dropped `showings.film_pass_eligible`** entirely
  (`20260814093300_drop_film_pass_eligible.sql`).

Shipping the stale copy would have reverted the new eligibility model and
referenced a column that no longer exists. The function was rebuilt from the
current definition and diffed against it: 21 lines added, 0 removed, all of
them the door-window check. Re-verified on a fresh `postgres:15` carrying the
*current* pass model — an untagged showing still returns
`not_eligible_for_pass`, and the per-showing limit still returns
`per_showing_limit_reached`.

The general lesson is the cheap one: before `CREATE OR REPLACE` on a function
you did not write in this session, find its *latest* definition, not the first
one `grep` happens to show you.

## Deploying it

The rule is inert until *all three* land, and they are independent:

1. `supabase db push` — the column, `showing_ends_at()`, `door_grace_window()`,
   the trigger, and the new `admit_with_film_pass`.
2. `supabase functions deploy ticket-checkout` — `pricing.ts` is bundled into
   it, so the customer-facing refusal ships with the function, not the DB.
3. `wrangler deploy` — the frontend. Merging to `main` does **not** deploy.

Order matters in one direction only: the migration is safe to apply before the
frontend ships (a browser on the old bundle simply never sends a past-showing
purchase, and if it did the trigger refuses it), but the frontend is *not* safe
to ship before the migration, because `ShowingForm` writes
`showings.duration_minutes` and that column would not exist.
