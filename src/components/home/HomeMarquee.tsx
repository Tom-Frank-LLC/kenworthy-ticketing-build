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
      className="relative overflow-hidden border-b border-accent/25 bg-background"
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
        {/* Dark scrim for legibility */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, hsl(var(--background) / 0.55) 0%, hsl(var(--background) / 0.35) 40%, hsl(var(--background) / 0.85) 100%)',
          }}
        />
      </div>

      {/* gold hairline at the very top, like a marquee filament */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

      <div className="container relative py-16 sm:py-24 md:py-32 lg:py-40">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl min-w-0">
            <p className="font-display uppercase tracking-[0.25em] sm:tracking-[0.3em] text-[10px] sm:text-[11px] text-accent flex items-center gap-2 flex-wrap drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              Now Playing on Main Street
            </p>
            <h1 className="mt-3 font-display uppercase text-[2rem] sm:text-4xl md:text-5xl lg:text-6xl leading-[1] sm:leading-[0.95] text-foreground break-words hyphens-auto drop-shadow-[0_4px_16px_rgba(0,0,0,0.9)]">
              A Century of Stories,
              <span className="block text-primary">Told One Screening at a Time.</span>
            </h1>
            <p className="mt-4 font-serif italic text-foreground/85 text-sm sm:text-base md:text-lg max-w-xl drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              Independent film, live performance, and community gatherings inside
              Moscow's historic 1926 movie house.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-6 gap-y-2 md:justify-end md:text-right min-w-0">
            <p className="font-serif text-sm text-foreground/85 flex items-center gap-2 min-w-0 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
              <MapPin className="h-4 w-4 text-accent shrink-0" />
              <span className="break-words">508 S Main St · Moscow, ID</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
