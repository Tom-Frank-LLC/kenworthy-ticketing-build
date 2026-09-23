---
brief: concessions-hero-photo
title: The concessions page closes on a photograph of the stand, in the calendar masthead's format
status: built
track: ux
severity: P3
date: 2026-09-23
verified: false
---

# Brief: Concessions page photo band

**Status:** built 2026-09-23, on staging, not yet in production.
**Date:** September 23, 2026
**Requested by:** Tom — while triaging leftover files in the main checkout, an unreferenced photograph of the concessions counter turned up (`7065433574755008316.jpg`, 11 Aug). Rather than discard it: "add it to the top of the concessions page in the same format as the Calendar page." After seeing it on staging as a masthead: revert the top of the page to how it was, and move the photograph, in the same style and format, **below the menu**.

## What changed

- `src/assets/concessions-counter.jpg` — the 2000×1500 master (520 KB), kept
  like the other hero masters and never shipped to browsers.
- `src/assets/optimized/concessions-counter-{768,1280,1920}.{jpg,webp}` — cut
  with the documented pipeline (`docs/MOBILE-OPTIMIZATION.md`: `sips -Z`, then
  `cwebp -q 72`). 45 KB webp at phone width. Heavier than the calendar's
  variants at the same settings because this is a bright, detailed photograph
  and that one is mostly black; the quality setting was kept the same rather
  than tuned per image so the four heroes stay one pipeline.
- `src/components/concessions/ConcessionsPhotoBand.tsx` — `CalendarHero`'s
  format: same `<picture>` webp/jpg pair at three widths, same 50/56vh band,
  same gold hairline (now at the top edge, separating it from the menu). It
  carries no copy — the page keeps its own centred header above the menu —
  so the gradient tints only the top and bottom edges, fading the band in from
  the page and out to the footer, and leaves the subject clear. `loading="lazy"`
  where the heroes are eager: it is below the fold by definition.
  `objectPosition: center 35%` is derived from the composition (menu board and
  usher in the upper-middle band, soffit above, the backs of the queue below).
- `src/pages/Concessions.tsx` — header and menu untouched from before; the band
  renders after the container, full-bleed.

## Note

The photograph shows staff and patrons at the counter, faces visible. It was
already in the repository's working tree and was requested by the theatre;
this brief records that it went live so the source and date are traceable if a
subject ever asks.

## Verification

- `tsc -p tsconfig.app.json`, eslint on the two touched files: clean.
- `/concessions` on the staging Worker at 1440×900: header and menu as before,
  the band below with the board and usher in frame. **Phone width was not
  captured** — the browser window would not resize below the desktop frame in
  this session. The band's classes are CalendarHero's, which ships at phone
  widths today; a look at `/concessions` on a phone closes this.
