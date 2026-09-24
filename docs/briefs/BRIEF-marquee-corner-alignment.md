---
brief: marquee-corner-alignment
title: The marquee ring's side columns sit directly under the top and bottom runs' corner bulbs, at every weight
status: built
track: ux
severity: P3
date: 2026-09-24
verified: false
---

# Brief (for Claude Code): Fix the marquee-lights corner alignment

**Status:** 🟢 Small, self-contained CSS fix in one place (`.marquee-frame` in `src/index.css`). The corners are misaligned by a **deterministic geometry mismatch**, not a rounding fluke — which is why Tom sees it "consistently" on every corner. The fix is to make the horizontal runs' end bulbs land on the same centerline the vertical runs use.
**Date:** September 24, 2026
**Requested by:** Tom — the corners of the marquee-lights element are consistently out of alignment.

## Root cause (verified, build `7451fbd`)
The ring is four runs of bulbs drawn with CSS pseudo-elements on `.marquee-frame` (`src/index.css:503–551`). Each bulb is a radial-gradient **centered in a tile** of length `--mq-gap`, tiled with `background-repeat: space` (first and last tile flush to the box edges). The two axes use **different corner conventions**, and that is the bug:

- **Top & bottom runs** (`::before`/`::after`, L530–539): span the **full width** (`left:0; right:0`). With `space`, the terminal bulb's center lands at **`--mq-gap/2` from the edge** (the circle is centered in its first tile). Vertically the bulb is centered in the band, at `--mq-band/2` from the top/bottom.
- **Side runs** (`.marquee-frame__sides::before/::after`, L542–551): **inset by `--mq-band`** top and bottom, width `--mq-band`, so the column of bulbs is centered at **`--mq-band/2` from the side edge**.

So at each corner the horizontal run's end bulb sits at x = `--mq-gap/2` from the edge, but the vertical column sits at x = `--mq-band/2`. With the current ratios (`--mq-gap = 0.783·band`, so `--mq-gap/2 = 0.392·band` vs `--mq-band/2 = 0.5·band`), **the vertical column is pulled ~0.11·band inboard of the horizontal run's corner bulb** — a small, constant offset that repeats identically on all four corners (and mirrors, so it reads as the whole ring being "off"). That is exactly the misalignment in the screenshot: the side bulbs don't sit directly under/over the end of the top/bottom run.

In short: **top/bottom put their end bulb at `gap/2`; the sides expect it at `band/2`. The two conventions disagree on where the corner is.**

## The fix (recommended — one declaration, keeps the glow)
Make the top/bottom runs' terminal bulbs land at `--mq-band/2` from the edge, so they sit exactly on the vertical columns' centerline (and on the crossing of the two band centerlines — the true corner point). Inset each end of the top/bottom runs by `(--mq-band − --mq-gap)/2`:

```css
.marquee-frame::before,
.marquee-frame::after {
  /* was: left: 0; right: 0; */
  left: calc((var(--mq-band) - var(--mq-gap)) / 2);
  right: calc((var(--mq-band) - var(--mq-gap)) / 2);
  height: var(--mq-band);
  background-size: var(--mq-gap) 100%;
  background-repeat: space no-repeat;
}
```

Why this is correct, in the same tokens the ring is already built from: with inset `k = (band − gap)/2`, the first bulb center is `k + gap/2 = band/2` and the last is `width − band/2`. Both terminal bulbs now sit at `band/2` from the edge — **collinear with the side columns** — and land precisely where the top/bottom band centerline crosses the side band centerline. The corner bulb becomes a clean elbow both runs radiate from, instead of a bulb the vertical column misses. Everything stays inside the existing filtered pseudo-elements, so the halo/glow is untouched, and because it's expressed in `--mq-band`/`--mq-gap` it holds for the **panel** weight (Concessions), the **`--title`** weight (dashboard header / curator header), and the **mobile** band automatically.

The side runs keep their `--mq-band` top/bottom inset — they still yield to the corner bulb, which is the existing "corners included on the top/bottom run" intent (L529, L541); this fix just moves that corner bulb to where the sides were always aiming.

## Decisions for Tom
1. **Approach:** realign the top/bottom terminal bulbs to `band/2` (recommended — one line, no new elements, halo preserved) vs. the heavier alternative of pinning four explicit corner bulbs and insetting all four runs by `--mq-band` between them (more "correct" as a concept but adds a 4-dot background layer that can't easily carry the per-bulb `drop-shadow` glow, so the corners would read slightly flatter than the runs). Recommend the first.
2. **Optional polish (only if a corner still reads slightly loose after the fix):** the elbow gap from the corner bulb to the first side bulb is `band/2 + gap/2`; if that reads uneven against the mid-run pitch that `space` produces at a given width, nudge the side runs' `top`/`bottom` inset a touch or tune the corner allowance. Not expected to be needed — the visible defect is the sideways offset, which the fix removes entirely. Leave as-is unless it looks off in review.

## Test plan
- At the three weights/sizes, eyeball all four corners: the vertical columns line up directly under/over the horizontal runs' end bulbs, and each corner reads as a clean right angle — **desktop panel** (Concessions menu border), **`--title` strip** (admin dashboard section header, and the curator's-pick header if that brief has shipped), and the **≤767px mobile** band.
- The offset is gone on **all four** corners symmetrically (it was consistent, so confirm top-left, top-right, bottom-left, bottom-right all resolve).
- The bulb **glow/halo** is unchanged (still two-pass `drop-shadow`); bulb size, pitch, and the content inset (`--mq-inset`) are unchanged; the ring is still `aria-hidden` and adds no layout shift.
- No horizontal overflow or clipped edge bulbs at narrow widths (the new inset pulls the end bulbs slightly inward, which if anything reduces edge clipping).
- `npm run build` passes; no snapshot/visual test references the old `left:0/right:0` values (search `marquee` in tests).
