---
brief: concessions-hero-photo
title: The concessions page opens on a photograph of the stand, laid out like the calendar's masthead
status: built
track: ux
severity: P3
date: 2026-09-23
verified: false
---

# Brief: Concessions page masthead

**Status:** built 2026-09-23, not yet deployed.
**Date:** September 23, 2026
**Requested by:** Tom — while triaging leftover files in the main checkout, an unreferenced photograph of the concessions counter turned up (`7065433574755008316.jpg`, 11 Aug). Rather than discard it: "add it to the top of the concessions page in the same format as the Calendar page."

## What changed

- `src/assets/concessions-counter.jpg` — the 2000×1500 master (520 KB), kept
  like the other hero masters and never shipped to browsers.
- `src/assets/optimized/concessions-counter-{768,1280,1920}.{jpg,webp}` — cut
  with the documented pipeline (`docs/MOBILE-OPTIMIZATION.md`: `sips -Z`, then
  `cwebp -q 72`). 45 KB webp at phone width. Heavier than the calendar's
  variants at the same settings because this is a bright, detailed photograph
  and that one is mostly black; the quality setting was kept the same rather
  than tuned per image so the four heroes stay one pipeline.
- `src/components/concessions/ConcessionsHero.tsx` — `CalendarHero` pattern
  exactly: same `<picture>` webp/jpg pair at three widths, same 50/56vh band,
  same gold hairline, same eager/high-priority load, bottom-aligned copy. The
  eyebrow ("At the stand"), the `h1` and the blurb move out of the page body
  into the masthead, as the calendar's do. `objectPosition: center 35%` is
  derived from the composition (menu board and usher in the upper-middle band,
  soffit above, the backs of the queue below); the gradient is a little heavier
  at the bottom than the calendar's because the photograph is bright where
  that one is dark.
- `src/pages/Concessions.tsx` — renders the hero above the menu container and
  imports `CONCESSIONS_BLURB` from the hero for the meta description, so the
  sentence on the page and the one in the `<meta>` cannot drift.

## Note

The photograph shows staff and patrons at the counter, faces visible. It was
already in the repository's working tree and was requested by the theatre;
this brief records that it went live so the source and date are traceable if a
subject ever asks.

## Verification

- `tsc -p tsconfig.app.json`, eslint on the two touched files: clean.
- `/concessions` in a staging dev build at 1440×900: masthead renders with the
  board and usher in frame, copy legible in the tinted band, menu unchanged
  below. **Phone width was not captured** — the browser window would not
  resize below the desktop frame in this session. The layout classes are
  CalendarHero's verbatim, which ships at phone widths today; a look at
  `/concessions` on a phone after deploy closes this.
