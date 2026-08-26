# The marquee bulb border: why it is CSS and not the SVG

**Date:** 2026-08-25 · **Brief:** `BRIEF-concessions-marquee-border.md`

The brief specified `border-image: url(marquee-border-bulbs.svg) 77 round` as the
recommended way to frame the concessions menu, on the reasoning that `round`
"fixes the corners and repeats the edge unit a whole number of times, so bulbs
stay circular as the page/content resizes."

That reasoning is wrong, and it fails visibly. This note records the measurement
so the next person does not re-derive it — or worse, ship it.

## What `round` actually does

`round` guarantees a **whole number of tiles**, not a **preserved aspect ratio**.
A border-image tile is scaled independently on its two axes:

- **across** the edge — to `border-width` ÷ the slice (here 40 ÷ 77 ≈ 0.52)
- **along** the edge — to whatever whole-number fit `round` lands on

Those two factors are unrelated and essentially never equal, so every bulb is
scaled more in one direction than the other. Circles become ellipses.

## Measured

Rendered at three container widths with the brief's exact CSS
(`border: 40px solid transparent; border-image: url(...) 77 round`):

- top and bottom bulbs came out visibly **wider than tall**
- the left and right runs collapsed into **vertical smears** — the side tile is
  squeezed to 52% across while being stretched to fit along, so the bulbs merge
  into stripes rather than reading as separate lamps
- the **corners broke**: a clipped crescent appeared beside the bottom-left
  corner, because the corner slice and the edge slice no longer agree

This is not a tuning problem. No value of the `77` slice or the `40px` border
width makes the two scale factors equal at every container size, because one of
them changes with the container and the other does not.

## What is used instead

Each bulb is a `radial-gradient` whose ending shape is an **absolute length**:

```css
background-image: radial-gradient(
  circle var(--mq-r) at center,
  var(--mq-bulb) calc(var(--mq-r) - 1px),
  transparent var(--mq-r)
);
```

An explicit `circle <length>` is independent of the box it is painted in, so the
bulb is round **by construction** at every size — there is no scale factor to get
wrong. Verified in the running app: the browser resolves this to
`radial-gradient(8.92px, ...)`, the same 8.92px radius on the horizontal and the
vertical runs.

Tiling is `background-repeat: space`, not `round`:

- **`space`** fits a whole number of tiles **at their natural size** and
  distributes the remainder into the gaps. Even spacing, flush at both ends, and
  the tile is never rescaled — which is the whole point, since rescaling is what
  ovals the bulb.
- **`round`** was tried here too and is the trap: it resizes the tile to force a
  fit, and as soon as the tile is narrower than a bulb the bulb is **clipped**.
  This showed up as half-moons at the top and bottom of the side runs — subtle
  enough to miss on a desktop screenshot, obvious at 375px.

Top and bottom runs span the full width and therefore own the corner bulbs; the
side runs are inset by one band so nothing double-draws.

## Status of the SVGs

`src/assets/marquee-border-bulbs.svg` is kept as the **visual spec** — it is what
the proportions were measured from (band 60, bulb r17, pitch 47 horizontal / 45
vertical) and it is the artefact to compare against if the ring is ever
restyled. It is not imported by any code. The other two variants
(`-site`, `-faithful`) differ only in the band fill and bulb colour; the CSS
version corresponds to `-bulbs` (transparent band), which was Decision 1.

## Reusability

The frame is `<MarqueeFrame>` (`src/components/MarqueeFrame.tsx`) over the
`.marquee-frame` class in `index.css`, so silent-film-festival or backstage can
adopt it without copying anything. The band is one custom property:

```jsx
<MarqueeFrame style={{ '--mq-band': '2.25rem' } as CSSProperties}>
```

The ring is ornamental: the one real DOM node it needs is `aria-hidden`, the rest
is pseudo-elements, so it contributes nothing to the reading order and imposes no
contrast requirement of its own.
