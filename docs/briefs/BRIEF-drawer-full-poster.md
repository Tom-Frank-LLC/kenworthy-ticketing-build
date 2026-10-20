---
brief: drawer-full-poster
title: The event drawer shows the whole poster, not a 16:9 crop, when there is no trailer
status: shipped
track: ux
date: 2026-10-20
shipped_in: ["#395"]
shipped_at: 2026-10-20
verified: true
---

# Brief: show the full poster (not a crop) in the event drawer when there's no trailer

**Shipped:** #395 (`aba8693`), deployed 20 Oct 2026. Production `6bfede92`
(rollback `b0a3a9cc`), staging `12e8a0df` (rollback `97fb85ca`). Checked live on
kenworthy.org: the served bundle carries the change.

**Requested by:** Tom. "Indivisible Moscow: What's on your ballot?" has a poster
and no trailer, and the drawer cropped the poster to a 16:9 banner.

## Cause

`ProductionMedia` (`src/components/ProductionMedia.tsx`) takes an `aspect` prop.
`'video'`, the default, puts the poster in an `aspect-video` box with
`object-cover`, which crops a portrait poster down to a strip of its middle.
`'auto'` shows the poster at its own proportions with `object-contain`.
`ProductionDetailDrawer` passed no `aspect`, so it got the crop. The ticketing
page (`Showing.tsx`) already passed `aspect="auto"`.

The drawer only opens below the calendar's inline-preview breakpoint, so on
phones. At desktop width the calendar list opens `ShowingPreview` inline
instead, and that was already showing the full poster.

## Change

- The drawer passes `aspect="auto"`.
- New `posterClassName` prop on `ProductionMedia` (used only in `'auto'`). The
  drawer gives it `max-h-[65vh]`, so a tall poster leaves the title and
  showtimes in view. Past the cap the poster is letterboxed on `bg-secondary`,
  never cropped or stretched.
- Trailers stay 16:9 (`aspect` never applied to them). With no poster and no
  trailer, the drawer still shows the icon tile.

## Verified (dev server, production data, 375px iframe)

- Indivisible Moscow and Good Faith Medical Judgement: both 1000×1500 posters,
  drawn whole at 357×506 (the 65vh cap on a 778px viewport).
- Six productions with trailers: still the 16:9 iframe, 357×201.
- No landscape poster exists in production to try in the browser. The unit
  tests cover the `object-contain` / no-crop classes. A landscape poster's
  natural height falls under the cap, so it renders at full width.
