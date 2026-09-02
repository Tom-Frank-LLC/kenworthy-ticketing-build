---
brief: calendar-cells-fit-all-showings
title: A calendar day draws every showing on it, and the week row grows to suit
status: built
track: ux
severity: P2
date: 2026-09-02
verified: false
---

# Brief: the month grid stops saying "+1 more"

**Requested by:** Tom, 2 Sep 2026, against a screenshot of Saturday 12
September — a day badged **3** that drew "Tony", "Tony" and then *"+1 more"*.
"Rather than having it say '1 more', let's allow the calendar rows to stretch
vertically to fit."

## What it was

`MonthCalendar.tsx` gave every day cell a fixed height
(`h-[6.25rem] md:h-[9.375rem]`) with `overflow-hidden`, drew `sorted.slice(0, 2)`
titles from `md` up, and printed `+{dayItems.length - 2} more` underneath when
there were more.

So the third showing was not merely truncated — the line that replaced it cost
about as much vertical room as drawing it would have. On the busiest day in
production it hid half the day.

## What it is now

Three changes, all in the `md+` branch of the day cell:

1. `h-[…]` → **`min-h-[…]`** at both breakpoints. The height becomes a floor.
2. `sorted.slice(0, 2)` → **`sorted`**. Every showing is drawn.
3. The `+N more` line is **gone**, along with the inner `overflow-hidden` that
   only existed to clip against the old fixed height.

The rows stretch for free: the cells are direct children of
`grid grid-cols-7`, and grid's default `align-items: stretch` already makes
every cell in a week match the tallest. There was no need to compute or
propagate a height.

The per-title clamp (`line-clamp-2 lg:line-clamp-3`) **stays**. It answers a
different question — how much room one long title may take — and without it a
single wordy title would bury the rest of the day. The full title is one tap
away in the day panel.

**Mobile is deliberately untouched.** Below `md` the cells are ~50px wide and
show dots, not titles, and the day accordion (#249) is how a phone reads a day.
Verified unchanged at 390px: every cell still 124px, no titles rendered, dots
still drawn.

## Sizing the worst case

The concern with removing a cap is a day that makes a week row enormous. Counted
from production rather than guessed — all 56 anon-visible showings, no
truncation (`content-range: 0-55/56`):

| showings on one day | days |
|---|---|
| 1 | 24 |
| 2 | 8 |
| 3 | 4 |
| **4** | **1** |

Four is the ceiling. At four chips of up to three lines each the cell is still
well under a screen, so no cap is warranted.

## Measured, against production data

A dev server in `--mode production` (read-only anon reads of the same public
listings the live site serves) at `/calendar`:

| | 1280 (lg) | 820 (md) |
|---|---|---|
| `"+N more"` on the page | **0** | **0** |
| cells whose drawn titles ≠ their badge count | **none** | **none** |
| every week row uniform | yes | yes |
| any cell clipped (`scrollHeight > clientHeight`) | no | no |
| horizontal scroll / JS errors | 0 / 0 | 0 / 0 |
| quiet week row height | 186px | 186px |
| busiest week row height | 196px | 186px |

Saturday 12 September — the day in the report — now draws "Tony", "Tony" and
**"Punch-Drunk Love"**. The busiest week grew by 10px at `lg` and not at all at
`md`, because the "+N more" line it replaced was nearly the same height.

## Verification

- `npx tsc -p tsconfig.app.json --noEmit` — clean.
- `npx vitest run` — 56 files, 735 passed. Two tests added: every showing is
  drawn with no `+N more`, and the cell is sized by a floor rather than a cap.
  jsdom computes no layout, so the stretching itself is covered by the browser
  measurements above rather than by a test that cannot see it.
- No edge functions touched.
