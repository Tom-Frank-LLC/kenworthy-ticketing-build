import { MapPin } from 'lucide-react';
// Responsive variants of src/assets/KPACmarquee.jpg (3810×2542, 1.9MB). A
// phone now pulls ~38KB instead of the full-res original. The archival
// master stays in src/assets/ — it is just no longer shipped to browsers.
import hero768 from '@/assets/optimized/hero-768.jpg';
import hero1280 from '@/assets/optimized/hero-1280.jpg';
import hero1920 from '@/assets/optimized/hero-1920.jpg';
import hero768Webp from '@/assets/optimized/hero-768.webp';
import hero1280Webp from '@/assets/optimized/hero-1280.webp';
import hero1920Webp from '@/assets/optimized/hero-1920.webp';

const DESKTOP_SCRIM =
  'linear-gradient(180deg, hsl(var(--background) / 0.65) 0%, hsl(var(--background) / 0.15) 25%, hsl(var(--background) / 0.05) 50%, hsl(var(--background) / 0.55) 80%, hsl(var(--background) / 0.92) 100%)';

const MOBILE_SCRIM =
  'linear-gradient(180deg, hsl(var(--background) / 0.68) 0%, hsl(var(--background) / 0.18) 22%, hsl(var(--background) / 0.10) 42%, hsl(var(--background) / 0.74) 68%, hsl(var(--background) / 0.95) 100%)';

const heroWebpSrcSet = `${hero768Webp} 768w, ${hero1280Webp} 1280w, ${hero1920Webp} 1920w`;
const heroJpegSrcSet = `${hero768} 768w, ${hero1280} 1280w, ${hero1920} 1920w`;

/**
 * Full-width marquee header that sits above the three-column split-scroll.
 * Establishes the page as a true home page — masthead, a one-line pitch,
 * and quiet wayfinding to the deeper pages — before handing off to the
 * trailer feed / calendar / sidebar rails below.
 */
