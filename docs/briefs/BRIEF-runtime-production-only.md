---
brief: runtime-production-only
title: A runtime is set only on the film or event; showings no longer carry one
status: built
track: data
severity: P2
date: 2026-10-02
verified: false
evidence: migrations 20261002222321 (move per-show values up, showing_ends_at reads the production) and 20261002224512 (drop showings.duration_minutes), both tested on postgres:15
---

# Runtime lives on the production only

**Requested by:** Tom (2026-10-02): "we don't need to have runtime on shows and events. any show of an event will have the same runtime. let's set the runtime on the event-level and remove it from the show-level, and same for movies and showings."

Follows [BRIEF-production-runtime](BRIEF-production-runtime.md) (#354), which gave events a runtime of their own but kept the per-show "Runs For" field as an override. This removes the override.

## What production held (read-only query, 2026-10-02)
Only 13 of 1,869 shows had their own runtime, across 5 productions. In every case the production had no usable runtime, and its shows agreed on one value:

| Production | Kind | Its runtime | Shows' runtime |
|---|---|---|---|
| APOD Productions: Bandstand | event | none | 150 (8 shows) |
| Gem State Flyers: Trick or Tease | event | none | 120 (1) |
| Private Rental | event | none | 180 (2, past) |
| Stardust: A Night of Magic | event | none | 75 (1) |
| Science on Screen: Wild & Wool + The Sheep Detectives | film | 0 (= unknown) | 180 (1) |

So moving each value up to its production changes no show's end time. Staging held none. In the database, only `showing_ends_at()` read the column: no view depends on it, and the two triggers on `showings` are generic. The production and staging catalogs agree.

## The change
- **20261002222321:**
  - A guard refuses if a production's shows disagree, or disagree with a positive runtime the production already has. It never guesses which show should end at the wrong time.
  - Moves each per-show value up to its production where the production has none (or 0).
  - `showing_ends_at()` becomes production → 120.
- **20261002224512:** drops `showings.duration_minutes`. Its own guard refuses if a show was given a runtime its production doesn't carry in the meantime, for example from a stale admin tab.
- **Rule:** `resolveDurationMinutes(production)`, in both `purchasable.ts` twins, takes no showing. `ShowingTiming` loses the field, so the compiler found every caller.
- **ShowingForm:** the "Runs For" input is gone. A note states "Runs 2h 30m, set on the event", or that none is set and sales stop 2h after the start, with a link to the film or event form.
- **Readers that stopped selecting the column:**
  - `showtimes.ts` (sibling dates)
  - Rentals
  - the Silent Film Festival page
  - the Worker's `SHOWING_SELECT`
  - `_shared/tickets.ts` (`loadOrder`)
  - `ShowtimeChips` passes its carried runtime as the production's.
- **Festival lineup:** `selectFestivalLineup` used `isPast(s, null)`, so a screening ended on its show-level value or at 2h, ignoring the film's runtime. It now resolves through the screening's film or event, like the card beside it already did.

## Deploy order: two stages, per environment
The code live before this change selects `showings.duration_minutes` by name, and PostgREST fails a select naming a missing column. So the column is dropped only after code that no longer reads it is live:
1. `db push` with **only 20261002222321** in the tree (hold 20261002224512 back). This is safe with the old code still live: the old chain reads the same values from the show or the production.
2. `functions deploy ticket-access send-ticket-confirmation`, then `wrangler deploy`.
3. `db push` again for 20261002224512.

Between steps 2 and 3, a staff browser still running the old bundle (service-worker cache) can write a "Runs For" value. Step 3's guard refuses in that case; move the value to the production and re-run. After step 3, the old bundle's show form fails to save ("column does not exist") until the page is reloaded.

## Tests
- Migrations on postgres:15:
  - The 5 production cases plus agreeing, plain and show-less productions: no end time changes, the values land on the productions, and the column is gone.
  - Guard A refuses on disagreeing shows, and on a show that differs from a film's positive runtime; nothing changes.
  - Guard B refuses a stray show value and keeps the column, and passes when the values match.
- `purchasable.test.ts`: production → default. 0 and negative values count as absent. A runtime on a stale showing row is ignored.
- `festival.test.ts`: the last screening stays listed until its film's 150 minutes are up. The mutation check (reverting to `isPast(s, null)`) fails it.
- `ShowingForm.test.tsx`: no Runs For field. The note states the event's runtime and links to it, the no-runtime note links to set it, and the insert carries no `duration_minutes`.
- Worker JSON-LD and `loadOrder` read the production only.
- Pricing harness: 106/106 against the updated stub.
