---
brief: ui-polish-hero-fonts-sticky
title: Shorter hero, larger site-wide type, and a preview pane that clears the nav
status: shipped
track: ux
date: 2026-08-28
shipped_in: ["#228", "#195"]
shipped_at: 2026-08-28
verified: true
---

# Brief (for Claude Code): UI/UX polish — shorter hero, larger site-wide type, fixed calendar preview pane

**Status:** ✅ Shipped.

- **Part A (hero height) was already done before this brief was picked up** — #195
  shortened it to `61vh`/`70vh` (~10%, the top of the range asked for here) and
  retuned `objectPosition` 92% → 80% because shortening the band was clipping the
  marquee sign. It was *not* re-applied: the brief warned against double-applying
  it, and trimming to 62/71 would have partly undone shipped work whose crop is
  calibrated to 61/70. The brief still described it as pending because the shared
  checkout was ~100 commits behind `origin/main`.
- **Parts B and C shipped in #228**, deployed to production 2026-08-28.

Two fixes beyond the brief were needed, both the same root cause — a **px box
holding rem content**, which cannot track the type inside it:

- `MonthCalendar` cells were `h-[112px]`/`h-[168px]` and cut the last event chip
  off mid-line. Now `6.25rem`/`9.375rem` (identical pixels at the old root), and
  the chip clamp follows the column width (`line-clamp-2 lg:line-clamp-3`) because
  at 768 the cells are only ~66px wide.
- The rentals day-picker sizes to its intrinsic rem width, which crossed a 375px
  viewport; as the first item in a grid whose item defaulted to `min-width: auto`,
  it took the availability table off-screen with it. Capped, and given `min-w-0`.

Verified at 375/768/1280 by measuring every clipped element at the new root, then
reverting the root to 112.5% in place and re-measuring — so the diff showed only
regressions the bump caused. No new clipping on any public page; `/rentals` at 375
and `/calendar` at 768 came out cleaner than before.
**Date:** August 28, 2026
**Requested by:** Tom — (1) trim ~5–10% off the top of the hero and let the page move up with it; (2) bump fonts site-wide so the site looks like the browser at 110%; (3) fix the calendar List view so the right-hand preview pane is frozen from the start instead of sliding under the nav and then freezing.

