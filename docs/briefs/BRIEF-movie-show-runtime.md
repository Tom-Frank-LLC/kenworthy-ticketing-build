---
brief: movie-show-runtime
title: An admin can hide a film's runtime from the public page without changing when its showings end
status: built
track: feature
severity: P2
date: 2026-10-02
verified: false
evidence: migration 20261002195410_movies_show_runtime.sql; displayedRuntime() in src/components/ProductionMedia.tsx
---

# Brief (for Claude Code): Show/hide-runtime checkbox for movies (and the events question)

**Status:** Part A (movies) built. Part B (events) is waiting on Decision 1. Events have no runtime field, so there is nothing to hide on them yet.
**Date:** October 2, 2026
**Requested by:** Tom asked for a backend checkbox to show or hide the runtime on movies and events.

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

### Part B: events (Decision 1, open)
Events and live performances have no runtime, so a toggle on them would govern nothing. One option is movies only. The other is to add `duration_minutes` + `show_runtime` to `events` (and maybe `live_performances`), add the fields to `EventForm`, and decide whether an event runtime replaces the fixed fallback length (`DEFAULT_SHOWING_MINUTES`, `_shared/calendar.ts`) in end-time math.

## Deploy order (matters)
**Apply the migration before deploying the frontend**, on each environment. The public select names `show_runtime`. On a database without the column, PostgREST rejects the whole movies query, and the feed and every film's Showing page lose their films.

## Tests
- `ProductionMedia.test.tsx`: `displayedRuntime` passes through when shown or absent. When hidden, rating and genre stay and the runtime goes.
- `purchasable.test.ts`: `isPast` and `showingEndsAt` give the same answers with `show_runtime` true or false.
- `Showing.test.tsx`: the runtime prints by default and is absent when unticked. A finished film with its runtime hidden still reads "This showing has passed."
- `MovieForm.test.tsx`: a new film saves `show_runtime: true`. A hidden one loads unticked and saves `false` with its duration intact. The box can be unticked.
- Mutation check: reverting the Showing call site to the raw duration fails the "unticked" test.
