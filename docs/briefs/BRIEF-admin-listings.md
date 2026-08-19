---
brief: admin-listings
title: Admin Dashboard — Listings Section Improvements
status: needs-triage
track: ux
severity: P0
date: 2026-08-12
verified: false
---

# Brief: Admin Dashboard — Listings Section Improvements

**Status:** 🔴 Launch-important (staff's most-used surface)
**Date:** August 12, 2026
**Requested by:** Tom

---

## Context

The Listings section of the Admin Dashboard (`src/pages/admin/AdminDashboard.tsx`) is what staff will use most, and it isn't fully functional yet. This brief covers four issues found together, plus a related data-backfill (trailers) discovered while investigating.

All four are grounded in the current code — file/line references included so implementation starts from the working source, not assumptions.

---

## 1. Sort by showtime (chronological, latest-future first) — 🔴 core

**Problem:** The sort dropdown (line ~452) offers Title A–Z, Title Z–A, Newest first, Oldest first. But "Newest/Oldest" sort by **`created_at`** (`sortItems`, lines ~151–155) — and because all records were imported at once, their `created_at` values are nearly identical, so those options produce **no visible change**. There is **no way to sort by actual showtime**, which is what staff actually need.

**Desired behavior:** Movies and events should sort **chronologically by their showing date**, with the **latest (farthest-future) dates first** and oldest last — the default view.

**Implementation notes:**
- The showings data is already loaded (`showings` state, fetched line ~94 ordered by `start_time` desc). Each movie/event's showings are available via `getMovieShowings(id)` / the event equivalents.
- Sorting a *production* (movie/event) by showtime requires a representative timestamp per production. Recommend: **the max (latest) `start_time` among that production's showings** for "latest-first" ordering — so a title with an upcoming showing sorts above one whose last showing was years ago. (Alternatively the *next upcoming* showtime; decide which reads better for staff — max-future is simplest and matches the request.)
- Add sort options: **"Showtime (upcoming first)"** and **"Showtime (past first)"**, and make **upcoming-first the default** (replacing Title A–Z as default).
- Keep Title A–Z / Z–A as secondary options.
- Retire or fix "Newest/Oldest by date added" — since it's meaningless post-bulk-import, either remove it or relabel clearly as "Date added" so staff aren't confused by a no-op.
- ⚠️ This interacts with the known 1000-row cap / pagination refactor (see TASKS.md). Client-side sort only orders what's loaded. If the listings view is filtered to `is_active = true` (small set) as planned, client-side sort is fine. Confirm the interaction before shipping.

---

## 2. Click ticket count to see attendee list — 🟡

**Problem:** The `X / 200` ticket count (`TicketCountBadge`, line ~195; used ~522 and ~584) is display-only. There's no way to click it to see **who** is attending a given showing.

**Desired behavior:** Clicking the count opens a view (drawer or modal) listing the attendees for that showing — name, email/phone, ticket count, seat (if assigned), order/purchase time, and status.

**Implementation notes:**
- Data exists: `tickets` table has `showing_id`, links to profiles/orders. `getTicketsSoldForShowing(showingId)` (line ~108) already counts them — extend to fetch the actual rows.
- There is an **"Export contacts"** button already on events (line ~585) — the same underlying attendee data feeds both. Reuse that query path.
- Show it in a drawer/modal, not a navigation, so staff stay in context.
- Include a count-to-capacity summary header and the attendee table.
- Respect privacy: this is staff-only (admin/staff role), already gated by the dashboard.

---

## 3. Per-listing "Preview" button → opens the public drawer — 🟡

**Problem:** Admins can't easily see how a listing will appear to the public.

**Desired behavior:** Add a **Preview** button to each listing row (movies and events). Clicking it opens the **same `ProductionDetailDrawer`** the public sees on the homepage/calendar, populated with that production's data — so staff can verify poster, trailer, description, badges, and showings before/after editing.

**Implementation notes:**
- `ProductionDetailDrawer` (`src/components/ProductionDetailDrawer.tsx`) already exists and is the public drawer. Reuse it directly — do not build a second preview component.
- It expects a `production` object plus an attached `showings` array (recall the drawer reads `production.showings`). Build the same shape the calendar/home `handleSelect` builds: the production record + its showings mapped to `{ id, start_time, ticket_price }`.
- Add a ghost icon-button (eye icon) in each row's action cluster (near the existing edit/delete buttons, ~501 for movies, ~585–595 for events).
- Wire it to local drawer state in AdminDashboard (mirror the calendar page's `selected` + `drawerOpen` pattern).
- This gives staff true WYSIWYG confidence and doubles as a quick QA tool.

---

## 4. Backfill trailer URLs from the WordPress export — 🔴 data fix

**Problem:** Trailers "didn't import." Investigation shows the trailers **exist in the source data** — **809 of 1,508** events have a YouTube/Vimeo embed link in their WordPress content — but the original import never extracted them into `movies.trailer_url` / `events.trailer_url`. So the field is empty across the board.

**Desired behavior:** Backfill `trailer_url` for all movies/events that have an embeddable trailer link in the source, matching titles to existing DB rows.

**Implementation notes:**
- This mirrors the missing-showings recovery (`kenworthy_showings_fix.sql`): parse the source JSON, extract the first `youtube.com|youtu.be|vimeo.com` URL from each event's `content`, normalize to a canonical form, and generate idempotent `UPDATE` statements keyed on `title` (with HTML-entity cleaning applied to titles, as before).
- Source pattern observed: `youtube.com/embed/<id>?si=...`. Normalize consistently (the drawer's `getEmbedUrl` helper already handles embed/watch/short forms, so store whatever the drawer can consume — likely the watch or embed URL).
- Run against **staging first**, verify a few trailers render in the drawer, then production.
- ~809 candidates; some may not title-match (private rentals, renamed events) — report unmatched count.
- Once backfilled, this also feeds the Showing-page media parity work (`BRIEF-showing-page-media.md`) and the Preview drawer above.

---

## Suggested sequence

1. **Trailer backfill (#4)** — pure data script, unblocks the visual work and is independent. Do first.
2. **Showtime sort (#1)** — highest daily-use value for staff; the core fix.
3. **Preview drawer (#3)** — reuses existing component; quick win once #4 gives trailers to preview.
4. **Attendee list (#2)** — reuses the export-contacts query path.

Items #1–#3 are frontend changes to `AdminDashboard.tsx` (+ reuse of the existing drawer); #4 is a one-time SQL backfill. #2 and #3 are the more contained; #1 needs care around the pagination/row-cap interaction.

---

## Out of scope (tracked elsewhere)
- Full Listings/Archive merge + server-side pagination (TASKS.md).
- Pricing tiers (TASKS.md).
- Broader admin-dashboard navigation cleanup beyond Listings (note: Tom flagged the dashboard is "messy to navigate in a number of ways" — worth a separate pass after Listings is solid).

---

# Outcome — implemented 2026-08-12

## #4 Trailer backfill — ✅ already applied, no action taken

`kenworthy_trailers_fix.sql` was **already run against both production and
staging** before this session. Verified rather than assumed, by diffing the
SQL against live data through the REST API:

| check | movies | events |
|---|---|---|
| UPDATE statements in the SQL | 774 | 13 |
| titles matching a live DB row | 774 | 13 |
| **unmatched titles** | **0** | **0** |
| rows whose live `trailer_url` is *value-identical* to the SQL | 774 | 13 |
| trailers set from some other source | 0 | 0 |

Staging shows the same totals (774 / 13 of 1087 movies / 198 events), so the
two projects are in sync on this field. All 787 stored URLs were re-parsed
through `resolveTrailer` (`src/lib/trailer.ts`) — **787/787 resolve**, 771
YouTube + 16 Vimeo, so every one of them will render in the drawer.

The brief's "~809 candidates" was a count of embed links in the raw WordPress
content. The generator resolved these to 787 distinct production-level
trailers; the difference is duplicate links across showings of the same
production. There is no unmatched remainder to chase.

**The SQL is idempotent** (`WHERE trailer_url IS NULL OR trailer_url = ''`), so
re-running it is harmless but pointless. Nothing was re-run.

## The row cap was the real blocker for #1 — fixed

The brief flagged "confirm the interaction with the 1000-row cap before
shipping." Confirmed, and it was worse than a caveat:

- **PostgREST caps every response at 1000 rows, hard.** Verified: `Range: 0-1999`
  on `movies` still returns `content-range: 0-999/1087`.
- `movies` holds **1087** rows, so `loadData()` was silently dropping ~87+
  titles — the *tail of the alphabet was invisible in the admin dashboard*, and
  would have been invisible to the new sort too.

A showtime sort over a title-truncated window is exactly the
"mechanically correct, visually wrong" failure: it would have looked right
while omitting titles that had upcoming showings. So `loadData()` now pages
through in 1000-row chunks (`fetchAllPages`), applied to all five tables.

Each paged query carries a **unique tiebreak** (`.order('id')`) — without a
total ordering, rows can shift between page requests and be silently dropped
or duplicated.

This is *not* the server-side pagination refactor in TASKS.md; the unwired
`src/hooks/useAdminListings.ts` scaffold is untouched and still supersedes
this later.

## #1 Showtime sort

Representative timestamp per production is the **max (latest) `start_time`**
across its showings, per the brief's recommendation. Productions with no
showings sink to the bottom in **both** directions (rather than posing as the
oldest), tie-broken by title.

New default is **Showtime (upcoming first)**, replacing Title A–Z — reflected in
the sort state, the URL-param fallback, and Reset. "Newest/Oldest first" were
relabelled **"Date added (newest/oldest)"** rather than removed, so existing
`?sort=newest` URLs keep working while the near-no-op is no longer mistakable
for a broken showtime sort.

Verified against live data: the comparator orders the 25 productions that have
showings from 2026-12-20 (Nutcracker) down to 2026-08-16, with the remaining
~1260 showing-less productions in a title-sorted tail.

**Caveat:** production currently has only **34 showings**, because
`kenworthy_showings_fix.sql` (426 inserts) is still unapplied there — a
separate pending TASKS.md item. The sort is correct now and gets
proportionally more useful once that lands.

## #2 Attendee list · #3 Preview drawer

New `src/components/admin/AttendeeSheet.tsx`. The `sold / capacity` badge is now
a button: on a movie it opens that single showing, on a live event it opens all
showings of the production. The embed query
(`tickets → profiles, seats, showings`) was validated against the live API —
**HTTP 200**, so all three FK relationships resolve.

It pulls the columns `exportContactsCsv` throws away. That helper only exports
`display_name` + `user_id` and carries an in-code note claiming profiles have no
emails — **`profiles` does have `email` and `phone`**. The sheet shows and
exports those. The old Export-contacts button is left as-is; it is now the
weaker of the two paths and worth retiring separately.

Preview reuses `ProductionDetailDrawer` directly — no second component — built
to the same shape as the calendar's `handleSelect`, with `ticket_price` coerced
via `Number()` because Postgres `numeric` arrives as a string and the drawer
calls `.toFixed()` on it.

## Found on the way: latent crash in the public feed (fixed)

`src/hooks/useFeed.ts:96` referenced `s.ticket_price` in the standalone-event
loop, where `s` is out of scope — it is the `const` binding of the *showings*
loop above. This is a **`ReferenceError` that kills the whole feed**, blanking
the home page and calendar, and TypeScript was already reporting it
(`Cannot find name 's'`).

It does not fire today: production has **0 active events** with `ticket_type`
of `rsvp`/`info_only`, which is the only branch that reaches the line. It
would fire the moment staff mark any event RSVP or info-only — a normal admin
action. Fixed to `ticketPrice: undefined` (`FeedItem.ticketPrice` is optional
and consumers already do `?? 0`). Committed in `3ce73f2`, so it predates this
work.

## Verification

`tsc --noEmit` clean for every file touched; `npm run build:staging` succeeds;
`vitest` 10/10 pass. The two remaining repo-wide type errors are both in the
**unwired** `useAdminListings.ts` scaffold and predate this session.

**Not verified:** the admin UI was not exercised in a browser — that needs
staff credentials. The attendee sheet has been proven to issue a valid query,
but has never rendered a non-empty result, because production has no ticket
sales beyond test data. Worth one manual pass after a real purchase.
