---
brief: calendar-mobile-day-accordion
title: On a phone, a tapped calendar day opens under its own week
status: built
track: ux
date: 2026-08-28
verified: false
---

# Brief (for Claude Code): Mobile calendar — expand the selected day inline (accordion), not below the whole grid

**Status:** 🟢 Mobile-only interaction change to one shared component. The structural piece is rendering the grid week-by-week so a panel can sit between weeks; desktop is untouched.
**Date:** August 28, 2026
**Requested by:** Tom — on mobile, tapping a calendar day shows its details **below the entire calendar**, so you have to scroll past the grid to see them. Instead, the day's info should **slide out directly beneath the tapped day**, pushing the rest of the calendar (the weeks below) down, with an **easy way to collapse** it.

## Current state (verified — `src/components/home/MonthCalendar.tsx`)
- The grid is **one continuous `grid grid-cols-7`** of all `days` (L132–133, flat `days.map`).
- The **selected-day detail is a separate panel** rendered *after* the grid, in a `flex flex-col lg:flex-row` container (L122): on desktop it's the right-hand column; on **mobile it stacks below the whole grid** (L269+). So a tap at the top of the month requires scrolling past every week to read the result — exactly the problem.
- Tapping a cell sets `selectedDay` (L157/161); `selectedItems = byDay.get(selectedKey)` (L79–80) is the content to show.
- Shared component: used by the **home page** Upcoming month view and the **/calendar** month view — this fixes both.

## The change (mobile only)
Render the day detail **inline, directly under the week that contains the tapped day**, as an accordion; the weeks below flow down beneath it. Keep the desktop side-panel exactly as it is.

1. **Chunk the grid into weeks.** Replace the single flat `days.map` grid with **one 7-column row per week** (group `days` into rows of 7). This is the enabling change — you can only insert a panel *between* weeks if weeks are discrete rows.
2. **Insert the inline detail after the selected day's week (mobile).** After the week row that contains `selectedDay`, render a **full-width** (spans all 7 columns) detail panel — the same content as today's selected-day list (eyebrow "Tonight/EEEE", date, the per-showing list with poster/time/title/price, or the "Nothing on the marquee this day" empty state). Gate it `lg:hidden`; the **desktop side panel stays `hidden lg:flex`/`lg:block`** unchanged.
3. **Slide + push, don't overlay.** The panel expands in normal flow (a height/slide transition) so the weeks below **accordion down**; it doesn't cover the grid. Respect `prefers-reduced-motion` (no motion, just show/hide). **Decision 3.**
4. **Easy collapse (the ask):**
   - A clear **close control** on the inline panel (an X / "Close" or a chevron in its header).
   - **Tapping the same day again collapses it** (toggle).
   - Optionally tapping another day moves the open panel to that day's week.
5. **Mobile default state (Decision 2):** because `selectedDay` defaults to `initial`, a day is pre-selected — decide whether mobile **starts collapsed** (nothing expanded until a tap; recommended, so the month is scannable first) vs opens the initial day. Introduce a small `expanded` flag for mobile so "collapsed" is a real state distinct from "a day is selected." Desktop keeps showing the side panel as today.

## Details
- **Accessibility:** the day cell is the disclosure control — set `aria-expanded` and `aria-controls` pointing at the inline panel; the panel is focusable and the close button returns focus to the day. Keep keyboard toggle (Enter/Space already toggles selection — extend to expand/collapse). Screen readers should announce the expanded day.
- **Anchoring:** after expanding, the tapped day and the panel should be comfortably in view (the panel appears right below the day, so no scroll chase). Avoid layout jump — the week rows above stay put; only the rows below move down.
- **Reuse content:** factor the selected-day list into a small piece used by both the desktop side panel and the mobile inline panel, so they can't drift.
- Keep the venue-day keying (`venueDayKey`) and the existing chips/dots on cells unchanged.

