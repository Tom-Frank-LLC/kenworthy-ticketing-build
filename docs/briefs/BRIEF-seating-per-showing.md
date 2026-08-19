---
brief: seating-per-showing
title: Seating is per-showing, venue owns the map — fix + seed the venue
status: needs-triage
track: bug
severity: P1
date: 2026-08-14
verified: false
---

# Brief (for Claude Code): Seating is per-showing, venue owns the map — fix + seed the venue

**Status:** 🟠 Draft for review — fixes a currently-broken assigned-seating path
**Date:** August 14, 2026
**Requested by:** Tom — the venue dropdown is empty; and assigned seating should be decided by the **showing/event/performance**, not the venue (the venue just provides the seat map). Kenworthy has one venue, which should default.

## Two problems
1. **Empty venue dropdown = the `Main Theater` venue row was never created — and there's no Venues UI.** There is **no seeded venue** (no `INSERT INTO venues` in migrations), and **no Venues tab/link anywhere in the admin** — the venue form is only reachable by typing `/admin/venues/new` or `/admin/venues/:id`. Crucially, **the 265-seat seat map DOES already exist**: migration `20260609161049` inserts ~265 seats and attaches them to a venue **named exactly `Main Theater`** (`… FROM seats s, venues v WHERE v.name = 'Main Theater'`), then sets `total_seats = 265, has_assigned_seating = true` on it. But because **no migration creates the `Main Theater` venue row**, that join matched nothing on this project — the seats landed in the global `seats` table but never linked to a venue. So the map isn't lost; it's **orphaned for want of its venue row**. RLS is fine ("Anyone can view active venues").
2. **Assigned seating is split-brained and effectively orphaned.** A migration comment moved seat selection "to venues," but:
   - The **customer booking** and capacity logic key off **`showings.requires_seat_selection`** (`Showing.tsx:91,151`; `…capacity_enforcement.sql`) — a **per-showing** flag that still exists.
   - The **admin seat-tier editor** gates on **`venues.has_assigned_seating`** (`ShowingForm.tsx:198` `showSeatOverride = … venueForEditor?.has_assigned_seating`).
   - The **showing form never sets `requires_seat_selection`** at all — so it's always its default (`false`). Net: even with an assigned-seating venue, no showing is ever in assigned-seating mode. The two halves don't connect.

## Target architecture (what Tom wants — and what fixes the above)
- **The venue owns the seat *map*** (`venue_seats` — the physical rows/seats), laid out once in the Venue form.
- **Each showing decides GA vs assigned seating** via the per-showing **`requires_seat_selection`** flag (a movie can be GA while a live performance in the same room is reserved). This is already the column the customer side reads — make it the single source of truth.
- **`venues.has_assigned_seating`** becomes "this venue *has* a seat map available" (a capability), not "every showing here is assigned." (Or drop it and derive capability from whether `venue_seats` exist for the venue.)
- **One venue → it defaults.** Seed the Kenworthy venue and auto-select it; keep the picker for future multi-venue.

## Changes
1. **Create the `Main Theater` venue row so the existing seat map attaches — you do NOT need to re-enter the chart.**
   - A small migration that `INSERT`s the venue named exactly **`Main Theater`**, then re-runs the `venue_seats` attach + the `total_seats = 265, has_assigned_seating = true` update from `20260609161049` (idempotently). That links the already-seeded 265 seats to a real venue and populates the dropdown.
   - In `ShowingForm`, when exactly one venue exists, **auto-select it** (don't require a choice).
   - (Only if the seeded 265-seat layout is *wrong* would you re-enter it in the Venue form — but the layout is already there; the gap was purely the missing venue row.)
2. **Per-showing assigned-seating toggle.** In `ShowingForm`, add an **"Assigned seating for this showing"** checkbox that writes `requires_seat_selection` (default off = GA). Available whenever the selected venue has a seat map. This is the switch that's missing today.
3. **Re-gate the seat-tier editor.** Change `showSeatOverride` to gate on the **showing's `requires_seat_selection`** (plus the venue having a seat map to draw from), **not** `venue.has_assigned_seating`. So the "Seat Pricing — This Showing" grid appears exactly when the showing is set to assigned seating.
4. **Reconcile the venue flag.** Treat `has_assigned_seating` as "venue has a map" (capability) — keep it for the picker label / to know whether to offer the per-showing toggle — or replace it with a `venue_seats` existence check. Don't let it gate *behavior*; behavior is the per-showing flag.
5. **Confirm the booking path.** The customer seat picker already reads `requires_seat_selection` — once the admin can set it and tiers are assigned, verify GA vs assigned both render correctly end to end (this is the currently-broken link).
6. **Add a Venues section to the admin dashboard.** There is **no Venues tab/link** today — venues are only reachable by typing `/admin/venues/new` / `/admin/venues/:id`. Add a Venues management entry (list + create/edit, linking to `VenueForm`) so venues and their seat maps are discoverable and editable.

## Immediate unblock (today)
Since there's no Venues UI yet, go directly to **`/admin/venues/new`** and create a venue named exactly **`Main Theater`** — that name matches the existing seat-map seed, so the 265 seats can attach (you may need to re-run the `venue_seats` attach from migration `20260609161049`). That populates the dropdown right now; the changes above make the per-showing control correct rather than venue-wide.

## Decisions for Tom
1. **Seed method:** seed the venue **row** via migration (dropdown works everywhere immediately) and hand-enter the seat map once in the Venue form — vs. create the whole thing in the admin UI. (Recommend: seed the row; enter/import the real seat map once.)
2. **`has_assigned_seating`:** keep it as a "has a map" capability flag, or drop it in favor of "does this venue have `venue_seats`?" (Recommend keep for now; it's a cheap label.)
3. Default GA for new showings (recommend), with assigned seating opt-in per showing.

## Test plan
- Venue dropdown shows the Kenworthy venue and auto-selects it on a new showing.
- Create a **movie** showing left as **GA** → no seat map at checkout; capacity is a simple count.
- Create a **live performance** showing, toggle **Assigned seating** → the "Seat Pricing — This Showing" tier grid appears; assign a couple of tiers to seat groups; save.
- Customer opens each: the GA one shows a quantity picker; the assigned one shows the seat map with tier prices/colors; buying a seat marks it taken.
- Confirm the same venue/room serves both a GA and an assigned showing without conflict.
- `npm run build` passes.
