---
brief: production-runtime
title: Films and events carry a runtime set once on the title, which every show inherits and which can be hidden from the public page
status: shipped
track: feature
date: 2026-10-02
shipped_in: ["#354"]
shipped_at: 2026-10-02
verified: true
evidence: migration 20261002195410_production_runtime.sql applied on staging and production (tested on postgres:15 first); ticket-access + send-ticket-confirmation deployed to both; displayedRuntime() in src/components/ProductionMedia.tsx; PR #354
---

# Brief (for Claude Code): Show/hide-runtime checkbox for movies (and the events question)

**Status:** Shipped, both halves (PR #354), 2026-10-02. Decision 1 was answered by Tom: events *do* have a runtime today, but only per show (the "Runs For" field, blank = 120), so it had to be typed into every show. Fix that: events get a runtime of their own, set once, which shows inherit, plus the same show/hide toggle.
**Date:** October 2, 2026
**Requested by:** Tom asked for a backend checkbox to show or hide the runtime on movies and events, and for an event's runtime to be set on the event rather than on each show.

## Current state (verified, build `048cdf1`)
- **Runtime lives on movies and per-showing, not on events.** `duration_minutes` exists only on `movies` (NOT NULL) and `showings` (nullable, a per-showing override). See `purchasable.ts` ("Events and live performances have none"). `EventForm` has no duration field; `MovieForm` has one.
- **Where the runtime shows publicly:** only `ProductionMetaBadges` (`src/components/ProductionMedia.tsx`), rendered on the Showing page and in `ProductionDetailDrawer`. With no duration it renders nothing (`formatRuntime(null) → null`).
- **`duration_minutes` also drives logic, not just display.** It is the end of a screening for `isPast` and purchasable, the showtime filters, the drawer's past filter, the Worker's JSON-LD `endDate`, and `showing_ends_at()` in SQL (the "has passed" refusal in `price_ticket_order`).

## The change
### Part A: movies, a display-only flag (built)
1. `movies.show_runtime boolean NOT NULL DEFAULT true`, plus **`GRANT SELECT (show_runtime) ON movies TO anon`**. The original brief missed the grant. Anon reads `movies` through a column-level grant, so without it every public movie select fails.
2. `show_runtime` is in `MOVIE_PUBLIC_COLUMNS`. The feed spreads the row into the drawer's `production`, and Showing reads the same columns, so both see it.
3. `MovieForm`: a "Show runtime on the public page" checkbox below Duration/Rating. It loads from the row (only `false` unticks it) and saves in the payload. Duration is still required and saved.
4. `displayedRuntime(production)` (next to `ProductionMetaBadges`) returns `null` when `show_runtime === false`. Both badge call sites use it, so the badge takes its existing no-runtime path. Rating and genre still render.
5. Nothing that computes an end time reads `show_runtime`. The Worker's JSON-LD reads runtime only for `endDate`/availability, so it is deliberately unchanged.

### Part B: events, a runtime set once (built)
The old claim "events have no runtime" was half true: events had no column, but every show did (`showings.duration_minutes`, "Runs For"). Blank fell to `DEFAULT_SHOWING_MINUTES` (120), so a run of twelve performances needed twelve entries. Films never had this problem because the chain was show → **film** → 120.
1. `events` and `live_performances` gain `duration_minutes integer NULL CHECK (> 0)` and `show_runtime boolean NOT NULL DEFAULT true`. Nullable: blank is still the two-hour default. Both tables have a table-level anon grant, so they need no column grant.
2. `showing_ends_at()` (SQL) resolves show → movie | event | live performance → 120. That is the sale cutoff for `price_ticket_order` and `enforce_showing_not_past`. The TS chain (`resolveDurationMinutes`) was already generic. Its callers (Showing page, drawer, sibling showtimes) already pass the whole event row via `select('*')`, so they inherit without changes.
3. `EventForm`: Runtime (min), optional, plus the show/hide checkbox. Both write to whichever table the row lives in.
4. `ShowingForm`: "Runs For" is the per-show override. The placeholder and help now name the event's runtime ("Leave blank to use this event's runtime (1h 30m)"). With none set, the help points to the event form. Blank is stored as null, so a later edit on the event reaches the show.
5. Three readers that ignored the production's runtime now use the chain:
   - The Worker's JSON-LD `endDate` and availability: events were hard-coded `duration: null`.
   - The ticket calendar invite (`_shared/tickets.ts` `loadOrder`): it read only the film's runtime and ignored even a show's override.
   - Rentals room occupancy: it read only the show's own value, so a film's 3h runtime blocked the room for 2h.
6. No existing show's end time moves. A show's own value still wins, and no event has a runtime until someone sets one (verified in postgres:15).

**Production data, not checked:** a read-only count of event shows with their own `duration_minutes` was blocked from this session. Staging has none. On production, any event show with a typed-in value keeps it as an override and will **not** follow a later change to the event's runtime. Tom can check with:
`select count(*) filter (where duration_minutes is not null), count(*) from showings where event_id is not null or live_performance_id is not null;`

## Deploy order (matters)
**Apply the migration before deploying anything else**, on each environment:
1. `db push`
2. `functions deploy ticket-access send-ticket-confirmation` (they import `_shared/tickets.ts`, which now selects the event runtime)
3. `wrangler deploy`

Code that names the new columns fails against a database without them. The public movie select names `show_runtime` (the feed would lose every film), the Worker's showing select names `events(duration_minutes)` (share previews), and `loadOrder` names it too (ticket pages and confirmations).

## Tests
- `ProductionMedia.test.tsx`: `displayedRuntime` passes through when shown or absent. When hidden, rating and genre stay and the runtime goes.
- `purchasable.test.ts`: `isPast` and `showingEndsAt` give the same answers with `show_runtime` true or false.
- `Showing.test.tsx`: the runtime prints by default and is absent when unticked. A finished film with its runtime hidden still reads "This showing has passed."
- `MovieForm.test.tsx`: a new film saves `show_runtime: true`. A hidden one loads unticked and saves `false` with its duration intact. The box can be unticked.
- `EventForm.test.tsx`: blank runtime saves null and shown. A runtime plus a hidden badge saves both. A fractional runtime is not written. A legacy performance round-trips both values.
- `ShowingForm.test.tsx`: an event show's placeholder and help name the event's runtime, and blank saves null. With no event runtime, the help points to the event form.
- `Showing.test.tsx`: an event's runtime prints when set and hides when unticked.
- `worker/head.test.ts`: JSON-LD `endDate` uses the event's runtime, the default when none is set, and a show's own value over both.
- `_shared/tickets_test.ts`: `loadOrder` resolves show → event/film → 120.
- Migration on postgres:15: event shows end at +120 until the event has a runtime, then at it. A show's own 45 wins, films are unchanged, anon reads `movies.show_runtime`, and 0 is refused.
- Mutation check: reverting the Showing call site to the raw duration fails the "unticked" test.
