---
brief: live-events-section-ux
title: Live Events manages its own showings, and one door replaces two create buttons
status: shipped
track: ux
severity: P2
date: 2026-08-25
shipped_at: 2026-08-28
verified: true
evidence: >-
  Deployed to production 2026-08-28T05:07:21Z as worker version
  959f714f-8ad5-4f0b-8daf-104d217720a9 (rollback: 9d870cf0-ef06-4466-937d-a0123aacd1fc,
  a clean deploy of 272d20a). Verified against the live origin: AdminDashboard-DBHq4D1T.js
  and ShowingForm-C0i21v2B.js are byte-identical to the local production build and carry
  the change. Behaviour verified on staging in a signed-in browser — inline showings on
  each Live Event card, the Add Live Event chooser, and ?event= opening the form scoped
  with the standard film passes left unticked.
---

# Brief (for Claude Code): Improve the Live Events section of the admin dashboard (UX/UI flow)

**Date:** August 25, 2026
**Requested by:** Tom — Live Events needs attention: "Add Performance" and "Add Event" look like two versions of the same thing; and the only way to add a showing to an event/performance is from the **Movies** tab.

## Diagnosis (verified)
### 1. Two near-duplicate create paths
- **Add Event** → `/admin/events/new` → `EventForm.tsx` → `events` table. Fields: title, description, poster, genre, rating, **`ticket_type` (ticketed | rsvp | info_only)**, **`rsvp_url`**, active, trailer, featured.
- **Add Performance** → `/admin/concerts/new` → `ConcertForm.tsx` → `live_performances` table. Fields: title, description, poster, genre, rating, **`subcategory`** (e.g. concert), active, trailer, featured.
- They share ~80% of fields. The **only real differences**: events carry a **ticket_type + RSVP link** (so an event can be non-ticketed / external / info-only), while performances carry a **subcategory** and are effectively always ticketed. So Tom's read is correct — they're two versions of one "create a live event" function, split across two tables and two forms.

### 2. The front-end barely distinguishes them
Both `events` and `live_performances` flow through the **same public feed** (`buildFeed` maps `movie`/`event`/`concert` into one `FeedItem` shape) and render identically in listings and on the showing page. The **only** rendered divergence is **ticketing behavior**: an event with `ticket_type = rsvp`/`info_only` shows an external/RSVP path instead of "Get Tickets"; ticketed events and all performances behave the same. So the admin-side split (two tables/forms/buttons) is **heavier than the front-end actually needs** — evidence for unifying the admin UX.

### 3. Showings can't be managed from Live Events at all
- The **Movies** section (the good pattern, `AdminDashboard.tsx:822–895`) shows **each movie's showings inline** (date · price · venue · ticket count · edit/delete) and has an **Add Showing** button (L812).
- The **Live Events** section (`:930–992`) shows each event/performance as a card with badges + an aggregate ticket count — **no inline showings, no per-item Add Showing, and no Add Showing button anywhere in the tab.**
- So to add a showtime to an event/performance you must go to **Movies → Add Showing** (`/admin/showings/new`), then use the category selector (movie/event/concert) and find the item. `ShowingForm` supports those categories but **has no deep-link prefill** (it reads only `useParams().id` for edit; a new showing defaults to `category='movie'`). That's exactly the awkward flow Tom describes.

## The improvements
### A. Bring the Movies showings pattern to Live Events (the main fix)
Mirror the movie-card layout for each event/performance card:
1. **Inline showings list** under each Live Event card — reuse the exact block from Movies (`:853–891`): each showing's date/time, price, venue, `TicketCountBadge`, edit (`/admin/showings/:id`), delete. Use the existing `showingsForProduction(kind, id)` (already used for the attendee rollup at `:967`) as the data source.
2. **Per-item "Add Showing"** on each card that deep-links to the showing form **pre-scoped to that event/performance**, so the admin never touches a category selector.
3. **Section-level "Add Showing"** for parity with Movies (optional, since per-item is better).

**Enable the deep-link (`ShowingForm.tsx`):** add `useSearchParams` prefill so `/admin/showings/new?event=<id>` or `?performance=<id>` (and `?movie=<id>`) pre-sets `category` + `itemId` (and locks/derives the category). Today it can't be prefilled — this is the small enabling change. **Decision 3:** query-param prefill (recommended) vs a route like `/admin/events/:id/showings/new`.

### B. Reconcile "Add Event" vs "Add Performance"
- **Option 1 (recommended, no data migration): one "Add Live Event" entry** that asks the **type** up front, then shows the right fields. Either a single combined form with a **type selector** — "Ticketed performance / concert" vs "Community event (ticketed, RSVP, or info-only)" — that conditionally reveals `subcategory` (performance) or `ticket_type`+`rsvp_url` (event) and writes to the correct table; or one button that routes to the existing form for the chosen type. This removes the "which button do I click?" confusion while keeping the two tables intact.
- **Option 2 (bigger, decide separately): merge `events` + `live_performances`** into one `live_events` table with a `kind`/`subcategory` and a unified ticketing mode. Cleaner long-term and matches how the front-end already treats them — but it's a **data migration** touching the feed, the Square catalog mapping (both are `EVENT` product type), and the `showings` FKs (`event_id` vs `live_performance_id`) plus `ShowingForm`'s category logic. **Not required** for the UX win; flag as a future structural consolidation. **Decision 1/2.**
- Recommend **Option 1 now**, note Option 2 as a follow-up.