## Part A — Shorten the hero by ~5–10% (page moves up with it)
- **Where:** `src/components/home/HomeMarquee.tsx` — the hero section is `min-h-[68vh] lg:min-h-[78vh]`, with an absolute `<img object-cover>` (`objectPosition: 'center 92%'`).
- **Change:** reduce the section height ~5–10% (e.g. `min-h-[68vh] lg:min-h-[78vh]` → roughly `min-h-[62vh] lg:min-h-[71vh]`, tuned so the crop starts like Tom's screenshot). Everything below rises by that amount automatically (normal flow).
- Re-check `objectPosition` and the internal bottom spacing (`pt-32 … lg:pt-56`, headline block) so the marquee sign and headline stay framed and nothing clips — trimming the top framing, not the marquee.
- **Note:** this is the same change as `BRIEF-home-layout-search-carousel-preview.md` Part A — treat this as the authoritative amount (5–10%) and do it once; don't double-apply. **Decision 1:** confirm the exact % (recommend ~8%).

## Part B — Increase type site-wide to the "110%" look
- **Where:** `src/index.css:90` — `html { font-size: 112.5%; }` (18px at a 16px browser default). Line 97 sets `body { font-size: 1rem }` and the whole site is built in **rem/em**, so this root value is the single lever that scales all type proportionally.
- **Change:** multiply the root by ~1.10 to bake in the 110% appearance: `112.5% × 1.10 ≈ 123.75%` → set `html { font-size: 123.75%; }` (≈19.8px at a 16px default). **Decision 2:** exact target — `123.75%` (true 110%×current, recommended) vs a round `125%`.
- Because everything tracks rem, this is one change — but it's the kind of change that breaks tight layouts, so a regression pass is mandatory (below).
- **Watch items (grew-by-10% now):** the top **nav** (already runs out of room at `lg` per its own comment — it may wrap or need slightly tighter spacing/size), the **month-calendar cells** (fixed heights `h-[112px]/h-[168px]`, `line-clamp` titles — the known-fragile spot), **buttons and badges**, the **hero headline** (re-verify against Part A's new height), admin **card titles**, and anything sized in **px** rather than rem (those won't scale — grep for `px]`/`px;` in components and decide case by case). Pairs with `BRIEF-readability-font-size.md` — keep within those targets, this just raises the baseline.
- **Decision 3:** pure root bump (recommended, uniform) vs root bump with a couple of compensating tweaks where 10% overflows (nav, calendar cells).

## Part C — Freeze the Calendar List-view preview pane (stop it sliding under the nav)
- **The bug (verified):** on the `/calendar` **List** view (split layout), the right preview is `ShowingPreview … className="… sticky top-4 self-start"` (`Calendar.tsx` ~L134). `top-4` = **16px** from the viewport top, but the **header is `sticky top-0 z-50`** and taller than 16px (`Layout.tsx:94`). So as the list scrolls, the preview scrolls up with it, **slides partially under the nav**, and only then pins at 16px — exactly Tom's "goes under the nav then freezes."
- **The fix:** set the sticky offset to **clear the header** so the pane pins **just below the nav from the start** and never scrolls under it:
  - Change `top-4` to an offset equal to the header height + a small gap (e.g. `top-24`/`top-28`, or better a token/CSS var for the header height so the two can't drift). Measure the rendered header height at `lg` (the `sticky top-0 glass` header with `size="header"` buttons) and match it.
  - Result: the preview is effectively **frozen in place** as the list scrolls (standard `position: sticky` with `self-start` keeps it pinned until the grid/container bottom is reached — which is the "until the user reaches the bottom of the list" behavior Tom wants). No overlap with the nav, no initial upward drift under it.
- Keep `self-start` (so it pins to its own top, not stretch) and `min-w-0`. Verify the grid parent (`grid-cols-[1fr_1.6fr] items-start`) still lets the sticky work — `items-start` is already correct; don't switch to `items-stretch` (that defeats sticky).
- **Decision 4:** a hard-coded `top-24`-ish value (fast) vs introducing a `--header-height` CSS variable the header sets and the sticky consumes (cleaner, prevents future drift) — recommend the variable.
- Re-verify the same sticky offset on any other split preview that pins near the nav (e.g. the home Upcoming preview `sticky top-4` in `UpcomingList.tsx`, and `ShowingPreview` usages) so they all clear the header consistently.

## Cross-cutting
- After Parts A + B, do the visual-regression pass together at **375 / 768 / 1280** (the hero, nav, buttons, cards, admin card titles, and calendar cells) — the two changes interact (a shorter hero with bigger headline type).
- Respect the existing readability targets; don't regress contrast.
- No data/schema changes anywhere here.

## Decisions for Tom
1. Hero trim exact %: ~8% (recommended) within the 5–10% range.
2. Root font target: `123.75%` (true 110% of current, recommended) vs `125%`.
3. Font rollout: pure root bump (recommended) vs bump + targeted nav/calendar compensations.
4. Sticky offset: a `--header-height` variable (recommended) vs a fixed `top-24`.

## Test plan
- Hero is ~5–10% shorter and starts like the screenshot; marquee/headline unclipped at 375/768/1280; the sections below sit higher.
- Type across the site renders ~10% larger (matching the browser-110% look); nav, buttons, cards, hero headline, admin titles, and **calendar cells** show no overflow/clipping/ugly wraps; px-sized elements audited.
- On `/calendar` List view, the preview pane **stays fixed below the nav from the first scroll**, never sliding under the header, and remains pinned until the bottom of the list; the home Upcoming preview behaves the same.
- Mobile List view (no split) unaffected; month view unaffected.
- `npm run build` + tests pass.
