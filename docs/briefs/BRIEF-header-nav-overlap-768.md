---
brief: header-nav-overlap-768
title: The Support menu sits on top of the Tickets button at tablet width
status: built
track: bug
severity: P2
date: 2026-08-27
verified: true
evidence: On staging at version 53ed241b — zero pairwise header overlaps at 375/414/640/768/900/1024/1280/1440, with the visible nav-item count identical to production at every width. Production still overlaps Support|Tickets at 768.
---

# Brief: header links collide with the header buttons at ~768px

**Found:** 27 Aug 2026, by asserting pairwise bounding-box overlap on every
header link and button across a range of viewports. Present in production now.

## Symptom

At 768px wide the **Support** dropdown trigger is drawn on top of the green
**Tickets** button. Both are clickable, they overlap by ~51px, and whichever
is painted last wins the tap.

Measured on production (`kenworthy-ticketing-build`, Anton):

| viewport | overlapping header pairs |
|---|---|
| 768 | `Support \| Tickets` |
| 900 | none |
| 1024 | none |

So the broken window is roughly 768–850px — iPad portrait, and the smaller
Android tablets.

## Cause

`src/components/Layout.tsx`. The bar is one flex row: a left group of nav
links (`min-w-0`) and a right `<nav>` of buttons. At 768 the left group's
content is wider than the space left over, and because the links are inline
they overflow their box rather than compressing it — so they paint over the
buttons instead of pushing them.

The left group at 768 runs to x=575 while Tickets starts at x=524. The five
inter-item gaps at that width are `md:gap-8` (36px at this project's 18px
root), or ~180px of the row spent on whitespace.

## Note for whoever picks this up

There is a second, larger fix available and it is **not** the one to reach for
first: gating `Rentals` / `Info` / `Support` at `lg:` instead of `md:`. The
comment above `<MobileNav />` says the drawer is the full menu below `lg`,
which makes that look like the intended design. It does fix the overlap — but
it also removes three links from the bar across 850–1023px, where they
currently fit and work fine. That is a navigation change, not a bug fix.

Prefer tightening the gap at `md` and leaving the links where they are.

## The fix

Step the nav gap with the viewport the way the container padding already
does — `md:gap-5 lg:gap-8` rather than a flat `md:gap-8`. That returns ~67px
across the row at 768, comfortably more than the ~51px overlap, and restores
the full `gap-8` from `lg` where there is room for it.

## Test plan

- No pairwise overlap between any two header links/buttons at 375, 414, 640,
  **768**, 900, 1024, 1280, 1440.
- Every nav item that is visible today at each of those widths is still
  visible — this fix must not hide any link.
- No document horizontal overflow introduced at any of those widths.
- Spacing at `lg` and up is unchanged from today.
