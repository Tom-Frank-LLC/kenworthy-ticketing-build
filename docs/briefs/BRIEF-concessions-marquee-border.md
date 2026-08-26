---
brief: concessions-marquee-border
title: Concessions moves off the home page to /concessions, framed in the marquee bulbs
status: shipped
track: ux
date: 2026-08-18
shipped_in: ["#186", "#188", "#189", "#190"]
shipped_at: 2026-08-26
verified: true
findings: FINDINGS-marquee-bulb-border.md
---

# Brief (for Claude Code): Move Concessions to its own page (under Info) with the marquee bulb border

**Status:** 🟢 New page + relocation + a visual border. The border asset is ready; the care items are the page move and keeping the bulbs round when responsive.
**Date:** August 18, 2026 · **updated** — scope changed from "border on the home section" to a **dedicated Concessions page**.
**Requested by:** Tom — move Concessions **off the home page** to its **own page under the Info nav**, and frame it with the theatre's marquee bulb border (from his `marquee.ai`).

## Part A — Move Concessions to its own page
1. **New page** `src/pages/Concessions.tsx`, route `/concessions` (lazy-loaded, mirroring `/about`, `/press` in `App.tsx`). It shows the full concessions menu (Items & Combos), reusing the existing `ConcessionsPreview` display logic — which already pulls live from `concession_items` so admin edits still flow through. Rename/relocate that component into the page (e.g. keep the rendering, drop the "preview" framing) rather than re-implementing the data fetch.
2. **Add to the Info nav.** Add `['Concessions', '/concessions']` to the `infoLinks` array in `Layout.tsx` (the Info dropdown: History, About Us, Press…), so it appears under **Info**. Confirm it shows in both the desktop dropdown and the mobile menu.
3. **Remove it from the home page.** Delete `<ConcessionsPreview />` from `Index.tsx:232` (and the now-unused import) so concessions no longer renders on the home page. Verify the home layout closes the gap cleanly.
4. Give the page a title/eyebrow and the site's standard page chrome (same layout wrapper as other Info pages); SEO/meta title "Concessions."

## Part B — The marquee border asset (delivered, corrected)
Regenerated from Tom's `marquee.ai` with **even bulb spacing, exact corners, and perfectly round bulbs** (the hasty original had uneven spacing). Three SVGs provided — pick per Decision 1:
- **`marquee-border-bulbs.svg`** — gold bulbs on a **transparent** band (just the ring). Best for the dark page: bulbs ring the content over the page background. **Recommended.**
- `marquee-border-site.svg` — gold bulbs on a dark band (`#141414`), gold `#D9A93F` (the site `--accent`).
- `marquee-border-faithful.svg` — the cleaned original (black band, cream bulbs).
Add the chosen file under `src/assets/` (or `public/`).

## Part C — Apply the border (keep the bulbs round)
Frame the concessions menu on the new page with the marquee border. **A fixed frame stretched to any size ovals the bulbs** — so use one of these (Decision 2):
- **A. `border-image` with `repeat: round`** (uses the SVG directly):
  ```css
  .concessions-frame{
    border: 40px solid transparent;                                   /* reserve the bulb band */
    border-image: url("/assets/marquee-border-bulbs.svg") 77 round;   /* slice ≈ band(60)+bulb; tune */
  }
  ```
  `round` fixes the corners and repeats the edge unit a whole number of times, so bulbs stay circular as the page/content resizes. **Recommended.**
- **B. CSS radial-gradient dot strips** (no image; the technique from the earlier concessions mockup) — guaranteed round at any size and recolorable via tokens (bulb = `--accent`); the SVG stays the visual spec.

Add inner padding so the menu content clears the bulb ring on all sides (more on mobile).

## Details
- **Decorative:** mark the border `aria-hidden` / no alt — ornamental; it must not affect the menu's reading order or contrast.
- Palette: gold bulbs match `--accent`; page uses the site dark theme + readability defaults.
- Redirect/tidy: if anything linked to the old home concessions anchor, point it at `/concessions`.
- **Optional flourish (Decision 3):** a subtle reduced-motion-aware "twinkle/chase" on the bulbs — off by default.

## Decisions for Tom
1. **Border variant:** bulbs-only transparent ring (recommended) vs dark-band vs faithful.
2. **Implementation:** `border-image: … round` from the SVG (recommended) vs CSS radial-gradient dots (themeable).
3. **Animation:** static (recommended) vs reduced-motion-aware twinkle.
4. **Reusable frame:** make the framed container a reusable component now (so silent-film-festival / backstage can use the same marquee frame later), or keep it concessions-only?

## Test plan
- **Concessions** appears under the **Info** nav (desktop + mobile) and opens `/concessions`; it **no longer** renders on the home page, and the home layout has no leftover gap.
- The page shows the live Items & Combos menu (admin edits still reflect) inside the marquee border; **bulbs are round and evenly spaced at 375 / 768 / 1280**, corners clean, no ovaling.
- Menu content clears the ring, stays readable, meets the readability/contrast targets; the border is hidden from assistive tech.
- Any old link to the home concessions section resolves to `/concessions`.
- If animation is enabled, it stops under `prefers-reduced-motion`.
- `npm run build` + tests pass.
