---
brief: home-layout-search-carousel-preview
title: Tighten the hero, put search on the Upcoming row, and give the curator's pick a carousel
status: built
track: ux
severity: P2
date: 2026-08-25
verified: false
---

# Brief (for Claude Code): Home page — tighten hero, merge search, curator carousel, scrollable preview

**Status:** 🟢 Public home-page layout. Five independent changes; the only real trap is the search bar disappearing when a search returns zero matches (see Part B).
**Date:** August 25, 2026
**Requested by:** Tom — five home-page adjustments (hero crop, search merge, curator carousel, curator section resize + vignette, scrollable preview text).

## Where everything lives (verified)
- **Hero:** `src/components/home/HomeMarquee.tsx` — a `min-h-[68vh] lg:min-h-[78vh]` section with an absolute `<img object-cover>` (`objectPosition: 'center 92%'`).
- **Search:** rendered as its **own `<section>`** in `src/pages/Index.tsx` (L178–193, "Find a showing" label + `<SearchBar value={query} onChange={setQuery}/>` + match count). `query`/`setQuery` state and `filteredFeed` live in `Index.tsx`.
- **Upcoming:** `src/components/home/UpcomingList.tsx` — header row at L54 (`flex items-end justify-between … flex-wrap`: eyebrow + "Upcoming" `<h2>` on the left, list/calendar toggle on the right); body grid `lg:grid-cols-[1fr_1.8fr]` (L114) with the list `<ul>` and the `ShowingPreview` pane (L171).
- **Curator's pick:** `src/components/home/BoothNote.tsx` — picks **one** item (`items.find(i => i.isFeatured) ?? items[0]`), renders it in a `max-w-4xl mx-auto` poster+copy split.
- **Preview text:** `src/components/home/ShowingPreview.tsx` L102–105 — the curator note is `line-clamp-[10]` (truncated to 10 lines).
- **Carousel primitive already exists:** `src/components/ui/carousel.tsx` (shadcn + `embla-carousel-react`, already a dependency). Use it — don't hand-roll.
- **SearchBar API:** `SearchBar({ value, onChange, placeholder })`, `w-full max-w-xl`.

## Part A — Crop the hero bottom 10%, pull everything below up
Reduce the hero's visible height by ~10% so the sections beneath rise by that amount.
- Drop the section height ~10%: `min-h-[68vh] lg:min-h-[78vh]` → roughly `min-h-[61vh] lg:min-h-[70vh]` (tune to taste).
- Re-check `objectPosition` (currently `center 92%`) and the internal bottom spacing (`pt-32 … lg:pt-56`, headline block) so the marquee sign stays framed and the headline/address don't clip — trimming the bottom, not the marquee. **Decision A:** confirm 10% is the target and it's the *bottom* being trimmed (not a symmetric zoom).
- Verify at 375 / 768 / 1280 that the headline, eyebrow, and address still sit in the scrim and nothing overflows.

## Part B — Merge the search bar into the Upcoming header (same row as "Upcoming")
Move search out of its standalone section and onto the Upcoming header row.
1. **Delete** the search `<section>` in `Index.tsx` (L178–193).
2. **Pass** `query`, `onQueryChange` (`setQuery`), and the match count (`filteredFeed.length`) into `UpcomingList` as props.
3. **Render** `<SearchBar>` in the `UpcomingList` header row (L54), on the **same row as the "Upcoming" heading** — recommended placement: heading on the left, search + match count + the list/calendar toggle grouped on the right; wrap gracefully below `md` (`flex-wrap` is already there). Constrain the search width so it doesn't crowd the toggle (`max-w-xs`/`sm`).
4. **The trap (must handle):** today the search section renders whenever `feed.length > 0`, but `UpcomingList` only renders when `filteredFeed.length > 0`. If the search now lives *inside* `UpcomingList`, a query with **zero matches** unmounts the whole section — taking the search box with it — so the user is stranded with no way to see or clear their query. Fix by ensuring the header (with the search bar and a "0 matches — clear" affordance) **still renders when the filtered list is empty**: render `UpcomingList` whenever `feed.length > 0` and show an inline "No showings match '<query>'. Clear search." empty state in the body instead of returning null. **Decision B:** confirm this behavior (recommended) vs keeping search always-visible some other way.
5. Keep the match-count text ("N matches") next to the search, as today.

## Part C — Curator's pick → carousel of picks
In `BoothNote.tsx`, show **all** featured picks as a slidable carousel instead of a single item.
1. Collect the set: `items.filter(i => i.isFeatured)`; if none, fall back to `[items[0]]` so it never renders empty (preserve current fallback). **Decision C:** carousel spans all `is_featured` items (recommended) — confirm there isn't a desired cap (e.g. max 5).
2. Build with the existing `src/components/ui/carousel.tsx` (embla): one pick per slide, **left/right arrow controls**, keyboard arrows, swipe on touch, and (optional) dot indicators. Loop vs clamp is **Decision D**.
3. Each slide keeps the current poster+copy treatment and the Get-Tickets CTA/past-showing guard already in the component — reuse per-slide, don't reinvent.
4. Accessibility: arrows are real buttons with labels; `aria-roledescription="carousel"`/slide semantics per the primitive; respects `prefers-reduced-motion` (no auto-advance — this is manual only unless Tom asks for autoplay).

