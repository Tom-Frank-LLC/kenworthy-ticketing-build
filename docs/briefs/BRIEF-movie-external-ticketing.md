---
brief: movie-external-ticketing
title: A film can be ticketed through an outside site, the way an event can, and nothing sells against it here
status: built
track: feature
severity: P2
date: 2026-09-22
shipped_in: ["#329"]
shipped_at:
verified: false
---

# Brief (for Claude Code): External ticketing for movies (same as events)

**Status:** built 2026-09-22 (see *What was built* at the end) — was: 🟢 Mostly plumbing — the pattern already exists for events/performances; movies just need the columns, the form control, and to be included in the selects. The care item is the server boundary (internal checkout must refuse an externally-ticketed movie).
**Date:** September 22, 2026
**Requested by:** Team — "add ticketing from an outside website for movies (the same as how it works for events)."

## Current state (verified, build `931e141`)
- **Events & live_performances already support it.** They carry `ticket_type` (`event_ticket_type` enum: `ticketed` | `rsvp` | `info_only`) + `rsvp_url` (migration `…unify_live_event_type_and_ticketing`). `EventForm` shows a ticketing-mode select and a conditional **RSVP URL** field (`EventForm.tsx:68,185–188`), saving `rsvp_url` only when mode is `rsvp`.
- **Movies do NOT have these columns**, and `MovieForm` has no ticketing-mode control.
- **The feed is already generic.** `useFeed.ts` and `Index.tsx buildFeed` map `ticketType: prod.ticket_type` / `rsvpUrl: prod.rsvp_url` for **every** production type including movies (they just come back `undefined` today).
- **The external CTA is already generic.** `ProductionDetailDrawer.tsx:94–104` renders "RSVP Now" (external link) for `ticket_type === 'rsvp' && rsvp_url`, nothing for `info_only`, and the normal internal path otherwise — keyed off the flags, not the production type. So once movies carry the flags, this renders for them automatically.

## The change
### 1. Data (mirror the events migration)
Add to `public.movies`: `ticket_type public.event_ticket_type NOT NULL DEFAULT 'ticketed'` and `rsvp_url text` (the enum already exists — reuse it). Add both columns to the **anon column-level SELECT grant** on `movies` so the public feed can read them (movies use a column-scoped grant). Default `ticketed` keeps every existing movie behaving exactly as now.

