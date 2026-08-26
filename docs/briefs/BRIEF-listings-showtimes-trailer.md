---
brief: listings-showtimes-trailer
title: Listings show the other showtimes inline and play trailers in a lightbox
status: shipped
track: ux
date: 2026-08-18
shipped_in: ["#187"]
shipped_at: 2026-08-26
verified: true
---

# Brief (for Claude Code): Inline showtimes + cinematic trailer on listings (retire the drawer path)

**Status:** 🟢 UI change on the public listings. Reuses logic that already exists in the drawer.
**Date:** August 18, 2026
**Requested by:** Tom — two changes to the listings:
1. **Remove the "All showings" button.** In its place: **nothing** when there aren't multiple upcoming showings, or **clickable date/time chips** for the upcoming showings when there are.
2. **Remove the trailer drawer.** Play the trailer in a **cinematic centered modal** — trailer in the middle of the screen, everything behind it darkened, the trailer the only focal point.

## Decisions, as taken (Tom, 2026-08-25)

1. **Scope** — home preview *and* Calendar's List view. They share
   `ShowingPreview`, so both changed in one edit.
2. **Multiple showings** — keep **Get Tickets** (green, to the previewed
   showing) *and* the chips. The chips list every *other* upcoming date, under
   an "Also playing" heading; the previewed showing is not repeated as a chip.
3. **Trailer audio** — autoplay with sound on. Player controls are on, because
   a browser may still refuse unmuted autoplay on a low-engagement site and
   that has to be a one-click recovery rather than a dead frame.
4. **Showing page** — not wired. `Showing.tsx` embeds the trailer inline in the
   page and has no "watch" trigger to convert; `TrailerModal` is reusable if one
   is ever wanted.
5. **`ProductionDetailDrawer`** — kept for mobile, for the month grid, and for
   admin. Removed only from the desktop preview pane.

### What the brief did not account for

`ShowingPreview` only ever renders at `lg` and up — both callers gate it. Below
`lg`, tapping a row calls `onSelect`, and **that is the drawer**; the month grid
opens it at every width. So "no public listing still opens the drawer" would
have left phones with no route to showtimes, trailer or synopsis at all. The
drawer stays mounted on both pages for exactly those two paths, and the
`onSelect` prop is still threaded through `UpcomingList` to serve them.

Consequence for the "lose nothing" check: on desktop the full synopsis is now
reached through `/showing/:id` rather than the drawer (the preview shows the
description clamped to ten lines). On mobile it is still in the drawer,
unchanged.

### Shipped once, reverted, shipped again

Deployed to staging and production on 26 Aug from an unmerged branch, verified
live on both — and then overwritten within hours by a parallel session's deploy
from a tree without this commit. `wrangler deploy` uploads a local `dist/`
straight to Cloudflare; git is not in that path, so an unmerged deploy survives
only until the next one. It was merged as #187 *before* being redeployed, which
is the only ordering that makes a frontend change stick.

### One real bug found while building

The modal was first written as a controlled dialog (`open` / `onOpenChange`)
with the caller rendering its own button. Radix's modal `Content` calls
`preventDefault()` on close-auto-focus and then focuses its own `DialogTrigger`
— so with no trigger mounted, closing dropped focus to `<body>` and a keyboard
reader lost their place in the list. `TrailerModal` therefore takes the trigger
as a child and wraps it in `DialogTrigger`. Verified in Chrome: Esc and the
close button both return focus to "Watch trailer".


## Current state (verified)
- The home preview `ShowingPreview.tsx` has three buttons: **Get Tickets** (→ `/showing/:id`), **All showings** and **Watch trailer** — the latter two both open `ProductionDetailDrawer` via `onViewDetails`.
- `ProductionDetailDrawer` (a right-side `Sheet`) already renders exactly what we want to surface: an **Upcoming Showings list** of clickable rows (date · time · price → `/showing/:id`) plus the **trailer** (via `ProductionMedia`) and the description. So the logic exists — we're relocating it, not inventing it.
- The preview `item` currently carries only a single `showingId`, not the list of upcoming showings — that's the one data addition needed (below).
- **The drawer is also used by `Calendar.tsx` and `AdminDashboard.tsx`**, so it can't simply be deleted — see Scope.

