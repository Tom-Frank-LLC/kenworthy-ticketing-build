---
brief: rental-request-12h-time
title: Staff and the rental contract read theatre-rental times as 6:30 PM, not 18:30
status: shipped
track: ux
date: 2026-09-23
shipped_in: ["#339"]
shipped_at: 2026-09-24
verified: true
---

# Brief (for Claude Code): Show rental-request times in 12-hour format

**Status:** 🟢 Small, self-contained display change. The times are stored as bare 24-hour `HH:mm` strings and printed verbatim to staff; the fix is one shared 24h→12h formatter used at the two places a person reads them. The care item is **not** to run these bare wall-clock strings through any timezone/Date logic (that would shift them).
**Date:** September 23, 2026
**Requested by:** Tom — on theatre/marquee rental requests, show the time in 12-hour (e.g. `6:30 PM`) instead of 24-hour (`18:30`).

## Current state (verified, build `b10bc0c`)
- **The times are bare 24-hour strings.** The theatre rental form (`src/pages/RentalRequest.tsx:283–292`) collects four times through `<input type="time">` — `arrival_time`, `event_start_time`, `event_end_time`, `departure_time`. An `<input type="time">` always stores its value as a **24-hour `HH:mm` string** (e.g. `"18:30"`), regardless of how the widget looks. They're persisted as `text` (`rentalAvailability.ts:10` confirms) and validated only for length (`rental-request/index.ts:85–88`).
- **They're printed verbatim to staff — this is the 24h Tom is seeing.** `src/components/admin/RentalRequestsTab.tsx:308–311` renders them raw: `<KV k="Arrival" v={r.arrival_time} />`, `Event start`, `Event end`, `Departure`. Whatever `HH:mm` was submitted is what shows.
- **The rental contract prints them too.** `src/pages/RentalContract.tsx:189` builds `timeRange = [event_start_time, event_end_time].filter(Boolean).join('–')` → e.g. `18:00–23:00`. Same 24h strings, on a document the renter sees.
- **No existing helper fits.** Every formatter in `src/lib/datetime.ts` (`formatShowtime`, `formatPlainDate…`) operates on a `Date`/timestamp via date-fns. These fields are **times with no date and no timezone**, so those helpers don't apply — and pushing a bare `"18:30"` through a `Date` would attach today's date and a timezone and risk an hour shift. A tiny dedicated string formatter is the right tool.
- **Two things are NOT in scope (state so Tom isn't surprised):**
  - **Marquee requests carry no times.** The marquee form (`MarqueeBookingForm.tsx`) collects only `proposed_date` / `end_date`, no time fields — so "marquee" here has no time to convert. The change is effectively about the **theatre** request's four times. (Dates already render in long form via `describeDate`.)
  - **The `<input type="time">` widget's own display is browser/OS-controlled.** On the public form the field shows 24h or 12h according to the visitor's device locale; code can't reliably force that. This brief changes what **staff and the contract** show, which is the reader-facing part Tom means.

## The change
### 1. Add one shared 24h→12h formatter
Add a small pure function to `src/lib/datetime.ts`, e.g. `formatClockTime(value: string | null | undefined): string`:
- Accepts a bare `HH:mm` (tolerate an optional `:ss`), returns `h:mm AM/PM` — `"18:30"` → `"6:30 PM"`, `"00:00"` → `"12:00 AM"`, `"12:00"` → `"12:00 PM"`, `"09:05"` → `"9:05 AM"`.
- **Pure string parse — no `Date`, no timezone.** Split on `:`, coerce hours/minutes, derive the meridiem. This is the same "don't let a bare wall-clock value get shifted" discipline `describeDate` already follows for dates (`staff_notifications.ts:278`).
- **Defensive:** empty/null → return `''` (or the raw value) so the `KV` row stays empty as it does today; a value that doesn't match `HH:mm` → return it unchanged rather than throwing. Cover these in a unit test (the codebase already tests rental helpers — `rentalRequest.test.ts`, `rentalRates.test.ts`).

### 2. Use it at the two display sites
- **Admin queue** — `RentalRequestsTab.tsx:308–311`: wrap each value, `v={formatClockTime(r.arrival_time)}` (and the other three).
- **Contract** — `RentalContract.tsx:189`: format each side before joining — `[formatClockTime(request.event_start_time), formatClockTime(request.event_end_time)].filter(Boolean).join('–')` — so the printed range reads `6:00 PM–11:00 PM`. Keep the existing `'__________'` fallback when both are empty.

Storage is unchanged — the DB keeps the `HH:mm` strings; only the reader-facing rendering changes.

## Decisions for Tom
1. **Staff notification email:** the new-request email (`buildRentalRequestNotification` in `_shared/staff_notifications.ts`) currently **doesn't list these four times at all** — it shows who/dates/guests, not arrival/start/end/departure. So there's nothing to "convert" there today. Options: leave the email as-is (recommended — keep this change purely about the 24h→12h display Tom flagged), **or** additionally add the four times to that email using the same `formatClockTime` (a small, separate enhancement if staff want the hours in the email too). Confirm which.
2. **Style:** `6:30 PM` (recommended) vs `6:30 pm` — match whatever the site uses elsewhere; `formatShowtime`'s `h:mm a` in date-fns yields uppercase `PM`, so uppercase keeps it consistent.

## Test plan
- `formatClockTime` unit tests: `18:30→6:30 PM`, `00:00→12:00 AM`, `12:00→12:00 PM`, `09:05→9:05 AM`, `23:59→11:59 PM`; empty/`null`→`''`; a malformed value returns unchanged; an `HH:mm:ss` input is tolerated. No value shifts by an hour (the timezone trap).
- Admin rental queue shows the four times in 12-hour form; a request with some blank times still hides the blank rows exactly as before.
- A generated rental contract prints the event time range in 12-hour form, with the `__________` fallback intact when no times were given.
- Marquee requests are unaffected (they have no times); the staff email is unchanged unless Decision 1 opts in.
- `npm run build` + tests pass.
