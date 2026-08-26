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
      className="relative overflow-hidden border-b border-accent/25 bg-background min-h-[68vh] lg:min-h-[78vh] flex"
    >
      {/* Hero photograph — the 2025 marquee relighting on Main Street.
          object-position is tuned so the marquee sign sits roughly centered
          vertically (cropping the silhouetted tree canopy off the top). */}
      <div className="absolute inset-0">
        <picture>
          <source type="image/webp" srcSet={heroWebpSrcSet} sizes="100vw" />
          <img
            src={hero1280}
            srcSet={heroJpegSrcSet}
            sizes="100vw"
            alt="The Kenworthy marquee glowing on Main Street during the 2025 relighting ceremony"
            className="h-full w-full object-cover"
            style={{ objectPosition: 'center 92%' }}
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        {/* Scrim — keep the marquee itself clear by concentrating darkness
            at the top (above the sign) and bottom (over the crowd
            silhouettes where the headline lives). */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, hsl(var(--background) / 0.65) 0%, hsl(var(--background) / 0.15) 25%, hsl(var(--background) / 0.05) 50%, hsl(var(--background) / 0.55) 80%, hsl(var(--background) / 0.92) 100%)',
          }}
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
        <div className="contents md:mt-auto md:flex md:pt-48 lg:pt-56 md:flex-row md:gap-5 md:items-end md:justify-between">
          <div className="contents md:block md:max-w-xl lg:max-w-2xl md:min-w-0">
            <h1 className="font-display uppercase text-[1.75rem] sm:text-3xl md:text-4xl lg:text-5xl leading-[1] sm:leading-[0.95] text-foreground break-words hyphens-auto drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
              A Century of Stories,
              <span className="block text-primary">Shared One Showing at a Time.</span>
            </h1>
            <p className="mt-auto pt-8 md:mt-3 md:pt-0 font-serif italic text-foreground/90 text-sm sm:text-base max-w-lg drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
              Art-house classics to studio blockbusters, live performances and
              community gatherings all inside Moscow's historic 1926 theatre.
            </p>
          </div>

          <p className="mt-4 md:mt-0 font-serif text-sm text-foreground/90 flex items-center gap-2 min-w-0 md:justify-end drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            <MapPin className="h-4 w-4 text-accent shrink-0" />
            <span className="break-words">508 S Main St · Moscow, ID</span>
          </p>
        </div>
      </div>
    </section>
  );
}
