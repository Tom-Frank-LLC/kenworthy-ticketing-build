---
brief: mobile-layout-pass
title: Port the type bump and rentals hero to phone widths
status: built
track: ux
severity: P2
date: 2026-08-28
verified: false
---

# Brief (for Claude Code): Mobile layout pass — port the recent desktop changes to small screens

**Status:** 🟡 Responsive cleanup. Several just-shipped desktop changes (the site-wide type bump #228, the rentals marquee hero #229) didn't get matching mobile treatment. Concrete breakages are listed; the rest is a directed audit at real phone widths.
**Date:** August 28, 2026
**Requested by:** Tom — another pass at mobile; some desktop adjustments haven't ported correctly. Evidence: home hero and rentals hero on an iPhone (screenshots).
**Baseline:** verified against `origin/main` @ `925dbab` (post #228 type bump, #229 rentals hero).

## Confirmed issues (with cause)
### 1. Rentals hero buttons wrap into unequal widths on mobile
`src/components/rentals/RentalsHero.tsx:160` — the button group is `flex flex-wrap gap-3 md:mt-0 md:flex-col md:flex-nowrap md:shrink-0` with the two buttons (`Book the marquee`, `Rent the theatre`) sized to their **content**. On mobile that's a wrapping row of two different-width buttons that stagger left-aligned (the screenshot). It only becomes a clean column at `md`.
- **Fix:** on mobile, stack them **full-width and equal**: e.g. `flex flex-col gap-3 md:flex-row-…` and give each button `w-full md:w-auto` (both the `MarqueeBookingForm` trigger button and the `Rent the theatre` link). Full-width stacked buttons are the standard mobile CTA pattern and make the two read as a pair.

### 2. Mobile header is overcrowded — the logo is squeezed to illegibility
`src/components/Layout.tsx` — signed-out header shows **both** `Tickets` (green) and `Film Pass` (outline) buttons at `h-10 px-4 sm:px-5` with **no mobile hiding**, plus the hamburger and the logo, all in a `h-[68px]`/`h-[84px]` bar. On a phone the two full buttons + hamburger leave the `KenworthyLogo size="header"` almost no room (the tiny logo in the screenshots).
- **Fix (Decision 1):** relieve the mobile pressure — e.g. move **Film Pass** into the mobile drawer / `Support` menu and keep only **Tickets** as the header CTA below `sm` (recommended); or shrink the buttons (smaller `px`, condensed labels) below `sm`; or a combination. Goal: the logo is legible and tappable on a 360–390px phone, with one clear primary CTA (Tickets).
- Confirm the `MobileNav` drawer already carries Film Pass / Donate / Calendar / Rentals so nothing is lost when trimmed from the bar.

### 3. Home hero on mobile after the type bump
`src/components/home/HomeMarquee.tsx` — heading is `text-[1.75rem] sm:text-3xl …` inside a `min-h-[61vh]` hero using a `contents`/`mt-auto` stacking trick on mobile. After #228's global type increase, verify on a phone: the headline isn't crowding the marquee, and the italic subcopy + address don't collide with the sign in the photo (the subcopy sits over the marquee text in the screenshot). Tune mobile heading size / `pt`/`mt` spacing and the scrim so the text stays legible over the image without overlapping the busy marquee band. **Decision 2:** nudge the mobile headline down a step and/or add spacing vs leave as-is if judged acceptable.

## Directed audit (the "did it port?" pass)
The recent desktop-focused work is the likely source of other mobile regressions. Check each at **360 / 375 / 390 / 414** (portrait) and 390 landscape:
- **Type bump (#228, "boxes grow too"):** the enlarged type + grown containers — verify nothing overflows, clips, or forces horizontal scroll on phones. Hot spots: the **month-calendar cells** (fixed `h-[112px]` on mobile with dot chips), **badges/pills** (e.g. the "Free · no ticket" pill in the calendar list), buttons with icons, and any element sized in **px** rather than rem (those didn't scale with the root).
- **Rentals overhaul (#229):** the availability calendar (`inline-block max-w-full overflow-x-auto` — confirm it scrolls, doesn't clip, and the day cells are tappable), the rate grid (should stack per-day on mobile, not crush 7 columns), and the hero image crop/framing on a tall narrow screen.
- **Live Events merge (#226) & admin dashboard:** the admin is used on phones — check the listing cards, inline showings, and any new per-item "Add Showing" controls don't overflow the card on mobile.
- **Curator carousel & search-in-header (home):** the carousel arrows/slides fit a phone; the search bar merged into the Upcoming header wraps cleanly and the "N matches"/clear affordance is reachable.
- **List-view preview sticky fix:** confirm the mobile List view (no split pane) is unaffected and the drawer path still opens for details.

## Method (so this doesn't recur)
- Fix mobile-first: default classes target the phone, `sm:`/`md:`/`lg:` add the desktop layout — several of these bugs are a desktop layout applied at `md:` with the mobile default left as an un-tuned fallback (the rentals buttons are exactly this shape).
- The page body must **never scroll horizontally**; wide content (calendar, rate grid) scrolls inside its own container.
- Keep tap targets ≥ ~44px; keep text over images legible (scrim/shadow), especially the two heroes.

## Decisions for Tom
1. Mobile header: move Film Pass to the drawer, keep Tickets only below `sm` (recommended) vs shrink both buttons.
2. Home hero mobile: nudge headline size/spacing down (recommended) vs leave.
3. Scope: fix the three confirmed issues now, plus the directed audit (recommended) vs only the three confirmed issues.

## Test plan
- Rentals hero: the two CTAs are **full-width, equal, stacked** on phones and side-by-side/column at `md`+ as designed.
- Header on a 360–390px phone: the logo is legible and tappable; one clear primary CTA; nothing overlaps; whatever is trimmed from the bar is present in the drawer.
- Home hero: headline and subcopy don't collide with the marquee band; legible over the image; no clipping in `min-h-[61vh]`.
- Across the recently-changed surfaces (type bump, rentals, live events, home carousel/search): no horizontal scroll, no clipped/overflowing text or controls at 360/375/390/414; calendar cells, rate grid, badges, and admin cards all hold.
- `npm run build` + tests pass.

---

## Outcome (2026-08-28)

Built, not deployed. Verified at 360/375/390/414 portrait and 844×390
landscape, at an 18px root, against `origin/main` @ `925dbab`.

### Method note — the viewport is not resizable, but an iframe is

`resize_window` does not change the driven Chrome tab's viewport (it is pinned
at 1280), so mobile layout cannot be checked by resizing. What does work is a
**same-origin iframe** sized to the device: media queries resolve against the
iframe, and same-origin lets the parent read `contentDocument` and measure.
`vh` also resolves against the iframe, so the iframe must be given a real
device *height* or every `vh`-sized hero is measured wrong — the home hero
looked fine at 1000px tall and collided at 800.

That browser profile's default font is 17.6px, not 16px, so `112.5%` yields
19.8px rather than the design's 18px. Every measurement below normalises the
root to 18px.

### The three confirmed issues

1. **Rentals hero CTAs** — fixed. `flex-wrap` below `md` made a ragged row of
   two content-width buttons; now a full-width equal stack (309/339/363px at
   360/390/414, 50px tall). `md`+ is unchanged.
2. **Header logo** — fixed. Measured, the logo art was rendering **28×7px** at
   360 and 58×15px at 390: the two CTAs plus the hamburger left it ~28px of the
   324px container, and `object-contain` turned the width shortage into a
   height cut. Film Pass now moves to the drawer below `sm` (it was already
   there, so nothing is lost) and Tickets takes `px-3`. The art now renders
   **153×41px** at 360 and a full 170×45 at 390/414.
3. **Home hero** — fixed. At 360×800 the italic tagline landed on the lit
   marquee. Cause: below `md` the photo scales to the band's *height*, so the
   sign renders roughly twice as large and reaches the foot of the band where
   the text sits. Headline steps down to `text-2xl` on phones, and the phone
   now gets its own scrim that darkens earlier (68% vs 80%) and harder.

### Two more bugs found by the audit, both fixed

- **`/rental-request` scrolled sideways at 360.** The submit row was a bare
  `justify-between`; the button inherits `whitespace-nowrap`, and its widest
  state ("Checking your browser…") could not fit beside the note or shrink, so
  the page went 16px wider than the viewport. Now stacked below `sm`.
- **The showing drawer cut off the price.** In `ProductionDetailDrawer`, a
  `justify-between` button held a full date plus a time plus a price badge with
  nothing able to wrap or shrink, so the `$8.00` badge — the thing a reader
  opens the drawer to find — was pushed past the drawer edge (dialog
  `scrollWidth` 393 vs `clientWidth` 344). Now 344 = 344.

### Checked and already correct

- `RateGrid` already renders per-band cards below `md`; the 7-column table is
  `hidden md:block`. No change needed.
- The month calendar holds: 42 cells, none clipped, no horizontal scroll. Its
  cells are `h-[6.25rem]`, i.e. **rem**, so they scaled with the type bump as
  intended — the brief's "fixed `h-[112px]`" was rendered pixels read back as a
  px literal, not a px value in the source. There are no px font sizes in the
  patron-facing app; the four in `src/` are an admin print receipt (deliberate,
  for paper) and three `text-[10px]` admin badges.
- Rentals availability calendar fits its wrapper (307 = 307) and does not clip.
- Curator carousel: viewport clips correctly, arrows are 49.5px and in view.
- No horizontal scroll on any of 9 routes × 4 widths.

### Known, not fixed

- **The `md` band (768–1023px) crushes the header, and this predates this
  work** — confirmed by measuring the unmodified baseline. `MobileNav` is
  `lg:hidden` while the desktop links appear at `md:`, so between those two
  breakpoints the bar carries the hamburger *and* Calendar/Theatre
  Rentals/Info/Support *and* both CTAs. It is over-subscribed by ~190px: the
  logo collapses to **0px** at 768 and renders 59×15 at 844 — which is 390
  landscape, inside this brief's own test matrix. No sizing tweak fixes it;
  something has to leave the bar, which is a navigation decision rather than a
  responsive fix. Recommended: move the four links from `md:` to `lg:`, which
  matches `MobileNav`'s own docstring ("hides itself once the desktop bar is
  complete (`lg`)") — the desktop bar is not in fact complete until `lg`.
- **Large text still crowds the phone header.** The logo's height is rem-based
  but the width available to it is capped by a fixed viewport, so raising the
  browser's default font makes the logo *smaller*: at a 20px default the art is
  back to ~28px tall. Better than before at every size, but not solved.
- **Admin on phones was not verified.** It needs a signed-in admin session, and
  a local dev server cannot hold one (localStorage does not cross origins).
  That needs a deployed branch.
- Calendar day cells are 40.5px, under the ~44px tap floor. They come from the
  shared `ui/calendar.tsx` primitive used by every date picker including admin,
  and widening them would push the rentals calendar into horizontal scroll —
  left alone deliberately.

### Checks

`tsc -p tsconfig.app.json --noEmit` clean · `vitest` 686 passed, 2 skipped, 54
files · `build:production` exit 0. No edge functions touched.