export function HomeMarquee() {
  return (
    <section
      aria-label="The Kenworthy — now playing"
      className="relative overflow-hidden border-b border-accent/25 bg-background min-h-[61vh] lg:min-h-[70vh] flex"
    >
      {/* Hero photograph — the 2025 marquee relighting on Main Street.
          object-position is tuned so the marquee sign sits roughly centered
          vertically (cropping the silhouetted tree canopy off the top).

          It has to move whenever the band's height does, and in the opposite
          direction to intuition. `object-cover` scales this image to the
          band's *width*, so the band's height only decides how much of the
          rendered image is cut — and the percentage decides which end loses
          it. Anchored near the bottom (the old 92%), shortening the band ate
          into the top and clipped the sign's own frame. 80% takes the trim off
          the bottom instead, which is what shortening the hero was for, and
          keeps the top framing the 78vh band had.

          Below `md` none of this applies: the band is taller than it is wide,
          so the image scales to the height and there is no vertical overflow
          left for the percentage to distribute.

          The *horizontal* percentage is the mirror image of that, and only
          does anything below `md` for the same reason. Scaling to the height
          makes the rendered photo wider than the band — about 382px of
          overflow on a 390px phone — and the X percentage decides which end
          of that gets cut.

          51.84% and not `center`, so the marquee's own lit "K" lands under the
          header's "K" instead of ~9px to its right.

          Derived rather than nudged. The sign is the only saturated green in a
          frame of red neon, so scanning for it finds it — but scanning the
          whole frame does not: a first pass put the centre at x=392.5 because
          it also caught green stage light spilling up the building, well above
          the sign. Restricted to the rows the sign actually occupies (y=248 to
          308, where the green extent is a consistent x=370..412), the centre
          is x=391 of the 768px-wide source. Solving `x·s − overflow·p = w/2`
          for p then gives 51.79–51.84% on every phone from 360x800 to 430x932
          — the geometry is nearly self-similar, so one number serves them all,
          and the 1.5px the first pass was out is now gone.

          Held to below `md` because that is what was asked for, but note it
          is not inert above it everywhere: a portrait tablet is still
          height-driven and would shift too. From `md` on a landscape row the
          photo scales to the width, overflow is zero, and the percentage has
          nothing to distribute either way. */}
      <div className="absolute inset-0">
        <picture>
          <source type="image/webp" srcSet={heroWebpSrcSet} sizes="100vw" />
          <img
            src={hero1280}
            srcSet={heroJpegSrcSet}
            sizes="100vw"
            alt="The Kenworthy marquee glowing on Main Street during the 2025 relighting ceremony"
            className="h-full w-full object-cover [object-position:51.84%_80%] md:[object-position:center_80%]"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        {/* Scrim — keep the marquee itself clear by concentrating darkness
            at the top (above the sign) and bottom (over the crowd
            silhouettes where the headline lives).

            Two of them, because the phone and the desktop row are not looking
            at the same crop. From `md` the band is wider than it is tall, so
            `object-cover` scales the photo to the *width* and the sign sits
            small in the middle with clear space beneath it. On a phone the
            band is taller than it is wide, the photo scales to the height
            instead, and the sign is rendered roughly twice the size — its lit
            face reaches all the way down into the foot of the band, which is
            exactly where the tagline and the address sit. Against 0.55 of
            background the white marquee letters still read through the text.

            So the phone gets its darkness earlier (68% rather than 80%) and
            heavier. The desktop gradient is unchanged. */}
        <div
          aria-hidden
          className="absolute inset-0 md:hidden"
          style={{ background: MOBILE_SCRIM }}
        />
        <div
          aria-hidden
          className="absolute inset-0 hidden md:block"
          style={{ background: DESKTOP_SCRIM }}
        />
      </div>

      {/* gold hairline at the very top, like a marquee filament */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

      <div className="container relative w-full flex flex-col py-8 sm:py-10 md:py-12">
        {/* From `md` up this is one row tucked into the dark crowd silhouettes
            at the foot: headline and tagline on the left, address balancing on
            the right, and the marquee left unobstructed in the middle band.

            A phone splits it. The headline keeps the top slot the "Now Playing
            on Main Street" eyebrow used to hold — the scrim is darkest there,
            above the sign, so it reads without covering anything. The tagline
            and the address do not: at the top they landed straight across the
            lit marquee and the address was unreadable against it. They drop to
            the foot instead, over the crowd silhouettes.

            Both wrappers below are `contents` on a phone, which dissolves their
            boxes so the three lines become direct children of this column and
            `mt-auto` on the tagline can push it and the address down. From `md`
            the wrappers come back (`md:flex`, `md:block`) and the original row
            is restored — one copy of each line, not a hidden duplicate. */}
        <div className="contents md:mt-auto md:flex md:pt-44 lg:pt-52 md:flex-row md:gap-5 md:items-end md:justify-between">
          <div className="contents md:block md:max-w-xl lg:max-w-2xl md:min-w-0">
            {/* 1.5rem on a phone, not 1.75rem — kept from when the site-wide
                type bump ran the second line to two lines at 360px. The line is
                shorter now, but the smaller step still reads better against the
                sign than the old size did. */}
            <h1 className="font-display uppercase text-2xl sm:text-3xl md:text-4xl lg:text-5xl leading-[1] sm:leading-[0.95] text-foreground break-words hyphens-auto drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
              A Century of Stories
              <span className="block text-primary">Shared on a Single Screen</span>
            </h1>
          </div>

          {/* `mt-auto` moved here from the tagline that used to sit above it.
              On a phone both wrappers are `contents`, so this is a direct child
              of the column and `mt-auto` is what holds it at the foot, over the
              crowd silhouettes. Without it the address rode up under the
              headline and sat across the lit marquee. */}
          <p className="mt-auto pt-8 md:mt-0 md:pt-0 font-serif text-sm text-foreground/90 flex items-center gap-2 min-w-0 md:justify-end drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            <MapPin className="h-4 w-4 text-accent shrink-0" />
            <span className="break-words">508 S Main St · Moscow, ID</span>
          </p>
        </div>
      </div>
    </section>
  );
}
