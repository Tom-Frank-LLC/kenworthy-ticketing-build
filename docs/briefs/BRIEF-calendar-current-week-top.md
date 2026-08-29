---
brief: calendar-current-week-top
title: Month calendar opens with the current week as the top row
status: built
track: ux
severity: P2
date: 2026-08-25
verified: false
---

# Brief (for Claude Code): Calendar opens with the current week at the top (not the first week of the month)

**Status:** 🟢 Focused change to one component. The main call is how far to reframe the month grid — a minimal "trim leading weeks" vs a rolling week-anchored view.
**Date:** August 25, 2026
**Requested by:** Tom — the Month calendar should **always load with the current week as the top row**, instead of defaulting to the first week of the month.

## Current state (verified — `src/components/home/MonthCalendar.tsx`)
- It's a **month-anchored** grid. `cursor = startOfMonth(initial)`, and the grid runs `gridStart = startOfWeek(startOfMonth(cursor))` → `gridEnd = endOfWeek(endOfMonth(cursor))` — i.e. always the whole month, starting from the week that contains the 1st.
- `initial` anchors to the **first upcoming dated item's month** (or today): `const firstDated = items.find(i => i.showingId); initial = firstDated ? toVenueWallClock(firstDated.startTime) : new Date()`. So it can even open on a *future* month's first week.
- Navigation is **by month** (`subMonths`/`addMonths`), header is `MMMM yyyy`, and out-of-month days are dimmed (`inMonth`).
- **Used in two places** — the `/calendar` page (`Calendar.tsx`, month view) and the home page's Upcoming section (`showHint=false`) — so this change improves both at once.
- **Relevant fact:** `useFeed` already filters out past showings, so **the weeks before today are always empty** on this grid. Leading with the first-of-month week just shows dead, empty rows before the first useful week.

## The change
Make the grid **week-anchored so the current week is the top row**, rolling forward. Two ways to do it — **Decision 1:**

- **Option A (recommended) — rolling weeks from the current week.** `gridStart = startOfWeek(today, { weekStartsOn: 0 })` and render a fixed number of weeks forward (e.g. **5 or 6**, Decision 3), regardless of month boundaries. Past (always-empty) weeks disappear; the current week is always the first row. Because the view can span two months:
  - **Header (Decision 2):** show the month(s) in view (e.g. "August–September 2026") or the visible date range, instead of a single `MMMM yyyy`.
  - **Navigation:** page forward/back by the same window (a "next weeks"/"previous weeks" step) rather than by calendar month — or keep month jumps but always snap the top row to a week start. Pick one and keep it predictable.
  - **Cross-month cells:** with no single "current month," the `inMonth` dimming loses meaning — either drop it or shade alternate months lightly so the month boundary is still legible. Keep `today` highlighted and keep the selected-day panel behavior.

- **Option B (minimal) — keep the month grid, trim leading weeks.** Keep month cursor/navigation and the `MMMM yyyy` header, but when the cursor is the **current month**, start the grid at `startOfWeek(today)` instead of `startOfWeek(monthStart)`, dropping the earlier (empty) weeks so the current week is on top. Future months still render full from their first week; navigating back behaves normally. Smaller change, keeps the month metaphor, but only the current month leads with "this week."

Recommend **A** for a planning calendar (past weeks are always empty here, so a forward-rolling view is honest and removes dead space); **B** if Tom wants to keep the familiar month grid and only fix the default load position.

