# Brief: Listings Show Times One Hour Off — Diagnose & Fix

**Status:** 🔴 Correctness bug, customer-facing (wrong showtimes)
**Date:** August 12, 2026
**Reported by:** Tom — every listing's time is off by an hour.

> **Do not "fix" this with a +1-hour constant.** "Off by an hour" is the signature
> of a timezone-handling defect, and there are two independent ones here. A blind
> offset would mask whichever is actually present and break the moment DST math is
> reasoned about again. Confirm the cause with the queries below, then fix the
> structure.

---

## The one fact that frames everything
**Moscow, Idaho observes Pacific time (`America/Los_Angeles`), not Mountain.** The
team's notes repeatedly say "Mountain-time handling" — that conflation is the
through-line of this bug. Mountain is always exactly one hour ahead of Pacific
(both keep DST), so a Mountain assumption produces a **constant one-hour error
year-round**, which matches "all listings off by an hour."

## Storage is fine — the bug is in write + display
- `showings.start_time` is `TIMESTAMPTZ` (migration `20260217193113…:33`) — a true UTC instant. Not the culprit. The codebase's own test fixes the intended mapping: 7:30 PM Aug 14 **Pacific** must store as `2026-08-15T02:30:00Z` (`_shared/tickets_test.ts:54-58`).

There are **two** structural defects, and they're distinguished by *whether the confirmation email is also wrong*:

### Defect 1 — Display renders in the browser's timezone, not the venue's
The whole web UI formats with plain `date-fns` and **no `date-fns-tz`** (it isn't even a dependency):
- `Showing.tsx:560` `format(new Date(showing.start_time), 'h:mm a')`
- `MonthCalendar.tsx:209,292` (and the day-grouping keys at `:57,121` — a late show can land on the wrong calendar day too)
- `ProductionDetailDrawer.tsx:91`, `UpcomingList.tsx:14-17`, `TicketScanner.tsx:271`

`format(new Date(iso))` always uses the *viewer's* OS timezone. On a Mountain-set machine every Pacific showtime reads one hour late/early. **The confirmation email is the one path built correctly** — it pins the venue zone via `Intl.DateTimeFormat({ timeZone: VENUE_TIME_ZONE })` (`_shared/tickets.ts:25,50,135`, default `America/Los_Angeles`). That asymmetry (email right, web wrong) is the key diagnostic clue and points at this defect.

### Defect 2 — Write path depends on the admin's browser timezone (and the import may be Mountain-baked)
- `ShowingForm.tsx:240` uses `<input type="datetime-local">` → a naive wall-clock string; save does `new Date(startTime).toISOString()` (`:129`), which interprets that wall-clock in the **admin's browser zone**. From a Mountain-set machine, 7:30 PM is stored as `01:30Z` instead of `02:30Z` — one hour early, baked into the row.
- The historical/showings import (`kenworthy_showings_fix.sql`, referenced in `TASKS.md:137` as "correct **Mountain**-time handling," not in the repo) may have localized source times as Mountain, baking the same one-hour error into imported rows.

If Defect 2 is live in the data, **even the email is wrong** — which is how you tell the two apart.

## Confirm before fixing (instrumentation)
1. Column type: `SELECT data_type FROM information_schema.columns WHERE table_name='showings' AND column_name='start_time';` → expect `timestamp with time zone`.
2. Compare a known showing's stored instant to its real advertised time:
   ```sql
   SELECT id, start_time AS raw_utc,
          start_time AT TIME ZONE 'America/Los_Angeles' AS shown_pacific,
          start_time AT TIME ZONE 'America/Denver'      AS shown_mountain
   FROM showings ORDER BY start_time LIMIT 5;
   ```
   - `shown_pacific` matches the real time → **data is correct; the bug is display-only (Defect 1).**
   - `shown_pacific` is an hour off and `shown_mountain` matches → **data is Mountain-baked (Defect 2).**
3. Buy/inspect one ticket: if the **email** time is correct but the web page is wrong → Defect 1 confirmed. If the email is *also* wrong → Defect 2 present.
4. Load `/showing/:id` with the OS timezone set to Denver vs. Los Angeles — if the rendered time changes, that alone proves the web path is browser-relative.

## The fix (structural)
Keep `timestamptz`. Anchor every human-facing conversion to `America/Los_Angeles`, on both write and display — bring the whole app up to the standard the email already meets.

1. **Display:** add `date-fns-tz`; introduce a shared `VENUE_TIME_ZONE` constant (mirror the edge value) and replace every `format(new Date(start_time), …)` with `formatInTimeZone(iso, VENUE_TIME_ZONE, 'h:mm a')`. Include the calendar day-grouping keys (`MonthCalendar.tsx:57,121`). One shared helper so the UI matches the email exactly.
2. **Write:** in `ShowingForm.tsx`, convert the naive `datetime-local` value *from* the venue zone with `fromZonedTime(startTime, VENUE_TIME_ZONE)` on save (`:129`) and `formatInTimeZone`/`toZonedTime` on edit read-back (`:78-81`), so what the admin types as Pacific round-trips regardless of their machine's zone.
3. **Data backfill — only if step 2/3 confirms Defect 2**, and never as a blanket `+1 hour`:
   ```sql
   -- Reinterpret instants localized as Mountain that meant Pacific. Preview first;
   -- scope with WHERE to the affected import batch so admin-entered rows aren't touched.
   UPDATE showings
   SET start_time = (start_time AT TIME ZONE 'America/Los_Angeles')
                     AT TIME ZONE 'America/Denver'
   WHERE /* rows from the kenworthy_showings_fix import */;
   ```
4. Never set `VENUE_TIME_ZONE` to Mountain anywhere. The edge value is already correct; make the rest of the system agree with it.

**Why the email being right matters:** `_shared/tickets.ts` is the reference implementation of "correct." The fix is to make the web/admin/scanner display and the write path meet that same standard, and to correct any data written before it existed.

**Key files:** `ShowingForm.tsx:129,78-81,240` · `Showing.tsx:560` · `MonthCalendar.tsx:57,209,292` · `ProductionDetailDrawer.tsx:91` · `UpcomingList.tsx:14-17` · `TicketScanner.tsx:271` · `useFeed.ts:66` · `_shared/tickets.ts:25,50,135` · `_shared/tickets_test.ts:54-58` · `TASKS.md:137` (+ the un-committed `kenworthy_showings_fix.sql`).
