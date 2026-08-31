---
brief: mobile-header-k-mark
title: On a phone the header carries the "K" mark, centred between the menu and Tickets
status: shipped
track: ux
date: 2026-08-28
shipped_in: ["#257"]
shipped_at: 2026-08-31
verified: true
evidence: >-
  PR #257 squash-merged as c6e656b. Production worker version
  bf604f78-8e54-4c92-ba49-869069998f5f (rollback: 47e269a7-0d4e-439b-ae84-5456fcb4f6da).
  kenworthy.org and the workers.dev origin both serve assets/index-JCgvsO9H.js
  (text/javascript, 301208 bytes) and assets/index-BKBZ2qL3.css (text/css), and
  that stylesheet carries both `grid-template-columns:1fr auto 1fr` and
  `display:contents`. Driven headlessly against kenworthy.org: at 360/390/414
  the row computes `display: grid`, the brand image is the inlined K mark at
  61x54, and its centre offset from the viewport centre is 0px; at 640 and 1280
  the row is `flex` and the full lockup returns at 206x54 and 242x69, the same
  geometry a stashed baseline of unmodified main produced. Prior prod was
  023ee2a, confirmed by reproducing its bundle hash (index-BaFsZB0c.js) from a
  clean build of that commit — so nothing unmerged was overwritten.
---

# Brief (for Claude Code): Mobile header — use the "K" mark, and try the nav bar centered

**Requested by:** Tom, 28 Aug 2026. An experiment — "let's try it" — so the
change is deliberately confined to one breakpoint and reverting it is two
class strings.

## What shipped

Below `sm`, `Layout.tsx`'s header row is a three-zone grid — hamburger, mark,
CTA — with `KenworthyMark` in place of the full lockup. From `sm` up the row is
the previous `flex justify-between` and the previous lockup, unchanged.

- **Part A — the mark on phones.** Both pieces of artwork render inside the one
  home `<Link>` and are swapped with `sm:hidden` / `hidden sm:block`, not by
  JS, so the right one is in the first paint. The mark has no centenary
  variant, but the bar it sits in is taller while the centenary lockup is
  current, so its height tracks the bar (`h-11` at 84px, `h-9` at 68px) to hold
  the same optical weight either side of 1 Jan 2027.
- **Part B — centred.** `grid-cols-[1fr_auto_1fr]`, chosen over `grid-cols-3`
  because the side columns then take equal shares of the *leftover* width
  whatever they hold. That is what keeps the mark on the row's true centre when
  the sides are nothing like the same size — and a signed-in staff member's
  right-hand zone is empty below `sm`, which under equal thirds would alone
  push the mark off centre.
- The old left cluster becomes `display: contents` below `sm`, which dissolves
  its box so the hamburger and the brand link become grid items of the row.
  That is what lets the three-zone layout exist without a second copy of the
  header for phones. The desktop links inside it are `hidden` until `lg`, and
  `display: none` keeps them out of the grid entirely.

## Decisions

1. **Breakpoint: `sm`, not the `md` the brief recommended.** Measured, not
   assumed. The lockup is 3.78:1 artwork; at 360px it renders 150x50 — squashed
   — and at 640px it renders 206x54, its true ratio. The crowding the swap
   exists to fix stops at `sm`, not at `md`. Centring past `sm` is also
   actively worse: `sm` is where Film Pass rejoins Tickets, so the right zone
   becomes ~250px against a 54px hamburger and the mark ends up mathematically
   centred and optically jammed into the buttons. Using `sm` also means one
   boundary governs the mark, the grid and the second CTA rather than three.
2. **Trim the mobile CTAs to Tickets: already done.** PR #235
   (`mobile-layout-pass`) gated Film Pass behind `sm:` and the drawer already
   carries it as a full-width button. No change was needed here.
3. **Flanked, not fully centred** — as recommended. The hamburger and Tickets
   stay real targets (54px and 50px tall).

The bar's height and `--header-height` are untouched, so `.sticky-below-header`
needs nothing.

## Verified

Chromium at 360 / 375 / 390 / 414 / 640 / 768 / 1024 / 1280:

- Mark centre offset from the viewport centre is **0px** at every width below
  `sm`, including with the right-hand zone emptied (the signed-in shape).
- `document.scrollWidth === innerWidth` at every width — no horizontal scroll.
- From 640 up, the brand image geometry is **identical to unmodified `main`**
  (206x54 / 225x59 / 64x69 / 242x69), measured against a stashed baseline.
  Desktop really is unchanged.
- With the clock moved to 2027 the bar drops to 68px, the standard lockup is
  current, and the mark renders 50x45, still centred.
- Link accessible name is "Kenworthy — home"; the images carry `alt=""`,
  because the link's `aria-label` is the accessible name either way and an
  `alt` here would only be text a screen reader never reaches. Header focus
  order is Open menu → Kenworthy — home → Tickets. The drawer still opens.
- `tsc -p tsconfig.app.json --noEmit` clean; 732 tests pass; `build:production`
  emits both `grid-template-columns:1fr auto 1fr` and `display:contents`.

## Found, not fixed — out of scope

At **1024px the desktop lockup collapses to 64x69** (0.93:1 against 3.78:1
artwork) — a smudge, at the most common laptop width. This is **pre-existing on
`main`**, reproduced identically from a stashed baseline, and is the same
"the logo is the flex item that yields" failure the comment in `Layout.tsx`
already describes, recurring at `lg` where the whole desktop link set appears
at once. It is a desktop bug and this brief fenced desktop off, so it is
recorded here rather than fixed in passing. `shrink-0` on the brand link is the
likely one-line fix. See [BRIEF-header-nav-overlap-768.md](BRIEF-header-nav-overlap-768.md).
