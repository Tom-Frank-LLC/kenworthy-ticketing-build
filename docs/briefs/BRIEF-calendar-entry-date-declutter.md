# Brief (for Claude Code): Calendar view — drop the redundant per-entry date/time line so titles get more room

**Status:** ✅ Shipped — `99cc1d8` ("stop the month grid from repeating the day it already shows").
**Date:** August 14, 2026
**Requested by:** Tom — on the **Calendar (month) view**, each entry repeats date/time info that's already implied by the calendar cell. Remove it from the entry so the **title** has more room.

## What "Calendar view" is + what's actually on each entry (verified, file:line)
- The List/Calendar toggle lives in `src/components/home/UpcomingList.tsx:112–113`; **Calendar view = `MonthCalendar`** (`src/components/home/MonthCalendar.tsx`).
- In the **month grid cells** (the `md+` per-listing block, `MonthCalendar.tsx:191–219`), each entry currently renders **three stacked lines**:
  1. a **showtime** line — `formatShowtime(it.startTime, 'h:mm a')` (**L212–214**), its own row above the title;
  2. the **title** — `it.title`, currently `line-clamp-1` (**L215–216**);
  3. an optional **curator note** snippet (`line-clamp-2`, L217–219).
- The **day/date is already the cell** (the day number, `format(day, 'd')`, L162), so per-entry date is redundant — Tom is right.

**One clarification baked in:** the only date/time text on each grid entry is the **showtime**, not a full date (there's no per-entry "Aug 14" anywhere — I checked the whole component). So "remove the redundant date info" = **remove that showtime line** from the grid entries. That's also exactly the line stealing vertical space from the title. See Decision 1 for the small time-vs-date judgment call.

## The change (`MonthCalendar.tsx` ~L205–219, the `md:` grid entry only)
1. **Remove the showtime line** (L212–214) from each grid-cell entry.
2. **Give the title the reclaimed space:** let it wrap to **two lines** (`line-clamp-2` instead of `line-clamp-1`) and/or bump it slightly, so longer titles read in the grid. Keep the type-colored left border and the hover/`onSelect` behavior unchanged.
3. Leave the **curator-note** snippet as-is (or keep it — Decision 2), and leave the **`+N more`** overflow (L220–224) and the **mobile dots** view (L172–189) untouched.

## Nothing is lost — where time still lives
The showtime still shows when a user drills in, so removing it from the crowded grid doesn't hide it:
- the **selected-day side panel** shows each entry's time prominently (`MonthCalendar.tsx:305`, `h:mm a`), and
- the **detail drawer** (`ProductionDetailDrawer`) lists each showing's full date + time.
So the grid stays a clean "what's on which day" overview; time is one tap away.

## Scope / non-goals
- **Grid cells only.** Don't strip the time from the selected-day panel (L305) or the drawer — those are the right places for it.
- Don't touch the **List** view, the `EditorialCalendar`, or any data/query logic — this is presentation in `MonthCalendar`'s grid entry only.

## Decisions for Tom
1. **Time vs date (the judgment call):** the redundant, space-eating line is the **showtime** (`h:mm a`). Recommended: **remove it** from the grid entries (matches "more room for titles"; time is still in the day panel + drawer). Alternative if you'd rather keep a time hint: move it **inline/compact next to the title** on one line rather than on its own row. Which do you want?
2. **Curator-note snippet** under the title in the grid: keep it (nice context) or also drop it to give titles even more room?
3. **Title lines:** allow up to **2 lines** (`line-clamp-2`, recommended) or keep 1 but larger?

## Test plan
- Calendar view, `md+`: grid entries show **title (+ optional note)** with **no per-entry time**; longer titles now wrap/fit instead of truncating at one line.
- The **day number** and per-day **count badge** still render; the **selected-day panel** and **drawer** still show the time.
- **Mobile** dots view unchanged; **List** view unchanged.
- `+N more` still appears when a day has >2 entries.
- `npm run build` passes.
