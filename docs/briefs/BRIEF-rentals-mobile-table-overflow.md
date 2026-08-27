---
brief: rentals-mobile-table-overflow
title: The rentals availability table pushes /rentals sideways on a phone
status: built
track: bug
severity: P2
date: 2026-08-27
verified: true
evidence: On staging at version 53ed241b — /rentals scrollWidth == innerWidth at 375/414/640, and an injected long booking detail truncates without widening the table (337px before and after). Production still overflows 91px at 375.
---

# Brief: `/rentals` scrolls sideways on mobile

**Found:** 27 Aug 2026, while running a viewport sweep for an unrelated font
change. Present in production now; nothing to do with that font work.

## Symptom

`/rentals` overflows its viewport horizontally on a phone. Measured against
production (`kenworthy-ticketing-build`):

| viewport | `documentElement.scrollWidth − innerWidth` |
|---|---|
| 375 | **91px** |
| 414 | **52px** |
| 640 and up | 0 |

The page scrolls left-right, and the right edge of the hour-by-hour table sits
past the screen. Everything else on the page is fine.

## Cause

`src/components/rentals/DayView.tsx` — the availability table.

The status cell already tries to truncate a long booking detail:

```tsx
<span className="flex items-center gap-2">
  <span aria-hidden className="... shrink-0" />
  <span>{HOUR_STATUS_LABEL[row.status]}</span>
  {row.detail && <span className="text-muted-foreground truncate">— {row.detail}</span>}
</span>
```

That `truncate` never engages, for two compounding reasons:

1. The table is `w-full` but **`table-layout` is `auto`**, so column widths are
   computed from *max-content*. An auto table grows to fit its content no
   matter what `w-full` says — the 100% is a minimum, not a cap.
2. The truncating span is a flex item, and a flex item's default
   `min-width: auto` refuses to shrink below its content. Even under a fixed
   layout it would need `min-w-0` before `text-overflow` could do anything.

Measured at 375: the `<th>` is `w-28` (126px), leaving ~249px for the status
column — but the `<td>` renders 347px wide, and the row 446px.

This is the "mechanically correct, visually wrong" shape: the markup reads like
it handles long text, and the classes are individually right. `truncate` on a
flex child of an auto-layout table is simply inert.

## The fix

1. `table-fixed` on the table so `w-full` becomes a real constraint.
2. `min-w-0` on the flex container so the truncating child can actually shrink.
3. A `<colgroup>` carrying the hour-column width.

Both of the first two are needed; either alone leaves the overflow.

**The third one is the part that is easy to miss.** Under `table-layout:
fixed` the column widths are taken from the **first row of the table**, and
the first row here is the `sr-only` `<thead>`, whose cells carry no width. So
the `w-28` sitting on the body `<th>` is simply ignored and the columns split
50/50 — measured 169px/168px on a 337px table where the hour column was
supposed to be 126px. It still *looked* fine, because nothing clipped and the
overflow was gone, which is precisely why it would have shipped unnoticed.

A `<colgroup>` sets the widths independently of which row comes first, and the
now-dead `w-28` came off the body cell so it does not read as load-bearing.
Measured after: hour column 126px, exactly `w-28` at this project's 18px root.

## Test plan

- `documentElement.scrollWidth === innerWidth` on `/rentals` at 375, 414, 640.
- A row with a long `detail` truncates with an ellipsis rather than widening
  the table; the hour label column still reads in full.
- The table is still a real `<table>` with its `scope="row"` headers and
  `sr-only` caption intact — this is an a11y-deliberate structure, do not
  swap it for divs.
- No regression at 768+, where the page is already clean.
