---
brief: listings-showtimes-on-showing-page
title: The ticketing page shows every upcoming showtime of its production
status: shipped
track: ux
date: 2026-08-28
shipped_in: ["#263", "#264"]
shipped_at: 2026-09-02
verified: true
---

# Brief (for Claude Code): Show all upcoming showtimes on a movie/event ticketing page

**Status:** 🟢 Adds a showtimes list to the showing page. The simple version reuses all existing per-showing load logic; an in-place switcher is a bigger follow-up.
**Date:** August 28, 2026
**Requested by:** Tom — `/showing/:id` is currently just the one showing. Add **all upcoming showtimes** for that movie/event so that arriving from a listing's or a calendar day's "Get Tickets" lands on the title's ticketing page and shows every showtime.

## Current state (verified — `src/pages/Showing.tsx`)
- The page is keyed by a single showing id (`useParams().id`, L374): it loads that **one** showing (`from('showings').eq('id', id).single()`, L431), its price tiers, then the production row (movie / event / live_performance by the showing's FK, L455–466), venue, seats, availability.
- It **never queries the production's other showings** — there's no "other showtimes" concept on the page.
- Listings and the calendar already deep-link to a specific `/showing/:id` (the soonest/clicked one): `ShowingPreview`, `BoothNote`, `EditorialCalendar`, `MonthCalendar` all route to `/showing/${showingId}`. So the entry points are in place; the page just needs to surface siblings.
- Prior art to reuse: `ProductionDetailDrawer` already renders an "upcoming showings" clickable list (date/time → `/showing/:id`) — the same shape this page needs.

## The change
1. **Fetch sibling showings.** Once the current showing loads (so its production FK is known — `movie_id` / `event_id` / `live_performance_id`), query **all upcoming showings of the same production**: same FK, `is_active`, and **not past** (reuse `isPurchasable`/`isPast` from `src/lib/purchasable.ts` so this agrees with every other surface), sorted soonest-first. One extra query.
2. **Render a "Showtimes" section** prominently on the page — near the top, below the title/poster and above (or beside) the purchase panel — listing every upcoming showtime with date · time · venue, and price/availability cues. Mark the **currently-selected** showtime (the one in the URL) distinctly.
3. **Selecting another showtime (Decision 1 — the main call):**
   - **Option A (recommended for v1):** each other showtime is a **link to its own `/showing/:id`**; the current one is highlighted and not a link. This reuses the page's entire existing load path (tiers, availability, seat map, eligibility, sold-out) with zero refactor and keeps every showtime individually shareable. Cost: a page navigation when switching.
   - **Option B (nicer, follow-up):** switch the active showing **in place** (update the purchase panel + URL via `replace`, no reload). Better UX, but it requires re-running all per-showing fetches on switch (price tiers, `showing_availability`, seat map, pass eligibility, sold-out/free-no-ticket state) — a real refactor and more failure surface. Recommend shipping A first, then B if wanted.
4. **Availability per showtime:** reflect each showtime's state in the list — a **sold-out** (capacity or `manually_sold_out`) showtime is shown but marked sold out; a **free / no-ticket** showtime reads "Free"; a **past** one is omitted (it's filtered out by step 1). Reuse the existing flags/helpers rather than recomputing.
5. **Single-showtime case:** if the production has only the one upcoming showing, render nothing extra (or just that single row) — don't add empty chrome.
6. **Landing on a past showing:** if the URL's showing has passed but the production has upcoming ones, surface those upcoming showtimes prominently (this page already shows a "passed" state — let it point forward to the live dates instead of dead-ending). **Decision 2:** just list the upcoming ones (recommended) vs auto-redirect to the soonest.

## Details
- Keep the current showing's purchase flow exactly as is; this is additive.
- Venue/date use the venue wall-clock + `formatShowtime` conventions already on the page.
- Accessibility: the showtimes are a proper list; the selected one has `aria-current`; links have clear names ("Tickets for Friday, Sep 12 at 7 PM"). Mobile: the list wraps/stacks cleanly (chips or rows) at 360–414px.
- SEO/OG unchanged — each showtime keeps its own canonical URL.

## Decisions for Tom
1. Showtime selection: **links to each `/showing/:id`** (recommended v1) vs **in-place switch** (follow-up).
2. Past-showing landing: list the upcoming showtimes (recommended) vs auto-redirect to the soonest upcoming.
3. Presentation: a compact row/chip list of dates (recommended) vs a richer per-showtime card.

## Test plan
- Opening a movie/event `/showing/:id` shows a **Showtimes** section listing **all upcoming showings** of that title, soonest first, with the current one marked; a title with one upcoming showing shows no extra clutter.
- From a listing or a calendar day, **Get Tickets** lands on the title's page and all its showtimes are visible; selecting another showtime (per Decision 1) reaches that showtime's purchase.
- Sold-out / free-no-ticket / past states are reflected correctly per showtime (reusing the shared helpers); past showtimes don't appear.
- Landing on a passed showing surfaces the upcoming ones (per Decision 2), not a dead end.
- The existing purchase flow for the selected showing is unchanged; accessible and responsive at 360/375/390/1280.
- `npm run build` + tests pass.

---

## What was built (2026-09-02)

All three decisions were taken as recommended, and none of them turned out to
be the interesting part of the work.

1. **Links, not an in-place switch.** Each other showtime is a link to its own
   `/showing/:id`. Option B was not started.
