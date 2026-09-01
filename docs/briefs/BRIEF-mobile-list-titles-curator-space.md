---
brief: mobile-list-titles-curator-space
title: On a phone, list titles get a second line and the curator's band stops padding itself out
status: built
track: ux
severity: P2
date: 2026-09-01
verified: false
---

# Brief: Mobile — longer list titles, calendar info, tidy curator's pick

**Requested by:** Client via Tom, 28 Aug 2026. Three items: (1) List View shows
only ~14 characters of a title; roughly double it. (2) Calendar View shows no
listing info on mobile. (3) The curator's-pick section leaves a large empty
space at the bottom.

One of the three needed no code, and the fix the original brief proposed for
another one does not work. Both are written up below rather than left for the
next session to rediscover.

## Part A — list titles get a second line

`UpcomingList.tsx` truncated the row title to a single line. Beside the `w-20`
date column that left about 14 characters on a phone, which is not enough of a
title to recognise a film by.

`truncate` → `line-clamp-2`. Measured at 360/390/414: long titles go from one
line to two, the row grows 84px → 111px, and there is still no horizontal
scroll. `min-w-0` on the column is still doing its job and stays.

This is not breakpoint-scoped, so desktop rows also gained the second line
(101px → 136px for a long title). That looked like an improvement rather than a
regression, but it is a visible desktop change and is called out here so it is
not mistaken for drift.

`EditorialCalendar`'s list title already wrapped, and was left alone. There are
no other truncated listing titles in `src/`.

## Part B — nothing to do; it shipped the day after the feedback

The feedback is dated 28 Aug. `BRIEF-calendar-mobile-day-accordion.md` shipped
in **#249 on 29 Aug** and does exactly what was asked.

Verified live at 390px rather than taken from the brief's status line: tapping a
day sets `aria-expanded="true"` and mounts a panel 5px beneath **its own week**
— `aria-label="Tuesday, September 1 — what's on"`, containing "TONIGHT ·
SEPTEMBER 1 · FILM 7:00 PM Warfare" — with a Close control. The cells also
already carry the count in their accessible name ("Tuesday, September 1, 1
showing").

**No interim count label was added under the dots.** The stopgap the original
brief offered was for a problem that no longer exists.

## Part C — the curator's band

### The proposed fix does not work, and here is the measurement

The original brief's recommendation was `items-start` on the carousel track
(and/or `h-auto` on `CarouselItem`) so each slide sizes to its content. Tried
first, and measured at 390px:

| | viewport | track | slide 0 |
|---|---|---|---|
| baseline | 2198px | 2198px | 2198px |
| `items-start` alone | 2198px | 2198px | **812px** |

The slide shrinks and **nothing else moves**. A flex container is still as tall
as its tallest item, so the empty space leaves the slide and reappears directly
beneath it, inside the track. Identical on screen.

### The actual cause

The note is the only part of a slide whose height varies — the poster is a
constant 450px. `BAND` (`lg:h-[440px]`) and the note's `lg:overflow-y-auto` are
both `lg:`-prefixed, so **below `lg` the note had no bound at all**. Measured
note heights at 390px: 96px, **1,447px**, 804px. The 236-word one made its slide
2,198px tall on an 844px screen, and the flex row then imposed that height on
every other slide.

So one cause, two symptoms: a 2.6-screen slide, and 1,385px of dead space under
the shortest pick.

### The fix — three parts, none of which works alone

1. **Bound the note below `lg`** — `line-clamp-6 lg:line-clamp-none`, with
   `max-lg:rich-text-teaser` to zero the block margins the clamp would otherwise
   count instead of lines. That pattern is the repo's own, from
   `FINDINGS-richtext-description-surface.md`; `EditorialCalendar` already uses
   it. Scoped to `max-lg` because at `lg` the note scrolls and its paragraph
   spacing is still wanted. Confirmed in the built CSS that the variant lands
   inside `not all and (min-width: 1024px)`.
2. **`max-lg:items-start`** on the track, so slides stop stretching.
3. **`useViewportFollowsSlide`** — sets the embla viewport's height to the
   selected slide's, on `select`/`reInit`/resize, cleared at `lg`. This is the
   part that removes the space rather than relocating it.

Nothing is lost to the clamp: the note is the production's description, and
tapping the poster or title opens the drawer that prints it in full, as does
`/showing/:id` behind the button.

### Measured result

Dead space per slide, before → after:

| width | before | after | section height |
|---|---|---|---|
| 360 | 1534 / 0 / 533 | **0 / 0 / 0** | 2530px → 996px |
| 390 | 1385 / 0 / 481 | **0 / 0 / 0** | 2382px → 996px |
| 414 | 1257 / 0 / 417 | **0 / 0 / 0** | 2253px → 996px |

The viewport now follows the slide on screen: 812 → 944 → 1106px.

**Desktop 1280 is unchanged**, by stash-and-diff of the same fingerprint:
section 679px → 679px, viewport 485px → 485px, no inline height, `align-items:
normal`, slide grids 440px, note clamp `none`, note region still
`overflow-y: auto`. The `lg` band, the internal scroll, the arrows and the
vignette are all as they were.

The single-pick path renders no carousel, so there is no stretch to undo; the
hook no-ops on an undefined api and the clamp still applies.

## Left alone, on purpose — the manual slide's letterboxed art

Now that the band is compact, the remaining empty space in it is inside the
poster cell, and only on **manual** slides. `MEDIA_CELL` reserves
`aspect-[2/3]` with `object-contain`, which is right for a one-sheet and wrong
for a landscape promo image:

| slide | source | image | rendered | letterbox |
|---|---|---|---|---|
| Kenworthy Silent Film Festival | manual | 640×321 (2:1) | 150px in a 450px box | **300px** |
| Silent Film Festival: The Crowd | feed | 2000×3037 (0.66) | 450px | 0 |
| Palouse Cult Film Revival | feed | 1400×2100 (0.67) | 450px | 0 |

Not touched, because it is a different complaint from the one that was made and
the answer is a design decision, not a bug fix: either manual slides size to
their art's own aspect below `lg`, or hand-written slides are required to
supply portrait art. **Tom's call.**

## Verification

- `npx tsc -p tsconfig.app.json --noEmit` — clean.
- `npx vitest run` — 56 files, 732 passed. One test added, pinning the three
  clamp classes and that the unscoped `rich-text-teaser` is *not* applied.
- `npm run build:staging` — all four new classes present in the built CSS.
- No edge functions touched, so `deno check` was not run.
- Measurements throughout are from `playwright-core` at real viewports; the
  driven Chrome tab is pinned at 1280 and cannot see mobile layout.
