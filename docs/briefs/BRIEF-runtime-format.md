---
brief: runtime-format
title: Show run times as hours + minutes, not raw minutes
status: shipped
track: ux
severity: P3
date: 2026-08-18
shipped_in: ["#181"]
shipped_at: 2026-08-25
evidence: observed in production 2026-08-25: a 108-minute film renders "1h 48m" with "1 hour 48 minutes" for screen readers
verified: true
---

# Brief (for Claude Code): Show run times as hours + minutes, not raw minutes

**Status:** 🟢 Small, display-only. One helper + one component; no schema or data-entry change.
**Date:** August 18, 2026
**Requested by:** Tom — listed run times should read like **"1h 30m"** instead of **"90 min"**.

## Current state (verified)
- Runtime is rendered in **one shared place**: `ProductionMetaBadges` in `src/components/ProductionMedia.tsx:106` — `<Clock/> {durationMinutes} min`. That badge is reused by the showing page (`Showing.tsx:569`), the detail drawer (`ProductionDetailDrawer.tsx:70`), and the listing cards — so fixing this one component updates every display site at once.
- The data stays as an integer `duration_minutes` (DB column + the `MovieForm` number input). **Only the display changes** — don't touch storage or data entry; staff keep entering total minutes.
- `src/lib/calendar.ts` uses `duration_minutes` to compute the `.ics` event length — that's a machine value, **leave it as-is**.

## The change
1. **Add a `formatRuntime(minutes)` helper** (in `src/lib/datetime.ts`, next to the other formatters):
   - `null`/`0`/absent → return empty (badge already hides when no duration).
   - `< 60` → `"45m"`.
   - exact hour → `"2h"` (no `"0m"`).
   - otherwise → `"1h 30m"`.
   - Format style is **Decision 1** — recommend the compact `"1h 30m"` (Google / Letterboxd / streaming standard); the verbose `"1 hr 30 min"` (Fandango-style) is the alternative.
2. **Use it in `ProductionMetaBadges`** — replace `{durationMinutes} min` with `{formatRuntime(durationMinutes)}`. That's the whole visible change.
3. **Accessibility:** give the badge an `aria-label` that expands to natural language — e.g. `"1 hour 30 minutes"` — so screen readers don't read "1h 30m" as "one-h thirty-m". Keep the compact form visually.
4. **Audit for stragglers:** grep for any other place a runtime is shown as raw minutes (email/confirmation templates in `_shared/notify.ts`/`deliver.ts`, SEO/meta text, any admin list) and route them through the same helper so nothing still says "90 min".

## Decisions for Tom
1. **Format:** compact `"1h 30m"` (recommended) vs verbose `"1 hr 30 min"`.
2. **Sub-hour style:** `"45m"` (recommended, consistent) vs keep `"45 min"` for films under an hour.

## Test plan
- 90 → `1h 30m`; 45 → `45m`; 120 → `2h`; 100 → `1h 40m`; 0/null → nothing shown (no empty badge).
- The new format appears on the showing page, listing cards, and detail drawer (all via the shared badge); no place still shows raw "min".
- Screen reader announces the natural-language `aria-label`.
- `MovieForm` still accepts/saves plain minutes; `duration_minutes` unchanged in the DB; the `.ics` calendar duration is unaffected.
- Unit tests for `formatRuntime` cover the cases above; `npm run build` + tests pass.

## Decisions (settled 2026-08-25)

1. **Format:** compact `"1h 30m"`. The badge sits in a row beside the rating and
   genre, where width is the scarce thing; Fandango's `"2 hr 8 min"` was the
   alternative.
2. **Sub-hour:** `"45m"` — one rule, no exception for shorts.
3. **Admin forms** (added 2026-08-25, after the audit below): the entry fields
   keep taking a total in minutes — the column stores a total, and a label
   promising hours while the input takes one number would be worse than the
   status quo. Instead each field echoes the patron-facing string live, and
   every place a form *displays a runtime value* now uses `formatRuntime()`.
   Splitting the input into `h` + `m` boxes was the alternative.

## What was built

- `formatRuntime()` and `runtimeLabel()` in `src/lib/datetime.ts`, with the
  shared `wholeMinutes()` guard so anything that isn't a real positive duration
  formats as `''` and the caller can render on the string without a second
  guard.
- `ProductionMetaBadges` renders the compact form and carries the spelled-out
  twin in an `sr-only` span.

  The brief asked for an `aria-label`, and that would not have worked: this is a
  bare `<span>` with no role, so there is no accessible name for the label to
  attach to and most screen readers drop it. `sr-only` text is the pattern the
  rest of the repo already uses (`dialog.tsx`, `carousel.tsx`, `pagination.tsx`).

- 16 assertions in `src/lib/datetime.test.ts`, including that the two formatters
  are empty on exactly the same inputs, plus four in
  `src/components/ProductionMedia.test.tsx` pinning the visible/announced pair
  together. That pairing is the regression worth catching: change one and not
  the other and it still looks right on screen while reading as nonsense aloud.
- Both admin forms echo what the entry will look like — `112` →
  "Shows as **1h 52m** on the site" — and `ShowingForm`'s inherit sentence now
  reads "Leave blank to use this film's runtime (**1h 52m**)". Storage, the
  input type and the submitted value are untouched.

## Audit result

Runtime reaches a patron's eye in **one** place — the shared badge. Everything
else holding `duration_minutes` is either a machine value or a data-entry
label, and all of it was left alone:

| site | what it is | left alone because |
|---|---|---|
| `src/lib/calendar.ts`, `_shared/calendar.ts` | `.ics` event length | machine value |
| `_shared/pricing.ts`, `purchasable.ts` | `showingEndsAt` arithmetic | machine value |
| `_shared/tickets.ts` | carried to the ticket email for the `.ics` only — never printed | machine value |

**Why the machine values can't take this format at all.** Both calendar paths
turn `duration_minutes` into an *end timestamp* — `DTEND` in the `.ics`,
`dates=<start>/<end>` for Google — so the number never becomes a string. What a
patron sees in their calendar is a "4:00–5:48 PM" block rendered by their own
app in their own locale; there is no string of ours to format. `pricing.ts` and
`purchasable.ts` are the "sales close when the show ends" arithmetic and are
never rendered. Traced every reader of `.duration_minutes`: the only consumer
outside the badge and the admin forms is `calendar.ts`.
| `MovieForm` "Duration (min)" | the number input's own label | staff still type total minutes — **now echoes `1h 52m` beneath** |
| `ShowingForm` "Runs For (minutes)" | the number input's own label | same — **now echoes, and the inherit sentence is formatted** |

**One straggler is content, not code:** some `movies.description` text carries a
runtime staff typed by hand — On the Waterfront's reads
`"Rated: Approved | 1 hr 48 min | Tickets: …"`, so that page now shows `1h 48m`
in the badge and `1 hr 48 min` in the prose. No formatter can reach it. It
needs a description edit in the admin, per film.
