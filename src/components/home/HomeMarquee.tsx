import { Link } from 'react-router-dom';
import { MapPin, Sparkles } from 'lucide-react';

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
      className="relative border-b border-accent/25 bg-gradient-to-b from-card/60 via-background to-background"
    >
      {/* gold hairline at the very top, like a marquee filament */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

      <div className="container py-6 sm:py-8 md:py-10 lg:py-12">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl min-w-0">
            <p className="font-display uppercase tracking-[0.25em] sm:tracking-[0.3em] text-[10px] sm:text-[11px] text-accent flex items-center gap-2 flex-wrap">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              Now Playing on Main Street
            </p>
            <h1 className="mt-3 font-display uppercase text-[2rem] sm:text-4xl md:text-5xl lg:text-6xl leading-[1] sm:leading-[0.95] text-foreground break-words hyphens-auto">
              A Century of Stories,
              <span className="block text-primary">Told One Screening at a Time.</span>
            </h1>
            <p className="mt-4 font-serif italic text-muted-foreground text-sm sm:text-base md:text-lg max-w-xl">
              Independent film, live performance, and community gatherings inside
              Moscow's historic 1926 movie house.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-x-6 gap-y-2 md:justify-end md:text-right min-w-0">
            <p className="font-serif text-sm text-muted-foreground flex items-center gap-2 min-w-0">
              <MapPin className="h-4 w-4 text-accent shrink-0" />
              <span className="break-words">508 S Main St · Moscow, ID</span>
            </p>
            <Link
              to="/sponsors"
              className="font-display uppercase text-xs tracking-[0.25em] text-accent hover:text-primary transition-colors"
            >
              Our Sponsors →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
