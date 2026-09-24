// Responsive variants of src/assets/concessions-counter.jpg (2000×1500, 520KB),
// cut to the same widths and the same webp+jpg pairing as the calendar, home
// and rentals heroes (docs/MOBILE-OPTIMIZATION.md: sips -Z, then cwebp -q 72).
// A phone pulls ~45KB instead of the full-res original. The archival master
// stays in src/assets/ and is not shipped to browsers.
import hero768 from '@/assets/optimized/concessions-counter-768.jpg';
import hero1280 from '@/assets/optimized/concessions-counter-1280.jpg';
import hero1920 from '@/assets/optimized/concessions-counter-1920.jpg';
import hero768Webp from '@/assets/optimized/concessions-counter-768.webp';
import hero1280Webp from '@/assets/optimized/concessions-counter-1280.webp';
import hero1920Webp from '@/assets/optimized/concessions-counter-1920.webp';

const webpSrcSet = `${hero768Webp} 768w, ${hero1280Webp} 1280w, ${hero1920Webp} 1920w`;
const jpegSrcSet = `${hero768} 768w, ${hero1280} 1280w, ${hero1920} 1920w`;

/**
 * The concessions masthead — the stand on a show night, the line at the
 * counter and the usher in the red cap — with the page's header centred over
 * it.
 *
 * The photograph is carried the way CalendarHero carries its own: the same
 * `<picture>` with a webp/jpg pair at the same three widths, the same
 * `object-cover` fill, the same gold hairline, the same eager/high-priority
 * load, the same 50/56vh band. The copy is not the calendar's: that masthead
 * sets its title bottom-left, and this page's header was centred before the
 * photograph arrived and stays centred — same eyebrow, same `h1`, same blurb,
 * same tracking — so the page reads as itself with a picture behind it rather
 * than as a second calendar.
 *
 * Centred copy over a bright, busy photograph needs more help than
 * bottom-left copy over a dark one. The scrim is even across the band rather
 * than bottom-weighted, heavier than the calendar's, and the text keeps the
 * drop shadows the other mastheads use. The photograph reads through it; the
 * words read over it.
 */
export function ConcessionsHero({ blurb }: { blurb: string }) {
  return (
    <section
      aria-label="Concessions at the Kenworthy"
      /* Shorter than the calendar's band from `md` up — 40/45vh against its
         50/56vh — and the copy does not move. The copy box below keeps the
         calendar's 50/56vh and centres the header in it; its negative bottom
         margin pulls the section's bottom edge up by the difference, and
         `overflow-hidden` crops that strip off the photograph. So the header
         sits exactly where it sat in the taller band, and the menu starts
         ~20% sooner. Below `md` nothing is cropped: the text is taller there
         and the strip would cut into the blurb. */
      className="relative overflow-hidden border-b border-accent/25 bg-background min-h-[50vh] md:min-h-[40vh] lg:min-h-[45vh] flex"
    >
      <div className="absolute inset-0">
        <picture>
          <source type="image/webp" srcSet={webpSrcSet} sizes="100vw" />
          <img
            src={hero1280}
            srcSet={jpegSrcSet}
            sizes="100vw"
            alt="The concessions counter at the Kenworthy on a show night: the menu board and popcorn bags above the marble bar, an usher in a red cap and bow tie serving, and patrons waiting in line"
            className="h-full w-full object-cover"
            // A little above centre, derived rather than chosen. `object-cover`
            // scales this 4:3 photograph to the band's width, so at 1280 it
            // renders 960px tall into a ~448px box and ~512px has to come off.
            // The subject sits in the upper-middle band — menu board, the
            // usher, the counter — with plain soffit above and the backs of
            // the queue below. 35% takes about a third of the trim off the top
            // and the rest off the bottom, which keeps the board readable and
            // the usher in frame at every width above `md`.
            style={{ objectPosition: 'center 35%' }}
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, hsl(var(--background) / 0.55) 0%, hsl(var(--background) / 0.5) 40%, hsl(var(--background) / 0.55) 70%, hsl(var(--background) / 0.9) 100%)',
          }}
        />
      </div>

      {/* gold hairline at the very top, like a marquee filament */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

      {/* Centred both ways in a 50/56vh box: the page's own header, now inside
          the band. The box is taller than the section from `md` up — see the
          section for why — and overhangs its bottom edge by the negative
          margin. */}
      <div className="container relative w-full min-h-[50vh] lg:min-h-[56vh] md:-mb-[10vh] lg:-mb-[11vh] flex items-center justify-center py-10 sm:py-12 md:py-16">
        <header className="text-center">
          <p className="font-serif text-xs uppercase tracking-[0.3em] text-accent mb-3 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
            At the stand
          </p>
          <h1 className="font-display uppercase text-3xl md:text-5xl tracking-[0.1em] text-foreground drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
            Concessions
          </h1>
          <p className="font-serif italic text-lg text-foreground/90 max-w-md mx-auto mt-4 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            {blurb}
          </p>
        </header>
      </div>
    </section>
  );
}
