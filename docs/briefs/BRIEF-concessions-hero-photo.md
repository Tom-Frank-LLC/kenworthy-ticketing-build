---
brief: concessions-hero-photo
title: The concessions page opens on a photograph of the stand, with its own centred header over it
status: built
track: ux
severity: P3
date: 2026-09-23
verified: false
---

# Brief: Concessions page masthead

**Status:** built 2026-09-23, on staging, not yet in production.
**Date:** September 23, 2026
**Requested by:** Tom — while triaging leftover files in the main checkout, an unreferenced photograph of the concessions counter turned up (`7065433574755008316.jpg`, 11 Aug). Rather than discard it: "add it to the top of the concessions page in the same format as the Calendar page." Three rounds on staging: (1) as a calendar-style masthead with the title bottom-left; (2) header restored, photograph moved below the menu; (3) — the one that stuck — photograph back on top, **with the page's own centred header over it** rather than the calendar's bottom-left title.

## What changed

- `src/assets/concessions-counter.jpg` — the 2000×1500 master (520 KB), kept
  like the other hero masters and never shipped to browsers.
- `src/assets/optimized/concessions-counter-{768,1280,1920}.{jpg,webp}` — cut
  with the documented pipeline (`docs/MOBILE-OPTIMIZATION.md`: `sips -Z`, then
  `cwebp -q 72`). 45 KB webp at phone width. Heavier than the calendar's
  variants at the same settings because this is a bright, detailed photograph
  and that one is mostly black; the quality setting was kept the same rather
  than tuned per image so the four heroes stay one pipeline.
- `src/components/concessions/ConcessionsHero.tsx` — the photograph is
  carried exactly as `CalendarHero` carries its own: same `<picture>` webp/jpg
  pair at three widths, same 50/56vh band, same gold hairline, same
  eager/high-priority load. The copy is *not* the calendar's: the page's
  header — eyebrow, `h1`, blurb, same classes and tracking as before — sits
  centred both ways over the photograph, so the page reads as itself with a
  picture behind it. Centred copy over a bright photograph needs more scrim
  than bottom-left copy over a dark one, so the tint is even across the band
  (≈0.5) and heavier only at the foot; the text keeps the drop shadows the
  other mastheads use. `objectPosition: center 35%` is derived from the
  composition (menu board and usher in the upper-middle band, soffit above,
  the backs of the queue below). The blurb comes in as a prop so `BLURB` stays
  on the page beside the `<meta>` description that reuses it.
- Fourth and fifth passes: the band is a quarter shorter from `md` up
  (37.5/42vh against the calendar's 50/56vh — 20% first, then another 5%)
  **without moving the header**. The copy box keeps the
  50/56vh height and centres the header in it; a negative bottom margin on
  the box pulls the section's bottom edge up by the difference and
  `overflow-hidden` crops that strip off the photograph. Not applied below
  `md`, where the text is taller and the strip would cut into the blurb.
- `src/pages/Concessions.tsx` — renders the hero above the menu container in
  place of the old `<header>`; menu untouched.

## Note

The photograph shows staff and patrons at the counter, faces visible. It was
already in the repository's working tree and was requested by the theatre;
this brief records that it went live so the source and date are traceable if a
subject ever asks.

## Verification

- `tsc -p tsconfig.app.json`, eslint on the two touched files: clean.
- `/concessions` on the staging Worker at 1444×840: the board and usher in
  frame behind the centred header, blurb legible over the queue, menu as
  before below. **Phone width was not captured** — the browser window would
  not resize below the desktop frame in this session. The band's classes are
  CalendarHero's, which ships at phone widths today; the centred blurb is
  `max-w-md`, the same width it had in the old header. A look at
  `/concessions` on a phone closes this.