## Decisions for Tom
1. Inline accordion under the selected day's **week** (recommended, full-width) vs directly under the single cell (harder in a 7-col grid; a full-width row under the week is the clean version).
2. Mobile **starts collapsed** until a day is tapped (recommended) vs opens the default day.
3. Motion: slide/height transition, reduced-motion aware (recommended) vs instant show/hide.
4. Extra collapse affordances: close button **and** tap-again-to-toggle (recommended) — confirm both.

## Test plan
- On mobile, tapping a day expands its details **immediately below that week**, with the weeks below pushed down; no scrolling to the bottom of the grid.
- A **close** button and **tapping the day again** both collapse the panel; tapping a different day moves the panel to that day's week.
- Empty days show the "nothing this day" state inline; days with shows list them with time/title/price and open the detail on tap.
- Desktop (`lg+`) is unchanged — the side-by-side panel still works on both the home and /calendar month views.
- Accessible: `aria-expanded`/`aria-controls` on the day, focus moves to the panel and back on close, keyboard toggles; reduced-motion respected.
- No horizontal scroll or layout jump at 360/375/390/414; `npm run build` + tests pass.

## Decisions taken

All four went the way the brief recommended:

1. **Full-width panel under the selected day's week.** A panel under a single
   cell cannot work in a seven-column grid without either overlaying the days
   beside it or reflowing the row.
2. **Mobile opens collapsed.** A day is still *selected* on load — the desktop
   column has to describe one — but `expandedKey` starts `null`, so the month is
   scannable before any of it is pushed down. The two are now separate states.
3. **Slide and push, reduced-motion aware.** A 200ms `grid-template-rows`
   transition, `motion-reduce:transition-none`.
4. **Both collapse affordances.** A close button in the panel header, and
   tapping the open day again.

## What the brief got wrong, and why

The "Current state (verified)" section above was read against the shared
checkout, which was on another branch and behind `origin/main`. On main this
component had already been rewritten: no `cursor`/`isSameMonth`, a
`CalendarView` from `src/lib/calendarWindow.ts`, and in-grid month dividers
rendered as `col-span-7` children. The line numbers in that section do not
point at anything. The problem it describes was real and unchanged.

That rewrite also supplied the answer to the structural question: the month
dividers already proved a full-width row can sit between two weeks. The panel
did not use that route, because a collapsed `col-span-7` grid child still
occupies a row and so contributes a row gap — one seam wider than every other
seam in the grid. Splitting into per-week rows puts the collapsed panel inside
its week's container instead, where it contributes nothing.

## How the animation works

`grid-template-rows: 0fr -> 1fr` on a one-row grid whose only child is
`overflow-hidden min-h-0`. This is the height transition that does not need the
height measured, which matters because the panel's height depends on how many
showings a day has and on poster loading.

The panel is **mounted collapsed**, not conditionally rendered: an element that
appears at full height has nothing to animate from. `invisible` is what keeps
the collapsed panel out of the tab order and the accessibility tree, and it is
transitioned alongside the rows because CSS holds `visibility: visible` for the
whole of an outgoing transition — so the content stays on screen while it
slides shut, and disappears only once it is closed.

`expandedKey` holds a day key rather than a boolean, so it self-clears whenever
the selection moves for a reason other than a tap.

## Verified

`src/components/home/MonthCalendar.test.tsx` covers opening collapsed, the
panel's position between its own week and the week below, both collapse
affordances, focus returning to the day, the empty-day state and keyboard
toggling. The position assertion is the one that matters: presence alone passed
before this change too.

In the browser at a 390px viewport, on **both** callers (`/calendar` and the
home page's Upcoming month view): panel top 1246px against a tapped cell
bottom of 1241px and a next-week top of 1883px; collapsed height 0 and
`visibility: hidden`; still visible 60ms into a close and gone by 560ms; focus
back on the day cell; no horizontal overflow. At 1589px the inline panel
computes `display: none`, the side panel is unchanged, and a click does not
move focus.