### 2. Admin form (`MovieForm`)
Add the same ticketing-mode control EventForm has: a select — **Ticketed** / **RSVP (external link)** / **Info only** — and a conditional **"RSVP URL"** input shown only for `rsvp` (validate it's an `https://` URL). Save `rsvp_url` only when mode is `rsvp` (null otherwise), same as EventForm. **Decision 2:** extract EventForm's ticketing control into a shared component and use it in both (recommended, DRY — events/performances already share a form) vs duplicate the fields into MovieForm.

### 3. Carry the columns into every movie select
The feed logic is ready; it just needs the data. Add `ticket_type, rsvp_url` to each place movies are queried for public display: **`useFeed.ts`**, **`Index.tsx` buildFeed**, the **Showing page** production fetch (`Showing.tsx`, the movie branch), and the **Calendar** feed if it selects movie columns separately. Then listings, the drawer, and previews render the external/info-only CTA for movies with no further UI work.

### 4. Showing page + checkout must honor it (the boundary — don't skip)
A movie set to `rsvp` or `info_only` must not be sellable through the internal Square checkout:
- **Showing page (`/showing/:id`):** when the movie is `rsvp`, the CTA links to `rsvp_url` (external, `target=_blank rel=noopener`); when `info_only`, show no ticketing CTA; when `ticketed`, unchanged internal flow. Mirror the drawer's existing logic.
- **`ticket-checkout` (server):** refuse an order for a showing whose production is `rsvp`/`info_only` with a clear message — same "browser hides, server refuses" discipline used for past/sold-out/free-no-ticket showings, so a stale tab or direct call can't sell a ticket the theatre isn't selling.
- **ShowingForm / Square:** for an `rsvp`/`info_only` movie, the price-tier section is irrelevant (nothing sells internally) — hide it as EventForm hides seat pricing for non-ticketed modes, and **skip `ensure_showing`** (no Square variations needed), consistent with events.

### 5. Showings still schedule the dates
An externally-ticketed movie can still have showings so its dates appear on the calendar/listings with the external CTA — the showing carries the date/time; ticketing just points out. **Decision 3:** confirm they want the movie's showtimes listed (pointing to the outside site) — recommended, matches how a dated RSVP event behaves.

## Decisions for Tom
1. Flag level: **movie (production) level**, mirroring events — all its showings route externally (recommended, "same as events") vs per-showing external URLs.
2. Form control: **shared ticketing-mode component** reused by movie + event/performance forms (recommended) vs duplicate fields.
3. Showings for an external movie: still create showings so dates list with the external CTA (recommended) vs no showings.
4. Whether `info_only` is offered for movies too (recommended — full parity) or only `ticketed` + `rsvp` external.

## Test plan
- A movie can be set to **RSVP (external link)** with a URL in `MovieForm`; existing movies stay **Ticketed** (default) and behave exactly as before.
- Listings, the detail drawer, previews, and the showing page show an **external "RSVP/Tickets" link** for an rsvp movie (opens the outside site), **no ticketing** for info-only, and the normal internal checkout for ticketed.
- **`ticket-checkout` refuses** an internal ticket sale for an rsvp/info-only movie (stale tab / direct call), with a clear message; no Square variations are created for it.
- The movie's showtimes still appear on the calendar with the external CTA (per Decision 3).
- Events/performances external ticketing is unchanged; `npm run build` + tests pass (add a test for the movie rsvp CTA and the checkout refusal).

## What was built (2026-09-22)

Decisions taken as recommended: production-level flag; one shared control
(`TicketingModeFields`); showings still carry the dates; `info_only` offered.

Four things the brief did not know, each of which changed where a piece went:

1. **The server boundary is SQL, not `ticket-checkout`.** Since #316–#321 every
   paid ticket row goes through `price_ticket_order`, which is where past,
   walk-in and sold-out are already refused — for online checkout *and* the
   counter. The refusal went there, beside them, for all three production
   tables: `PT409: Tickets for this showing are not sold here.` The edge
   function inherits it through `PricingError` with no code change. Comps are
   deliberately not refused (they never price); the SQL harness pins both.
2. **An RSVP event has no showings; an RSVP film does.** `ShowingForm` filters
   non-ticketed events and performances out of its picker, and the feed
   synthesises a dateless "standalone" item for them. A film's dates are the
   point, so movies stay pickable in any mode, and the showing takes nothing
   sale-shaped: no price field, tiers, seats, passes, buyer limit or sold-out
   switch, tiers cleared on save, eligibility emptied, `ensure_showing` skipped.
   `no_ticket_required` stays false — that flag means "Free, walk in", a
   different fact.
3. **The drawer hid the showtimes for an RSVP production.** With only the
   dateless kind existing, that was harmless; for a film it would have hidden
   the dates the reader opened it for. It now lists them (linking to the
   showing page, which shows the outside link) and drops the price badge.
4. **The outside button said "RSVP".** True of a community event, wrong for a
   festival film. `externalTicketLabel(type)` says *Get Tickets* for a movie.

Also: `MOVIE_PUBLIC_COLUMNS` replaces the three hand-copied column lists (the
column-level anon grant means every public read must name its columns, and the
lists had to be extended in three places for this change); an RSVP link is now
required and must be `https://` on both forms, because an RSVP production with
no link renders as ticketed here; the POS picker leaves externally ticketed
films out rather than surfacing the refusal with a patron waiting.

Files: `supabase/migrations/20260922203433_movies_external_ticketing.sql`,
`src/components/admin/TicketingModeFields.tsx`, `src/lib/movieColumns.ts`,
`ticketsSoldHere` in both `purchasable.ts` twins, `Showing.tsx`,
`ProductionDetailDrawer.tsx`, `TrailerFeed.tsx`, `MovieForm.tsx`,
`EventForm.tsx`, `ShowingForm.tsx`, `StaffPOS.tsx`. Tests: SQL harness (+6),
`MovieForm.test.tsx` (new), `Showing.test.tsx` (+4), `ShowingForm.test.tsx`
(+3), `purchasable.test.ts`, `liveEventTypes.test.ts` (new), `pricing_test.ts`.

Not done: the calendar's per-row badge still reads "RSVP" for a film (it is a
badge, not a button, and the drawer it opens says the right thing); the
`ticket_type` column comment on `movies` names the refusing function so the
next reader finds it.