2. **A passed showing lists the upcoming ones**, under a heading that changes
   to "Upcoming showtimes". No redirect: a shared link keeps meaning the date
   it named.
3. **Compact chips**, because they already existed.

### The brief's plan was one component too pessimistic

It proposed building a showtimes list and pointed at `ProductionDetailDrawer`
as prior art to copy. But PR #187 had already extracted that list into
`src/components/home/ShowtimeChips.tsx`, where it does date · time, free,
sold-out, `isPast` and the accessible names — everything step 2 asks for
except marking the current date. So the work became: give that component the
one behaviour it lacked, and give the page a query.

The chips are now shared by three surfaces (listing preview, curator's pick,
ticketing page) instead of two.

### Changes

| file | what |
|---|---|
| `src/lib/showtimes.ts` | new. `fetchSiblingShowings` — one query for the production's run. |
| `src/components/home/ShowtimeChips.tsx` | `excludeShowingId` → `currentShowingId` + `currentMode: 'exclude' \| 'mark'`; optional venue label. |
| `src/components/home/TrailerFeed.tsx` | `UpcomingShowing` gains `duration_minutes` and `venue_name`, both optional. |
| `src/pages/Showing.tsx` | fetches the run alongside the existing loads; renders the section above the buy flow. |
| `src/components/home/ShowtimeChips.test.tsx` | new. 9 tests. |

### Three things worth knowing

**"Upcoming" cannot be asked of the database.** A showing is not past until it
*ends*, and the end resolves through the showing's `duration_minutes` → the
film's → a 120-minute default (`src/lib/purchasable.ts`). A
`start_time >= now` filter would drop a programme that began an hour ago and
is still selling — including, on this page, the very date the reader is
looking at. So the query casts a bounded 12-hour net backwards and `isPast`
decides. The constant is documented where it lives.

**The resolved runtime has to travel with the row.** `ShowtimeChips` asks
`isPast` again at render (deliberately — it must agree with the Get Tickets
button beside it), and it has no production row to fall back through. Handed
the raw column, a long film with no per-showing override would survive the
filter in the lib and be dropped in the component. `fetchSiblingShowings`
therefore sends `resolveDurationMinutes(...)`, not `showings.duration_minutes`.

**A PostgREST builder runs its query on every `.then`.** The page needs the
production row and the showtimes list needs its runtime. Handing the builder
to both would have fetched the production twice; it is converted to one real
promise and awaited twice.

### Two props that both meant "the current showing"

`excludeShowingId` was renamed rather than joined by a second id prop. The
listings leave the current date out (it is named above the chips); this page
keeps it and marks it. Those are two answers to one question, and a pair of
id-shaped props is how they would have drifted apart — which is the reason
the component was extracted in the first place.

### Verified

Against production data through a local build, at 360 / 390 / 414 / 1280:

- **The Odyssey**, 6 upcoming — 6 chips, 5 links, current marked, correct
  from both the first and the fourth date.
- **A free event**, 2 upcoming — both read "Free", current marked.
- **Silent Film Festival: The Crowd**, 1 upcoming — no section at all.
- **A passed showing** (clock faked to 2026-09-06) — "Upcoming showtimes"
  over the 3 live dates, above the unchanged passed notice.
- No horizontal overflow and no clipped chip at any width; at 360px the chips
  stack one per row.

Sold-out marking is covered by unit test only — no upcoming showing on
production currently carries `manually_sold_out`.

### Not done

- Option B, the in-place switcher.
- Per-chip availability *counts* ("3 left"). The brief asked for
  availability cues; sold-out and free are shown, a seat count is not — it
  would be one `showing_availability` read per date.

### Found on the way, not fixed

Two active showings on production point at event `39564707-c595-41be-a7d9-
3d91bc744c14`, which the `anon` role cannot read. The ticketing page for
those dates renders with a blank title and a 406 in the console. This
predates the change and is untouched by it, but it is live and visible.

### Follow-up: the first sideways link exposed a dormant bug (#264)

Adding links between showings made the page reachable from itself for the
first time, and `loading` starts `true` but was only ever set `false` — never
back to `true` when `id` changes. So a chip click changed the URL while the
page went on rendering the previous showing's date, prices, seat map and
order summary until the new fetch landed.

Not cosmetic: checkout posts `showing_id: id`, the URL's id, so a purchase
begun in that window would have been written against the showing the reader
navigated *to* with the prices and seats of the one they came *from*.

Fixed in #264 — the effect clears the state it is about to replace, and a
`cancelled` flag stops a superseded load from landing last. Worth
remembering as a shape rather than an incident: state that is only ever
*written* on load is safe until something lets you load twice.

### Deployed to production 2026-09-02

`wrangler deploy`, version `1678a750-13c3-468f-975c-397e44ec1943` (rollback:
`51f52d32-3097-4a5d-9215-49a356734f4f`). Production was verified to be exactly
pre-change `main` before the deploy — a fresh `build:production` of 72ee6fe
reproduced its entry-chunk hash exactly, so nothing unmerged was overwritten.

Verified in the running production UI, not from the upload log: The Odyssey's
six dates with the current one marked from two positions, the free event pair
both reading Free, a single-showing film rendering no section, no horizontal
overflow at 390 or 1280, and a chip click landing on the new date with no
stale content at any sample point.