## Part A — Inline upcoming showtimes (replace the "All showings" button)
1. **Remove the "All showings" button** from `ShowingPreview`.
2. **Data:** have the `Index.tsx` feed builder attach an `upcomingShowings` array per production — `{ id, start_time, ticket_price }[]`, upcoming only, sorted soonest-first — from the showings already loaded. (Today it maps just one `showingId`.)
3. **Render inline** in the preview, in the slot the button occupied:
   - `upcomingShowings.length <= 1` → **render nothing** (the **Get Tickets** button already routes to that single/next showing).
   - `upcomingShowings.length > 1` → a wrapping row of **clickable date/time chips**, each linking to `/showing/:id` (e.g. "Fri, Aug 29 · 7:00 PM"). Use the site tokens (outline/gold chips; keep **Get Tickets** as the green primary to the soonest showing — Decision 2).
   - Chips are real links (keyboard-focusable, visible focus), wrap cleanly on mobile, and use `formatShowtime` for consistency.

## Part B — Cinematic trailer modal (replace the drawer for trailers)
1. **"Watch trailer"** opens a **full-viewport centered lightbox**, not the drawer:
   - A dark backdrop (`bg-black/80`+ with a slight blur) covers everything; the trailer sits **centered**, responsive **16:9**, sized to the viewport (e.g. `min(92vw, calc(85vh * 16/9))`), nothing else competing.
   - Reuse `resolveTrailer` + the file/YouTube-embed rendering already in `ProductionMedia`/`TrailerFeed` — don't re-implement trailer resolution.
   - **Close** on backdrop click, Esc, and an explicit close button; **focus-trap** while open and **return focus** to the trigger on close; `role="dialog"`, `aria-label` with the title.
   - **Autoplay on open** (it's an explicit "watch" action) — sound-on vs muted-with-unmute is Decision 3; respect `prefers-reduced-motion` (don't autoplay motion behind it; the trailer itself is user-initiated so it may still play).
2. Build it as a small reusable `TrailerModal` so it can also serve the Showing page trailer if wanted (Decision 4).

## Scope & the drawer's fate
- Apply A + B to the **public listings**: the home preview, and (recommended) the **Calendar** listing, so the experience is consistent (Decision 1).
- **Don't delete `ProductionDetailDrawer` outright** — it's still referenced by `AdminDashboard` (and Calendar until migrated). Once the public listings use inline showtimes + the trailer modal, remove the drawer from those public paths; keep it for admin, or fully retire it only after confirming nothing else needs it (Decision 5).
- **Lose nothing:** the drawer also showed the description — the preview already shows the curator note, so verify the description is still reachable on the listing (and on Calendar) after the drawer is dropped; if a listing relied on the drawer for the full synopsis, surface it inline or via the showing page.

## Cross-cutting
- Accessibility: modal focus-trap/Esc/return-focus; showtime chips as proper links; visible focus; `prefers-reduced-motion` honored.
- Mobile: chips wrap; the trailer modal fills small screens (near-full-width 16:9) with an easy close target.
- Keep the green **Get Tickets** CTA treatment; chips are secondary.

## Decisions for Tom
1. **Scope:** home preview only, or all public listings incl. Calendar (recommended).
2. **Multiple showings:** keep **Get Tickets** (→ soonest) *plus* the chips (literal reading, recommended), or let the chips replace Get Tickets when there are several.
3. **Trailer audio:** autoplay with **sound on** (recommended for an explicit "watch"), or muted with an unmute control.
4. **Reuse the modal on the Showing page** trailer too, or listings only?
5. **Retire `ProductionDetailDrawer`** from public views only (keep for admin) vs fully.

## Test plan
- A production with **one** upcoming showing shows **no** showtime row (just Get Tickets); a production with **several** shows **clickable date/time chips**, each opening the right `/showing/:id`.
- The **"All showings" button is gone**; no dead `onViewDetails` path remains for showings.
- **Watch trailer** opens a centered, darkened cinematic modal; backdrop click / Esc / close button all dismiss it; focus is trapped then returned; it works on mobile.
- No public listing still opens the right-side drawer; admin (if kept) still works.
- Description remains reachable on listings (nothing lost with the drawer gone).
- Keyboard + screen-reader pass on chips and modal; `prefers-reduced-motion` respected; `npm run build` + tests pass.
