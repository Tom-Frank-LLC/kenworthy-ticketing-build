---
brief: curator-marquee-header
title: The home page's staff-pick band is framed in the marquee lights, under a "Staff Pick / What We're Watching" header, and the pick titles drop to h3
status: shipped
track: ux
severity: P3
date: 2026-09-23
shipped_in: ["#338"]
shipped_at: 2026-09-24
verified: true
---

> **What shipped (2026-09-24) — and where it left the brief below.** The
> brief asked for the ring at the `--title` weight *as* the header. That was
> built and put on staging first, then iterated with Tom across five staging
> deploys, and what shipped is different in three ways:
>
> - **The ring frames the slides, not the heading.** `MarqueeFrame` at the
>   panel weight the concessions menu wears (`bg-card/30 rounded-sm`), around
>   the single slide or the carousel. Tried and rejected on the way: the ring
>   as a title strip (the brief's version — too slight), the ring around
>   heading and slides together, and the ring on the Upcoming listing instead
>   (looked like a lit bill, but the staff pick is the thing worth framing).
> - **The header is plain type above the ring**, right-aligned, and copies the
>   Upcoming band's header pattern exactly — small accent eyebrow **Staff
>   Pick** over the display h2 **What We're Watching** — so the two bands read
>   as one system. "Curator's Pick" is gone from the page; the carousel's
>   `aria-label` says "Staff picks".
> - **The "N picks" counter is gone**, and the row that held it loses its top
>   margin at `lg`, where it holds nothing in flow (the arrows go absolute
>   there). Without that the ring carried an empty row's worth of space under
>   the slide.
>
> The rest is as recommended: **the eyebrow is trimmed** to the day (plus
> "· this screening" where it already applied); the fallback item keeps
> "Featured · <day>". A hand-written slide had only "Curator's pick" to say
> and no date to fall back to, so its eyebrow is dropped — `SlideFrame`'s
> `eyebrow` is optional now. **The header stays up** over the fallback item.
> And `ShowtimeChips`' "Also playing" inside a production pick passes
> `headingLevel="h4"`, so it stays nested under the h3 title rather than
> reading as its sibling.
>
> Trade-off recorded: at 375px the panel-weight ring costs ~43px a side, so
> the content column is ~255px rather than ~335px; long titles wrap one line
> more. `--mq-inset` is the knob if that ever needs buying back.

# Brief (for Claude Code): Marquee-lights header for "Curator's Pick" on the home page

**Status:** 🟢 Small, mostly-reuse change. The marquee-lights element already exists as a shared component and is already used as a section header elsewhere — this puts the same header above the home page's curator's-pick band. The one care item is heading hierarchy (the home page's single `<h1>` must stay the hero), which pulls the pick titles down one level.
**Date:** September 23, 2026
**Requested by:** Tom — add the marquee-lights design element (the ring of bulbs used as the "LISTINGS" header on the admin dashboard) to the home page as the header for **Curator's Pick**.

## Current state (verified, build `b10bc0c`)
- **The element is a shared component, not a one-off.** `src/components/MarqueeFrame.tsx` frames its children in the Kenworthy marquee's ring of bulbs. It is purely ornamental — the ring is drawn in CSS pseudo-elements, the one real node is `aria-hidden`, and nothing in it enters the reading order. Geometry lives in `.marquee-frame` in `src/index.css` (L481–594), with a lighter **section-heading** variant `.marquee-frame--title` (L584–593) and its own mobile band.
- **It is already used as a section header** exactly the way this request wants. `AdminDashboard.tsx:780–784` wraps the current section's `<h1>` in `<MarqueeFrame className="marquee-frame--title text-center">` — that is the "LISTINGS" header in Tom's screenshot. `Concessions.tsx:153` uses the panel weight (the menu border). So there is a proven pattern for both weights; **reuse `--title`, do not rebuild.**
- **The curator's-pick band today has no section header.** `src/components/home/BoothNote.tsx` renders the picks (a single slide, or a carousel) inside `<section>` → `<div className="container relative py-10 md:py-14">` (L644). Its old "What we're watching this week" heading was deliberately removed (see the comment at L374–376); each slide instead carries a small per-slide **eyebrow** — `SlideFrame`'s `<p className="font-serif text-xs uppercase tracking-[0.25em] text-accent">` (L106–108) — reading `Curator's pick · <day>` for a flagged pick, `Featured · <day>` for the fallback item, or just `Curator's pick` for a hand-written slide (L348–360, L461).
- **Heading hierarchy on the home page:** the page's only `<h1>` is the hero headline in `HomeMarquee.tsx` ("A Century of Stories…"). `UpcomingList` uses `<h2>Upcoming</h2>`. Inside BoothNote, **each pick title is currently an `<h2>`** (L377, L475) — sitting directly under the hero `h1` with no section heading between them.

## The change
### 1. Add the marquee header above the band (the core ask)
In `BoothNote.tsx`, at the top of the inner container (`<div className="container relative py-10 md:py-14">`, L644), before the `single ? <Slide…> : <Carousel…>` block, render the same header the dashboard uses:

```tsx
<MarqueeFrame className="marquee-frame--title text-center mb-8 md:mb-10">
  <h2 className="font-display text-2xl md:text-3xl font-bold uppercase tracking-wider">
    Curator's Pick
  </h2>
</MarqueeFrame>
```

- **Reuse `MarqueeFrame` + `marquee-frame--title`** — same import and same classes as `AdminDashboard.tsx:780`. No new component and **no new CSS**: the ring uses `background-repeat: space`, so the bulbs distribute evenly across the container width on their own; it needs no fixed width and already has a mobile band.
- It renders in **both** the single-pick and carousel branches (it goes above the conditional), and stays inside the full-bleed section's `container`, so the bulbs sit within the page gutter rather than running to the screen edge.
- Contrast/motion: the band is `bg-background` (near-black) with a radial darken; gold bulbs on dark read the same as they do on the dark admin dashboard. The frame is static — no animation — so there is **no reduced-motion case to add** (matches the admin note at `AdminDashboard.tsx:770–772`).

### 2. Fix the heading levels the new header introduces (don't skip — this is the structural care item)
Adding a section `<h2>` means the pick titles below it must **drop from `<h2>` to `<h3>`** so the outline nests correctly (h1 hero → h2 "Curator's Pick" → h3 each pick). Change the two title headings in `BoothNote.tsx`:
- `Pick` component title — L377 `<h2 …>` → `<h3 …>` (keep the same classes; only the tag changes).
- `ManualSlide` title — L475 `<h2 …>` → `<h3 …>`.
Leave `UpcomingList`'s `<h2>Upcoming</h2>` alone — it's a sibling section, correctly an h2. This keeps the page a clean h1 → h2 → h3 tree with no skipped level (the thing an accessibility pass flags).

### 3. Decide what happens to the per-slide eyebrow (Decision 2)
With a section header that already says **Curator's Pick**, each slide's eyebrow repeating `Curator's pick · Thursday` is saying it twice. Recommended: trim the eyebrow to the **date/context only** (`Thursday`, plus the `· this screening` qualifier that's already there for a singled-out night), and keep the `Featured · <day>` wording for the bare fallback item so it doesn't get mislabeled as a pick. Alternative: leave the eyebrow exactly as-is (the header and eyebrow are different type sizes, so the repetition is mild). Either is fine — this is a copy call, not a structural one.

## Decisions for Tom
1. **Header text:** `Curator's Pick` (recommended — matches your phrasing and the per-slide eyebrow) vs `Curator's Picks` (plural — matches the carousel's existing `aria-label="Curator's picks"`).
2. **Per-slide eyebrow:** trim to date-only now that the section is labeled (recommended) vs leave as-is.
3. **When nothing is actually picked** (the section falls back to the first upcoming item — `buildSlides` end, L588–590 — labeled `Featured`, not a real pick): still show the `Curator's Pick` header (recommended — the band is effectively the "what to see" shelf and one header keeps the page consistent) vs hide the header in that fallback case so it doesn't overclaim.

## Test plan
- The marquee-lights header appears centered above the curator's-pick band on the home page, in both the single-pick and multi-pick (carousel) states, matching the look of the admin "LISTINGS" header.
- The header is the **same component** as the dashboard's (`MarqueeFrame` + `marquee-frame--title`) — no duplicated markup or new CSS; changing the ring in `index.css` still updates every place at once.
- **Heading outline is clean:** hero `h1` → `Curator's Pick` `h2` → each pick title `h3`; no skipped levels (verify with an a11y/axe pass — `heading-order` passes). The ring stays `aria-hidden` and out of the reading order, so the accessible name of the section is just "Curator's Pick".
- Mobile: the header uses the narrower `--title` band and doesn't overflow the gutter at 375px; bulbs distribute evenly at container width on desktop.
- Per-slide eyebrow reflects Decision 2; the fallback `Featured` item is handled per Decision 3.
- `npm run build` + tests pass (BoothNote's existing tests still pass after the tag changes; add/adjust a test asserting the section header renders and the pick titles are `h3`).
