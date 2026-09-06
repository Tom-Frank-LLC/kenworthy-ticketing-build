---
brief: backstage-hero-full-house
title: The Backstage masthead is a full house, laid out like the calendar hero
status: shipped
track: ux
date: 2026-09-05
shipped_in: ["#293"]
shipped_at: 2026-09-05
verified: true
evidence: production version 137e170f-e69e-497b-b2b6-6c57b60f3f48 serves the Backstage chunk with the 50/56vh band and 'center 75%'; rollback is version 802ec83c
---

# Brief: swap the Backstage hero photograph and lay it out like the calendar hero

**Requested by:** Tom, 2026-09-05 — replace the photograph at the top of
`/backstage` with the burlesque-night shot (a full house facing the small
stage, the neon sign lit above the crowd) and format it the way the calendar
page's hero is formatted.

## What changed

**The photograph is data, not code.** `backstage_page_content.hero_path`
already points at an object in the `backstage-photos` bucket and the admin
tab already replaces it, for the reasons in migration
`20260821011530_backstage_hero_image.sql`. That mechanism is kept. The swap is
an upload plus a one-column update, per environment:

| env | old `hero_path` (left in the bucket for rollback) | new `hero_path` |
|---|---|---|
| staging | `hero/1787342625926_backstage.jpg` | `hero/1788666703000_backstage-burlesque.jpg` — **done 2026-09-05** |
| production | `hero/1787300649684_backstage.jpg` | **still pending as of 2026-09-05 evening.** The layout deployed (version 137e170f) but the browser extension was down and the prod service key is classifier-blocked, so production is showing the *old* neon-sign photo in the *new* band until someone uploads the burlesque shot via Admin → Pages → Backstage → Hero image (the PNG in `src/assets/` is fine; the tab accepts it) |

The source file is `src/assets/Backstage Burlesque.png` (1912×1284, 5.3 MB).
It is **not** imported anywhere and should not be committed; what went to the
bucket is a JPEG (q85, ~1 MB) converted with `sips`. The render endpoint cuts
every size the page serves from that.

**The layout is CalendarHero's** (`src/components/calendar/CalendarHero.tsx`),
applied inside `src/pages/Backstage.tsx`:

- full-bleed band, `min-h-[50vh] lg:min-h-[56vh]`, `object-cover`
- the same bottom-weighted scrim and gold hairline
- bottom-aligned copy in the same type sizes and drop-shadows: eyebrow /
  H1 / italic serif line
- `srcSet` at 768 / 1280 / 1920, the widths the other heroes use, cut by the
  Supabase render endpoint (`resize: 'contain'`, q70). Verified with real
  viewports: a phone requests the 768 copy, a laptop 1280, a 1536-wide screen
  1920, all delivered as `image/webp` without a `<picture>` element.
- `objectPosition: 'center 75%'`, tuned by eye with Tom (62% showed rafters,
  78% lost the drape fringe): the sign and the performer sit in the lower half
  and the top third is ceiling.
- the band also renders (empty, at final height) while the row is loading, so
  the page no longer flashes the drawn sign and then jumps to the photo.

## Verification

Screenshots at 390, 768, 1280 and 1536 wide against the staging database,
`/backstage` next to `/calendar`. Both the neon sign and the performer stay in
frame at every width. `tsc -p tsconfig.app.json` clean; `backstage.test.ts`
passes.

## Shipped 2026-09-05

Merged as #293 and deployed as production version 137e170f. Before deploying,
a build of main at 7efbf01 (pre-merge) reproduced the live entry hash
`index-CmOLbnl0.js` exactly, so production was not ahead of main; the
post-merge build moved almost every chunk hash, and four unrelated chunks
were byte-identical once hashes were normalised — the cascade, not a change.

**Left to do:** the production photo upload in the table above.

## Follow-up worth a brief of its own

The `<img alt>` for the hero is a string in `Backstage.tsx`, but the
photograph is admin-replaceable. The next upload from the admin tab will carry
this photograph's description. A `hero_alt` column beside `hero_path`, with a
field in the admin tab, is the fix; it was out of scope here.
