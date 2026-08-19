---
brief: tickets-filmpass-buttons
title: Rename "Get Tickets" → "Tickets" and add a "Film Pass" button beside it
status: shipped
track: feature
date: 2026-08-13
shipped_in: ["a046ca3"]
verified: true
---

# Brief (for Claude Code): Rename "Get Tickets" → "Tickets" and add a "Film Pass" button beside it

**Status:** ✅ Shipped and verified in production August 13 2026 — `a046ca3`
**Date:** August 13, 2026
**Requested by:** Tom — change the header "Get Tickets" button to just "Tickets", and add a "Film Pass" button next to it that goes to the film-pass purchase page.

## Goal
In the site header CTA, rename **Get Tickets → Tickets** and add a second button, **Film Pass**, linking to `/film-passes`.

## Target route (already exists)
`/film-passes` is wired in `src/App.tsx` (~line 87) to `FilmPassesPage` — the public, no-sign-in film-pass purchase page (distinct from `/my-passes`, which is the signed-in view). So the Film Pass button's destination already exists; no routing change needed.

## Changes

### Desktop header — `src/components/Layout.tsx` (~line 189–190)
Current:
```jsx
<Button size="sm" asChild className="h-10 px-4 sm:px-5">
  <Link to="/calendar">Get Tickets</Link>
</Button>
```
- Change the label to **Tickets**.
- Add a **Film Pass** button immediately beside it linking to `/film-passes`. Differentiate the two visually — keep **Tickets** as the primary (filled) button and make **Film Pass** a secondary/outline variant so "Tickets" stays the dominant CTA:
```jsx
<Button size="sm" asChild className="h-10 px-4 sm:px-5">
  <Link to="/calendar">Tickets</Link>
</Button>
<Button size="sm" variant="outline" asChild className="h-10 px-4 sm:px-5">
  <Link to="/film-passes">Film Pass</Link>
</Button>
```
Keep them in the same flex row/nav container; they should sit next to each other and wrap gracefully on narrow widths.

### Mobile drawer — `src/components/MobileNav.tsx` (~line 189–193)
The drawer's full-width "Get Tickets" CTA:
```jsx
<Button asChild className="h-12 w-full justify-center text-base">
  <Link to="/calendar" onClick={close}><Ticket className="mr-2 h-4 w-4" /> Get Tickets</Link>
</Button>
```
- Rename to **Tickets**.
- Add a full-width **Film Pass** button (outline variant) directly below/beside it, linking to `/film-passes`, also calling `close` on click. Use a fitting icon (`CreditCard` is already imported here for the film-pass nav row).

## Out of scope — do NOT change
Two other "Get Tickets" strings are **per-showing** buttons, not the header CTA, and should stay as-is (a "Film Pass" button makes no sense next to a specific showing):
- `src/components/home/TrailerFeed.tsx` (~line 220)
- `src/components/home/EditorialCalendar.tsx` (~line 110)

## Acceptance
- Desktop header shows **Tickets** (primary) and **Film Pass** (outline) side by side; they navigate to `/calendar` and `/film-passes`.
- Mobile drawer shows both; both close the drawer and navigate correctly.
- The per-showing "Get Tickets" buttons are unchanged.
- `npm run build` passes.

---

## Verified in production — 2026-08-13

Checked against `kenworthy-ticketing-build.mrtomfrank.workers.dev`, not just the diff.

| Acceptance item | Result |
|---|---|
| Desktop header: **Tickets** (primary) + **Film Pass** (outline), side by side | ✅ confirmed in the rendered page |
| They navigate to `/calendar` and `/film-passes` | ✅ |
| Mobile drawer shows both, both close the drawer | ⚠️ source + deployed bundle only — see below |
| Per-showing "Get Tickets" unchanged | ✅ `TrailerFeed.tsx:220`, `EditorialCalendar.tsx:110` both intact |
| Build passes | ✅ |

**The mobile drawer was not verified visually.** `resize_window` reported success but the
screenshot kept capturing a 1200px desktop viewport, so the drawer never rendered to look at.
What is confirmed: `MobileNav.tsx` carries both links with `onClick={close}`, and `MobileNav`
ships in the non-lazy entry chunk, where `Film Pass` and `/film-passes` are both present in the
deployed `index-*.js`. Strong, but not the same as watching it open — worth one look on a phone.

**Note for anyone verifying a bundle this way:** a component imported by two lazily-loaded routes
gets emitted as its own chunk, sometimes named after an unrelated module. Grepping the route chunk
for its strings finds nothing and reads exactly like a failed deploy. Search every chunk.