## Also
- **Anchor to today, not the first upcoming item.** Change `initial`/anchor so the default view leads with **the current week** (today), per the ask — not the month of the first future show. (The first upcoming item still shows; it's just not what sets the top row.)
- Keep the **selected-day panel**, per-day event chips/dots, legend, and the "Tonight/EEEE" logic unchanged — only the grid's week framing and navigation change.
- Keep venue-wall-clock day keying (`venueDayKey`) so a late show still lands on the right day.

## Decisions for Tom
1. **Rolling week-anchored view (A, recommended)** vs **month grid that trims leading weeks (B)**.
2. **Header** when a view spans two months: month range / date range (A) vs keep `MMMM yyyy` (B).
3. **How many weeks** to show at once (5 or 6 recommended) and the **navigation step** (by page vs by month).
4. **Cross-month cells:** drop the dimming vs lightly shade alternate months.

## Test plan
- Opening `/calendar` (Month view) and the home month view both show the **current week as the top row**, with today highlighted — regardless of when the first upcoming show is.
- No empty pre-today weeks are shown above the current week.
- Per-day chips/dots, the selected-day panel (Tonight/day name, times, prices), the legend, and tapping a title all still work; venue-day keying still puts late shows on the right day.
- Navigation moves the window predictably (per Decision 3) and the top row always starts on a week boundary; the header reflects what's visible (per Decision 2).
- Mobile (dots) and desktop (titles) layouts both render correctly at 375/768/1280; no overflow.
- `npm run build` + tests pass.

## Outcome (2026-08-28)

Two framings, because opening position and navigation answer different
questions. The grid **opens week-anchored** on the current week, and switches to
**month-anchored** navigation the moment the reader pages — whole months from
the 1st, a month per arrow press, which is what this grid did before.

Window and view math live in `src/lib/calendarWindow.ts` with
`src/lib/calendarWindow.test.ts` covering them, rather than inside the
component: the date arithmetic is the part that can be wrong quietly, and it is
the part a component test would exercise least.

Decisions as taken:

1. **Opening view**: six rolling weeks from the current week. Six matches the
   tallest month grid, so switching modes does not resize the page.
2. **In-grid month headings.** Every month in view is named on the row it
   begins, and the month at the top of the calendar is always named — including
   in a month view, where the heading is the month itself and not the month its
   first row happens to start in (September's grid opens on Aug 30 and still
   reads "September 2026").
3. **Header** names the range in the week view (`Aug–Oct 2026`) and the month
   itself in a month view (`September 2026`). Ranges abbreviate the month:
   spelled out, the longest case ("September–November 2026") makes the nav row
   414px and wraps the arrows onto a second line on a 375px viewport;
   abbreviated, the widest case is 327px. Measured, not estimated.
4. **Forward from the opening view lands on the next month**, not the current
   one — forward should always move forward in time, never back onto a screen
   the reader has already partly seen. **Back lands on the current month in
   full**, which is the floor: `useFeed` fetches with `.gte('start_time', now)`,
   so everything before the current month is empty and the arrow disables there.
5. **Arrows are labelled by destination** (`Go to September 2026`), because from
   the opening week view "previous month" and "next month" would name neither
   of the two things the arrows actually do.
6. **Cross-month cells** drop the old in/out-of-month dimming, which faded the
   text on the days it applied to. Alternate months get a background band
   instead, keyed on the absolute month ordinal so a month keeps its shade while
   you page. In a month view this reproduces the old in/out-of-month reading for
   free: a focal month and both its neighbours always fall on opposite parities.

Two behaviours the brief did not specify:

- **Search follows its results.** `/calendar` passes the *search-filtered* feed,
  so a query matching only a December show would have rendered an empty grid
  with no hint of where the match was. `anchorView` moves the view only when the
  visible grid holds nothing at all, so it never yanks a view the reader paged
  to themselves — and it never changes mode, so a reader navigating by month
  stays in months.
- **The panel follows the grid.** It re-selects whenever the selected day is not
  on screen, rather than only when that day has no showings — otherwise paging
  to another month left the panel describing a day that had scrolled out of
  view.

The same anchor rule runs at mount, which is why the grid still opens on the
current week in every real case and shows the first upcoming shows rather than
six blank rows if programming ever gaps.

**Known consequence:** clearing a search leaves the view where the search put
it, because the rule only moves on an empty grid. Returning to the current week
on clear would mean passing the query into the component, which is wider than
this brief. Paging is likewise one-way: once in month navigation the grid stays
there until reload.

### Verified in the running app (staging data, 2026-08-28)

- `/calendar` and the home Upcoming section both open on the current week, today
  highlighted, 42 cells, headings August / September / October.
- Forward steps week view → September (Aug 30–Oct 3, headings September +
  October, *not* August) → October → November. Back retraces and stops on
  August in full, where the arrow disables and further clicks are no-ops.
- Searching "Nutcracker" from a November month view moved to December 2026,
  still in month mode, panel on December 20.
- The month band separates in-month from out-of-month days in a month view,
  measured from computed styles: `rgb(36,36,36)` against `rgb(23,23,23)`.
- Headings span all seven columns and their text is 151px, well inside a 375px
  viewport.
- Not verified in-browser: the 375px and 768px layouts. The driven Chrome tab's
  viewport is pinned at 1280, so the mobile grid could not be rendered. The
  header and heading widths — the new mobile risks — were measured directly.
