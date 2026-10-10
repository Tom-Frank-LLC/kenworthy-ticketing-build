---
brief: calendar-past-listings
title: The /calendar month grid pages back through the last twelve months of showings, read-only
status: built
track: feature
severity: P2
date: 2026-10-09
verified: false
evidence: src/hooks/useCalendarHistory.ts; checked on staging data 2026-10-09/10 (opens on this week, back arrow stops at the 12-month cutoff month, axe 0 violations, home page makes no history request)
---

# Brief: Show all past listings on the calendar

**Requested by:** Tom, 9 Oct 2026: include all previous listings on the calendar,
not just current and future ones, without slowing page load.

## What was decided

**History is capped at twelve months** (Tom, 10 Oct 2026, after the first
build paged back to June 2021). The cutoff is a rolling instant, the venue's
midnight on this date a year ago (`historyCutoff`, `HISTORY_MONTHS = 12`). The
back arrow stops at that month, and its days before the cutoff stay empty. On
10 Oct 2026 the grid reaches October 2025, showing the 10th onward. No query
asks for anything earlier. That replaces the "first showing on record" lookup,
which is gone. To change the window, change `HISTORY_MONTHS`.

Tom said "execute this" on a brief that offered four decisions, so its
recommendations were taken:

1. **Load strategy: per-month lazy load.** Each month's history is fetched when
   the reader pages to it, with the month before prefetched. Nothing extra
   loads up front beyond the current and previous month's ended showings (one
   small query each).
2. (Bounded window: not applicable.)
3. **Month grid only.** The List view stays an upcoming planner. The shared
   feed (`useFeed`) and `fetchSiblingShowings` still use the −12h grace window,
   so the home page, carousel and showing pages are unchanged.
4. **Past showings are read-only.** In the grid an ended showing is plain text,
   not a button. Clicking it opens that day's panel, which lists what played
   with an "Ended" label and no button, price or path into the drawer.
   `Calendar.tsx` `handleSelect` also refuses `item.ended` as a second check.

Past days are marked by **shape, not colour**: dashed cell edge, dashed rule
beside each title, hollow dots on mobile, an outlined count badge, and ", past"
in the day's accessible name. Titles use the solid `muted-foreground` token,
never a faded one.

## What the brief had wrong (verified in code and data)

- **"`anchorView` opens on the current week regardless": false.** The grid's
  opening week came from `calendarStart(dayKeys)`, which is the *earliest* day
  it is handed. Given history, it would have opened on the oldest loaded week.
  `calendarStart` is now asked only of days with live (not-ended) showings.
- **Search would have jumped to the oldest match.** `anchorView` followed the
  earliest populated day. It now follows the soonest day from today on, and
  only falls back to the latest past match (as a month view) when nothing is
  coming.
- **The re-anchor effect would have yanked readers.** It re-ran whenever the
  set of populated days changed, so history arriving for one month would
  re-anchor a reader who had paged into an empty month. It now fires only when
  a populated day drops out, which is what a search does. History only adds
  days, and the hook keeps every month loaded this visit for that reason.

## Data shape this depends on (production, measured 2026-10-09)

- 1,827 past showings, the first on **17 Jun 2021**, roughly 35 a month.
- **1,749 of them are `is_active = false`**: the 10–11 Aug 2026 archive import.
  No past inactive showing was created after the import. So the history query
  has **no `is_active` filter**; with one, history would start 14 Aug 2026.
  Anon can read them because the SELECT policy admits `start_time < now()`
  (`20260909180838`).
  - Caveat: a showing staff deactivate to cancel will appear in history once
    its date passes. None exists today.
- 1,314 of 1,315 past productions are active. Productions still need
  `is_active` under RLS, so a hidden title's showings are dropped.
- **Productions are embedded in the showings read**, not read as "all active
  titles". The next section explains why.

## Also fixed here: the feed's films read was over the 1,000-row cap

Tom asked for this to ship as part of the brief (9 Oct 2026).

`fetchFeed` used to read every active film, event and performance, then join
them in the browser. Production has 1,131 active films, and the anon read
returned exactly 1,000 (checked with curl, 2026-10-09). No upcoming showing was
dropped yet (44 of 44 matched), but only because of row order: a newly added
film could fall outside the 1,000, and its showings would vanish from the home
page and calendar with no error.

Now the showings read embeds its production (`SHOWING_WITH_PRODUCTION`:
`movie:movies(MOVIE_PUBLIC_COLUMNS), event:events(*),
live_performance:live_performances(*)`), the same pattern `src/pages/Rentals.tsx`
already used. A second, parallel read fetches only the standalone RSVP /
info-only events (5 on production). Still one round trip.

- **Same output.** On production, before and after both give the same 44
  upcoming showings and the same 5 standalone candidates.
- **Hidden titles stay hidden.** `embeddedProduction` requires
  `is_active === true`, as the old `.eq('is_active', true)` did. That matters
  for signed-in staff, whom RLS lets read hidden titles.
- **`productionsById` holds only the titles the feed lists.** Its two readers,
  `Index.tsx` and `Calendar.tsx`, look titles up from feed items only.
- **Smaller download.** The old reads were about 516 KB per home or calendar
  load (films 444 KB, events 71 KB). The new showings read is about 14 KB.
- The history hook uses the same select and the same `embeddedProduction`.

## Limits

- Search on the grid covers upcoming showings plus the months loaded so far,
  not the whole archive. Searching the whole archive needs a server-side
  search; it is a separate feature.
- Archive rows on staging have no posters, so the day panel shows the
  type-icon placeholder for them.
