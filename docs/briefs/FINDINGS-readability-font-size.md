# Findings — Raise default readability & font size

Companion to `BRIEF-readability-font-size.md`. Executed 2026-08-19 on
`feat/readability-font-size`.

## Decisions taken

The brief left four decisions open. Three were taken at the brief's own
recommendation; the fourth was left out of scope.

1. **Root size — 18px (112.5%).** One line in `src/index.css`.
2. **Floor aggressiveness — the recommended option.** Kill everything
   `≤11px`, raise body-copy `text-xs` → `text-sm`. `text-sm` was *not*
   pushed to `text-base` broadly.
3. **Body typeface — Fraunces kept.** Size/leading/contrast only.
4. **A / A+ / A++ widget — not built.** Out of scope per the brief.

## What the root bump actually does (worth knowing before tuning it)

The brief describes `html { font-size: 112.5% }` as scaling "every rem-based
`text-*` class". It scales **more than text**: Tailwind's spacing, sizing,
gap, and max-width scales are all rem-based too. So the change behaves like a
built-in 112.5% zoom — padding, gaps and tap targets grow with the type, and
proportions are preserved exactly.

That is the desired outcome for an older audience (bigger touch targets, not
just bigger text), but it is the reason the layout casualties below happened:
in a fixed-width context, *the text got bigger while the box got smaller*,
because the surrounding rem-based padding and gaps grew too.

Breakpoints are unaffected — Tailwind's media queries are in `px`.

To change the root size later, edit only the one declaration in
`src/index.css`; nothing else is pinned to it.

## Contrast — the brief's assumption was wrong, in our favour

The brief asked to verify `--muted-foreground` (`38 10% 65%`) against the dark
background and to "raise its lightness a few points" if marginal. Measured:

| color | vs `--background` | vs `--card` |
|---|---|---|
| `--foreground` `38 30% 94%` | 16.97:1 | 15.91:1 |
| `--muted-foreground` `38 10% 65%` | **8.12:1** | **7.61:1** |

It already clears AA (4.5:1) and AAA (7:1). **No change was made** — raising it
would have been a change with no accessibility justification.

What *does* fail is `text-muted-foreground` with an opacity modifier:

| opacity | ratio | AA |
|---|---|---|
| 100% | 8.12:1 | pass |
| 70% | 4.50:1 | pass (borderline) |
| 60% | 3.61:1 | **fail** |
| 50% | 2.86:1 | **fail** |
| 40% | 2.25:1 | **fail** |

Four sites use `/60` or below. Three are decorative (`aria-hidden` footer
separators; a placeholder disc icon). The fourth was real text — the
adjacent-month day numbers in `MonthCalendar` — and was raised `/60` → `/75`
(3.61:1 → 5.00:1).

**Rule for future work:** `text-muted-foreground/60` and below is below AA on
this background. Do not use it for text.

## Layout casualties

### 1. Month calendar cells (caused by this change)

Measured at 375px, before vs after: **0 cells clipping → 11 of 42**, worst
overflow 9px. Cause was not only larger text — the cell's *content box shrank*
from 25px to 21.5px as the rem-based grid gap and cell padding grew.

The specific offender: the day-count pill rendered **21.9px wide for a single
digit** (`px-1.5` = 6.75px per side + 13.5px glyph), wider than the day number
beside it, in a 21.5px box.

Fixed by reclaiming room and dropping what was redundant on a phone:
- cell padding `p-1.5` → `p-1` (mobile only)
- the count pill is `hidden md:inline-block` — the dot row directly beneath it
  already reports the count (a dot per item, then `+N`)
- the `+N` overflow tally stays at `text-xs`, the app's tightest box

Result: 0 clipping at 375 / 768 / 1280.

### 2. Showing page horizontal overflow (pre-existing, amplified)

`/showing/:id` at 375px pushed the whole page sideways. **This predates the
change** — baseline 617px of overflow, 740px after. Verified by stashing.

Cause: `Showing.tsx:619`, a grid item (`lg:col-span-2`) with the CSS default
`min-width: auto`, so it refused to shrink below the seat map's intrinsic
width and ballooned to 1098px inside a 324px track. It also starved SeatMap's
fit-to-container zoom, which measures that element — given an unconstrained
width it never scaled down.

Fixed with `min-w-0` on the column. Page overflow is now zero at all three
widths, and the seat map correctly fits and scrolls inside its own frame.

### 3. Seat map zoom controls (caused by this change)

Three 44px touch targets left the hint text ~120px beside them, wrapping it
into a five-line column. The row now stacks on mobile (`flex-col` →
`sm:flex-row`).

## Verification performed

Automated, via same-origin iframes at true 375 / 768 / 1280 viewports (Chrome's
profile zoom made window resizing unreliable):

- **Overflow/clipping sweep** — `/`, `/calendar`, `/showing/:id`, `/film-passes`,
  `/donate`, `/rental-request`, `/rentals`, `/dvds`, `/history`, `/about`,
  `/sponsors`, `/press`, `/privacy`, `/terms`, `/volunteer`, `/hiring`, `/auth`.
  All clean. (`h1.sr-only` reports as "clipped" at 1px — a false positive.)
- **Scaling test** — forced the root to 1.5× and confirmed every text element
  moved with it. 379 elements across four pages, **0 pinned**. Browser zoom and
  OS large-text therefore still work.
- **Floor test** — no rendered text below 13.5px on any page checked.
- `tsc -p tsconfig.app.json --noEmit`, 204 unit tests, `npm run build:staging`.

## Not verified

**Admin dashboard and StaffPOS.** Both redirect to `/` when signed out, and
verifying them requires signing in. They need a human pass while authenticated,
at 375 and 1280 — the brief specifically flags tables, receipts and QR/ticket
layouts staying aligned. The admin type was left mostly untouched (only the
sub-12px floor was applied there), but the root bump affects those screens like
everything else.

## Resulting scale

`text-xs` 13.5px · `text-sm` 15.75px · `text-base` 18px · `text-lg` 20.25px ·
body 18px / 1.65.
