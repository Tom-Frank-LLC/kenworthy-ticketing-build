---
brief: batch-showtimes
title: An admin adds a whole run of showtimes in one pass, and is told exactly which ones landed
status: shipped
track: feature
severity: P2
date: 2026-08-25
shipped_in: ["#203"]
shipped_at: 2026-08-27
verified: true
---

> **Decisions taken (2026-08-26).** The six open decisions were settled as
> follows.
>
> **1 — collision warning now**, not deferred. It is an `in` filter on the exact
> instants being entered, so it returns at most one row per showtime asked
> about: no range window to get wrong and nothing for PostgREST's silent
> 1,000-row cap to truncate. Admins and staff see every showing through the
> `showings` SELECT policy, so unlike an anon read it is not quietly looking at
> a fraction of the table. Debounced 400 ms, a warning and never a block.
>
> **2 — "+1 day" and "+1 week" helpers included.** They do calendar arithmetic
> on the naive wall clock rather than millisecond arithmetic on an instant, so
> "same time next week" is still 7:30 across a DST change. Tested against both
> 2026 transitions.
>
> **3 — client loop with per-row results**, as recommended. No new edge
> function: the per-showing sequence stays in the form, extracted into
> `createOneShowing()` and called once per showtime, so there is exactly one
> copy of it.
>
> **4 — neither (a) nor (b): paint once, apply to all N.** The brief assumed the
> seat editor can only persist one showing. It can persist any number —
> `SeatTierEditor.persist(showingId)` writes from its own painted local state to
> whichever id it is handed and never reads the showing back, so the same map
> and tiers are written to every showing in the batch. A reserved-seating run
> therefore does not have to be created a night at a time, and no showing is
> left with an empty picker. Nothing in the editor changed to allow this.
>
> **5 — a batch summary on the page**, listing every showtime with a link, what
> failed and why. One showtime keeps today's behaviour exactly: the same toasts
> and the same navigation to the showing just created.
>
> **6 — edit stays single-showing**, as recommended.
>
> **Also found while implementing.** `origin/main` had already replaced the
> Square check the brief describes (`counts.needs_item` / `tally.
> accepted_but_not_stored`) with `squareSaveOutcome()` in `src/lib/squareLink.ts`,
> which classifies all eight planner statuses. The batch summary aggregates that
> function's codes rather than reimplementing the two-status version, so the
> batch cannot drift from the single-showing path. The base-price `<Label>` was
> also rendering unattached to its input; it now carries `htmlFor`/`id` like the
> runtime field beside it.
>
> **Shipped as.** `src/lib/showtimeBatch.ts` (pure: rows, wall-clock
> arithmetic, duplicate/collision detection, batch and Square summaries) plus
> `ShowingForm.tsx`. Tests: `src/lib/showtimeBatch.test.ts` (22) and
> `src/pages/admin/ShowingForm.test.tsx` (10, driving the real form against a
> mocked Supabase — N rows produce N inserts *and* N template RPCs, N tier
> inserts, N eligibility writes and N Square calls; plus the partial-failure,
> retry-row and created-but-unfinished paths).

# Brief (for Claude Code): Add multiple showtimes at once in the admin showing form

**Status:** 🟢 Admin productivity feature, mostly additive. The care items are partial-failure reporting, assigned-seating venues, and running the existing per-showing side effects once per showtime.
**Date:** August 25, 2026
**Requested by:** Tom — when adding showtimes to a movie, let an admin enter **several showtimes at once** instead of one at a time.

## Current state (verified — `src/pages/admin/ShowingForm.tsx`)
- The form creates **one** showing. Everything except the date is shared config: **category + item** (movie/event/performance), **venue**, **base price / price tiers**, **runtime override**, **pass eligibility**, and **reserved-vs-GA** (`requires_seat_selection`).
- The only per-showtime field is a single **"Date & Time"** `datetime-local` (`startTime`, L571–572).
- `handleSubmit` (L302+) for a **create** runs this sequence for the one showing:
  1. `insert` into `showings` (shared config + `start_time`; `total_seats` seeded from the venue on create). 
  2. `apply_production_template_to_showing` RPC (seed seat-tier template).
  3. **Seat pricing** — if assigned seating, the **seat editor persists per showing via a ref** (paint + validate); else **price tiers** are deleted+reinserted, or removed.
  4. `setShowingEligibility(showingId, …)` for passes.
  5. **`square-showing-variations` `ensure_showing`** (best-effort, non-blocking; the toasts at L432–440).
  6. Navigate to the new showing.
- **Edit mode** edits a single existing showing (L341–343).

So a batch feature = keep all shared config, collect **N datetimes**, and run steps 1–5 **once per datetime**.

