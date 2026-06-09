import { MapPin, Sparkles } from 'lucide-react';
import heroPhoto from '@/assets/home/kenworthy-relighting-marquee.jpg.asset.json';

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
        <img
          src={heroPhoto.url}
          alt="The Kenworthy marquee glowing on Main Street during the 2025 relighting ceremony"
          className="h-full w-full object-cover"
          style={{ objectPosition: 'center 75%' }}
          loading="eager"
          decoding="async"
        />
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

      <div className="container relative w-full flex flex-col justify-between py-8 sm:py-10 md:py-12">
        {/* Top eyebrow — small, sits in the upper scrim above the marquee */}
        <p className="font-display uppercase tracking-[0.3em] text-[10px] sm:text-[11px] text-accent flex items-center gap-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          Now Playing on Main Street
        </p>

        {/* Bottom — headline tucked into the dark crowd silhouettes, with
            the address balancing on the right. The marquee itself stays
            unobstructed in the middle band. */}
        <div className="mt-auto pt-32 sm:pt-40 md:pt-48 lg:pt-56 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl min-w-0">
            <h1 className="font-display uppercase text-[1.75rem] sm:text-3xl md:text-4xl lg:text-5xl leading-[1] sm:leading-[0.95] text-foreground break-words hyphens-auto drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
              A Century of Stories,
              <span className="block text-primary">Told One Screening at a Time.</span>
            </h1>
            <p className="mt-3 font-serif italic text-foreground/90 text-sm sm:text-base max-w-lg drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
              Independent film, live performance, and community gatherings inside
              Moscow's historic 1926 movie house.
            </p>
          </div>

          <p className="font-serif text-sm text-foreground/90 flex items-center gap-2 min-w-0 md:justify-end drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            <MapPin className="h-4 w-4 text-accent shrink-0" />
            <span className="break-words">508 S Main St · Moscow, ID</span>
          </p>
        </div>
      </div>
    </section>
  );
}