## Part D — Curator section: match Upcoming's height, full-width, wider text, vignette
Still in `BoothNote.tsx` (the section wrapper):
1. **Full-width:** remove `max-w-4xl mx-auto` so the section is full-bleed; widen the **copy column** (give text more room now that it's not boxed to 4xl).
2. **Height parity with Upcoming:** cap the slide/content height to roughly the Upcoming body (`UpcomingList`'s list is `lg:max-h-[560px]`) so the two sections read as equal bands. A long curator note inside a slide should **scroll within the slide** (same pattern as Part E) rather than growing the band. **Decision E:** exact target height (match 560px vs a chosen band height).
3. **Vignette:** darken the edges of the full-width band — an inset radial/`box-shadow: inset` or an `aria-hidden` gradient overlay concentrating darkness at the left/right (and top/bottom) edges, keeping the center clear. Decorative only; must not reduce text contrast (keep it within the readability targets). **Decision F:** vignette strength/style (subtle inset shadow recommended).
4. Re-verify the poster+copy split still reads well full-width at 375 / 768 / 1280 (the poster shouldn't balloon; cap its max width as today).

## Part E — Scrollable preview text on Upcoming
In `ShowingPreview.tsx` (L103), replace the `line-clamp-[10]` on the curator note with a **max-height + vertical scroll** so long notes scroll inside the preview pane instead of being cut off:
- e.g. `max-h-[...] overflow-y-auto pr-2` (choose a height that fits the pane's poster row; the pane is a `[2fr_3fr]` grid so tie the text max-height to the poster's rendered height where practical).
- Style the scrollbar to the theme (thin, accent-tinted) so it doesn't read as a raw OS bar; keep it keyboard-scrollable and don't trap focus.
- **Decision G:** show the full note scrollable (recommended) vs keep a clamp *and* add a "read more" — recommend pure scroll for simplicity.

## Decisions for Tom
A. Hero: 10% off the **bottom** (recommended) — confirm amount.
B. Search stays visible with an inline empty state on 0 matches (recommended).
C. Carousel includes **all** featured picks (recommended) vs a cap.
D. Carousel **loop** vs clamp at the ends.
E. Curator band height: match Upcoming's 560px vs a specific height.
F. Vignette: subtle inset shadow (recommended) vs stronger gradient.
G. Preview text: scroll-only (recommended) vs clamp + "read more".

## Test plan
- Hero is ~10% shorter; marquee still framed; headline/address unclipped at 375/768/1280; sections below sit higher.
- Search appears **on the Upcoming header row**; typing filters the list; the standalone search section is gone; a **zero-match** query still shows the search box + a clear affordance (section doesn't vanish); match count is correct.
- Curator's pick is a carousel: left/right arrows, keyboard, and swipe move between all featured picks; single-pick case still renders (no dead arrows or a disabled/È hidden control); CTA and past-showing guard work per slide.
- Curator section is full-width with a wider text column, capped to ~Upcoming height, with an edge vignette that doesn't hurt contrast; long notes scroll within the slide.
- Upcoming preview: a long curator note **scrolls** within the pane (themed scrollbar), short notes render normally with no empty scroll area; keyboard scroll works.
- `prefers-reduced-motion` respected (no motion the user didn't trigger); `npm run build` + tests pass.

---

## Decisions taken (2026-08-26)

Answered by Tom before implementation; recorded here so a later session does
not re-litigate them.

| | decision |
|---|---|
| A | Hero loses ~10% off the **bottom**: `68/78vh` → `61/70vh`, and the headline's top padding drops with it (`md:pt-48 lg:pt-56` → `md:pt-44 lg:pt-52`). |
| B | Search stays visible on zero matches, with an inline "No showings match …" + Clear search. |
| C | Carousel spans **all** `is_featured` picks, no cap. Falls back to the first chronological item, as before. |
| D | **Clamp**, not loop — a disabled Next is how the reader learns they have seen every pick. |
| E | Band height **440px**, not the 560px of the Upcoming list. |
| F | Vignette: subtle, edges darkening toward black. |
| G | Preview note: **scroll only**, no clamp and no "read more". |

## What the brief got wrong

Three things did not survive contact with the code. Left here because each one
would cost the next reader the same time it cost this one.

1. **`UpcomingList` returns `null` on two conditions, not one.** The brief
   caught `filteredFeed.length === 0` in `Index.tsx` but not the component's
   own `if (dated.length === 0) return null`, which fires whenever every match
   is an undated RSVP/info-only event. Either one would have taken the search
   box down with it. Both are handled.

2. **The hero had already been rewritten.** The eyebrow the brief describes is
   gone and the headline block is a `contents`/`md:flex` pair. The line numbers
   still matched, which is exactly why they were not evidence.

3. **`object-position` had to move, and in the counter-intuitive direction.**
   `object-cover` scales the hero to the band's *width*, so the band's height
   only decides how much gets cut and the percentage decides from which end.
   Anchored at the old 92% — near the image bottom — shortening the band ate
   into the **top** and clipped the marquee sign's own frame, the opposite of
   "crop the bottom". 80% takes the trim off the bottom and keeps the top
   framing the taller band had. Verified at 1280 and 1621; below `md` the
   value is inert, because there the image scales to the height and no
   vertical overflow is left to distribute.

## Note for whoever tests this in a driven browser

The curator carousel looks broken under Chrome automation and is not. A
backgrounded tab reports `visibilityState: "hidden"` and fires **zero**
`requestAnimationFrame` callbacks, so embla's animation loop never advances:
its measurements are right (`target: -1382`) and `location` stays at 0, the
arrows enable and disable correctly, and nothing moves. Shim
`requestAnimationFrame` onto `setTimeout` in the page and the transforms appear
as expected. The shadcn carousel primitive had no other caller in this repo
before this brief, so "it already exists" was not evidence that it worked —
that had to be established separately.