### C. Clarify the distinction in the UI
Whichever path, make the difference legible where the admin chooses: a one-line helper on each type ("A **performance** is a ticketed live show — concert, theatre, comedy. An **event** can be ticketed, RSVP, or info-only — community nights, screenings with a guest, etc."). Keep the existing list badges (`ticket_type` for events, `subcategory` for performances) so the two kinds stay distinguishable at a glance.

### D. Make the two Listings tabs feel like one system
Live Events should match Movies in card layout, actions, and inline showings, so switching tabs feels consistent (same edit/preview/delete/attendee affordances, same showings treatment). Reuse shared components rather than duplicating the movie block.

## Decisions for Tom
1. Reconcile the create paths via one "Add Live Event" typed entry (recommended) vs keep two buttons but add clarifying labels only.
2. Merge `events` + `live_performances` into one table now (cleaner, heavier — data migration) vs defer and keep two tables behind a unified UX (recommended).
3. Per-item Add Showing via `?event=`/`?performance=` prefill on `ShowingForm` (recommended) vs a nested route.
4. Keep both `ticket_type` (events) and `subcategory` (performances) as-is, or fold them into one "kind + ticketing mode" model as part of Option 1.

## Test plan
- Each Live Event card shows its **showings inline** (date/price/venue/ticket count/edit/delete), matching the Movies section.
- A **per-item "Add Showing"** on an event/performance opens the showing form **already scoped to that item** (no category selector step); saving creates a showing linked to the right `event_id`/`live_performance_id`, runs the same tier/eligibility/Square steps, and appears under that card.
- `ShowingForm` accepts `?event=<id>` / `?performance=<id>` / `?movie=<id>` and pre-sets category+item; the Movies "Add Showing" still works unchanged.
- The create flow (per Decision 1) presents **one clear way** to add a live event with the type made explicit; events can still be ticketed/RSVP/info-only and performances still carry a subcategory; both still render correctly on the public site.
- Preview/edit/delete/export-contacts/attendee actions still work on each card; filters still apply; empty state unchanged.
- If Option 2 is chosen later, existing events/performances migrate without losing showings, Square links, or feed placement (separate brief).
- `npm run build` + tests pass.

---

## Decisions taken (2026-08-27)

1. **One "Add Live Event" chooser in front of the existing forms**, not a
   combined form. `AddLiveEventDialog` asks which kind and routes to
   `/admin/concerts/new` or `/admin/events/new`; `EventForm` and `ConcertForm`
   are untouched. The sentence that tells the two apart lives in the dialog,
   where the choice is actually made.
2. **Tables stay separate.** `events` and `live_performances` are not merged.
   Option 2 remains a possible follow-up and needs its own brief.
3. **Query-param prefill**, not a nested route: `/admin/showings/new?movie=`,
   `?event=`, `?performance=`.
4. **`ticket_type` and `subcategory` keep their current meanings.**
5. **No Add Showing on an RSVP or info-only event.** Found while reading:
   `ShowingForm` lists ticketed events only, so the button would have opened a
   picker that could not reach the title it was opened from. Those events are
   dated by their RSVP link or not dated at all — and `Index.tsx` already
   handles both, placing an undated one after the calendar.

## What was built

- `src/components/admin/ProductionShowings.tsx` — the showings block, extracted
  from Movies rather than copied, so both listings render the same row.
  Exports `TicketCountBadge`, which used to be local to the dashboard.
- `src/components/admin/AddLiveEventDialog.tsx` — the chooser.
- `AdminDashboard.tsx` — Live Event cards now carry their showings inline and a
  scoped Add Showing; Movies cards gained the same scoped Add Showing so the two
  tabs offer the same affordances.
- `ShowingForm.tsx` — reads the scope on first render, states the category
  instead of offering it (with **Change** to reopen both pickers), and falls
  back to the pickers if the URL names a title it cannot list.

### One thing the port would have got wrong

The loader pre-ticks the standard film passes on every new showing, and the
category selector drops them again when you switch away from Movie. A deep link
never touches that selector, so a scoped concert would have arrived with the
standard pass ticked — a gala silently redeemable against a film pass, which is
the exact failure the selector's existing comment says it exists to prevent. The
defaults are now gated on the resolved category, with a test either way.

### Not done

- No section-level Add Showing in Live Events. An unscoped showing form opens on
  Movie, so the button would have been a step backwards from the per-card one.
- No merged PR: this was built on `feat/live-events-showings`, rebased onto
  `a4a49bf` and deployed directly, which is how this project ships. The branch
  is pushed and still wants a PR for the record.

### Verified in production (2026-08-28)

Checks: `tsc -p tsconfig.app.json --noEmit`, `vitest` (51 files, 647 passing,
15 of them new), `build:production`. `deno check` fails on an unresolvable
`npm:zod@3.23.8` — pre-existing, reproduces on an untouched checkout, and no
edge function was changed here.

Before deploying, production was confirmed *not* ahead of main: the live entry
bundle was byte-identical to a local build of `272d20a`, so nothing unmerged
was at risk of being reverted. The deploy also carried `f5c882c` (the
curator-slide feature, #218), which was already `status: built` on main with its
migration applied to production and only its frontend outstanding.

Behaviour confirmed on staging in a signed-in browser, not from bundle strings:
each Live Event card lists its showings inline, the Add Live Event chooser
renders both kinds with their explanations, and
`/admin/showings/new?event=<id>` opens on the named event with the category
stated rather than offered — and with "Accept passes at the door" unticked,
which is the film-pass trap above staying shut.
