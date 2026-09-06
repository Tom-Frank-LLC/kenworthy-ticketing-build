---
brief: backstage-hero-full-house
title: The Backstage masthead is a full house, laid out like the calendar hero
status: built
track: ux
severity: P3
date: 2026-09-05
verified: false
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
| production | `hero/1787300649684_backstage.jpg` | not yet — do it with the deploy, see below |

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
- `objectPosition: 'center 62%'`, derived: the sign and the performer sit in
  the lower half and the top third is ceiling.
- the band also renders (empty, at final height) while the row is loading, so
  the page no longer flashes the drawn sign and then jumps to the photo.

## Verification

Screenshots at 390, 768, 1280 and 1536 wide against the staging database,
`/backstage` next to `/calendar`. Both the neon sign and the performer stay in
frame at every width. `tsc -p tsconfig.app.json` clean; `backstage.test.ts`
passes.

## To ship

1. Merge, then follow `CLAUDE.md` → Deploying.
2. Right before or after the deploy, do the production swap the same way as
   staging (storage POST of the JPEG to `hero/<ts>_backstage-burlesque.jpg`,
   then `PATCH backstage_page_content?id=eq.true {hero_path}`), or upload it
   through **Admin → Pages → Backstage → Hero image**, which does the same
   thing and also removes the old object.
3. Set `status: shipped`, `shipped_in`, `shipped_at`, `verified: true`; re-run
   `node scripts/generate-tasks.mjs`.

## Follow-up worth a brief of its own

The `<img alt>` for the hero is a string in `Backstage.tsx`, but the
photograph is admin-replaceable. The next upload from the admin tab will carry
this photograph's description. A `hero_alt` column beside `hero_path`, with a
field in the admin tab, is the fix; it was out of scope here.