## The change
### UI — a repeatable showtime list (create mode)
1. Replace the single "Date & Time" input with a **list of showtime rows**, each a `datetime-local` with a **remove** control, plus an **"+ Add another showtime"** button. Start with one row; require at least one valid row to save.
2. Keep every other field exactly as the shared config that applies to **all** rows in the batch (item, venue, price/tiers, runtime, passes, seating). Make that framing explicit in the UI copy ("These settings apply to every showtime below").
3. **De-dupe / conflict hints (recommended):** flag duplicate datetimes within the list, and — nice-to-have — warn if a datetime collides with an existing showing for the same venue (a soft warning, not a hard block). **Decision 1:** include the existing-collision check now or defer.
4. **Convenience helpers (optional, Decision 2):** quick "add +1 day" / "+1 week from the last row" buttons to build a run fast. Off-scope if Tom wants minimal.

### Save — loop the existing per-showing sequence
On submit (create), validate all rows, then for **each** showtime run the current steps 1–5 with the shared config and that row's `start_time`. Keep the venue-capacity seed, the template RPC, tiers/eligibility, and `ensure_showing` per showing — **reuse the existing code path, don't fork a second one** (extract the current single-showing body into a `createOneShowing(startTime)` helper and call it in a loop).

### Partial-failure reporting (the real trap)
There's no server-side transaction here — it's a client-side multi-step loop, so a batch can partially succeed (row 3 fails after rows 1–2 are created). Do **not** report a blanket success or silently drop failures:
- Track per-row outcome; on completion show **"Created N of M showtimes"** and list which datetimes failed and why, leaving the failed rows in the form to retry. 
- Because each row's step 1 (insert) is what actually creates the showing, a later-step failure (tiers/eligibility) for a given row should surface that row as "created, but pricing/eligibility incomplete" — mirror the existing single-showing warnings, per row, rather than collapsing them.
- **Decision 3:** best-effort client loop with a clear per-row result summary (recommended, matches how the form already works) vs a new edge-function/RPC that creates the batch atomically (heavier; a real transaction, but duplicates the per-showing logic that currently lives in the client).

### Assigned-seating venues (the other trap)
The seat editor paints and persists **one** showing's map via a ref — it can't paint N maps in one pass. So for a reserved-seating venue, a batch can't meaningfully hand-paint each night at once. **Decision 4:**
- **(a, recommended)** Restrict multi-add to **GA / non-assigned** showings: when `requires_seat_selection` is on, collapse back to a single showtime (or hide "Add another"), with a note that reserved-seat nights are created individually. Each still gets the production seat-tier template.
- **(b)** Allow the batch to create N reserved showings that all receive the **production template** seat tiers, then the admin paints each individually afterward from the showings list — riskier (a reserved showing with no painted map renders an empty picker), so only if Tom wants it.

### Square variations per showtime
`ensure_showing` already runs per showing and is best-effort/non-blocking. For a batch, call it once per created showing; **summarize** the Square outcome across the batch (e.g. "Square items created for N showtimes; K need linking") instead of firing M separate toasts. Same fallbacks as today (a showtime still sells ad-hoc if Square lags).

### Post-save
Instead of navigating to a single new showing, land on a **batch summary** (or the admin showings list filtered to this title) so the admin sees all N. **Decision 5:** stay on the form cleared for another batch vs go to the list (recommend: go to the list / show a summary with links).

## Scope
- **Create mode only.** Edit remains single-showing (you're editing one existing record). "Add multiple" is a create affordance. Confirm — **Decision 6** — that edit stays single (recommended).
- Applies to movies primarily (Tom's ask), but the form already handles events/performances with the same flow — the batch feature should work for all three since they share the code path, unless Tom wants movies-only.

## Decisions for Tom
1. Existing-showing collision warning now vs later.
2. Convenience "+1 day / +1 week" helpers, or minimal add/remove only.
3. Client-loop with per-row results (recommended) vs atomic batch RPC.
4. Reserved-seating: restrict batch to GA (recommended) vs allow template-only reserved batch.
5. After save: go to list/summary (recommended) vs stay for another batch.
6. Keep edit single-showing (recommended); batch is create-only.

## Test plan
- Adding 3 showtimes with one shared config creates **3 showings**, each with the correct start time and the shared item/venue/price/tiers/runtime/passes.
- Each created showing gets its price tiers (or GA price), pass eligibility, the production seat-tier template, and an `ensure_showing` run — verified per showing, not just the first.
- **Partial failure:** if one row's datetime is invalid or an insert fails, the others still succeed and the summary reports exactly which succeeded and which didn't; failed rows remain editable; no false "all created" toast.
- Duplicate datetimes in the list are flagged before save; (if enabled) a collision with an existing showing warns.
- Reserved-seating venue behaves per Decision 4 (batch restricted to GA, or template-applied reserved batch) with no showing left with an empty seat picker.
- Square outcome is summarized across the batch; a title with no Square item still sells and is flagged once, not M times.
- Edit mode still edits a single showing unchanged; single-showtime create (one row) behaves exactly as today.
- `npm run build` + tests pass; add a test for the create loop (N rows → N showings + N side-effect runs) and the partial-failure path.
