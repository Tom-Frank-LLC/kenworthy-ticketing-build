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
 * The page's one-line pitch. Doubles as the meta description — see the SEO
 * block on the page — so it has to read as a standalone sentence, not just as
 * a line under a heading.
 */
export const CONCESSIONS_BLURB =
  'Freshly-popped popcorn, your favorite candies, and an ice-cold beverage — in combo form or à la carte.';

/**
 * The concessions masthead — the stand on a show night, the line at the
 * counter and the usher in the red cap.
 *
 * Built to CalendarHero's pattern and for the same reason it gives: the same
 * `<picture>` with a webp/jpg pair at the same three widths, the same
 * `object-cover` fill, the same gold hairline, the same eager/high-priority
 * load, and the same 50/56vh band. This is a page people arrive at wanting a
 * price list, so the photograph introduces the page without pushing the menu
 * off the screen. The page's header — eyebrow, h1, blurb — moves in here so the
 * two mastheads carry their titles the same way.
 */
export function ConcessionsHero() {
  return (
    <section
      aria-label="Concessions at the Kenworthy"
      className="relative overflow-hidden border-b border-accent/25 bg-background min-h-[50vh] lg:min-h-[56vh] flex"
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
            // A little above centre, derived the same way CalendarHero derives
            // its 0%. `object-cover` scales this 4:3 photograph to the band's
            // width, so at 1280 it renders 960px tall into a ~448px box and
            // ~512px has to come off. The subject sits in the upper-middle
            // band — menu board, the usher, the counter — with a ceiling of
            // plain soffit above and the backs of the queue below. 35% takes
            // about a third of the trim off the top (the soffit) and the rest
            // off the bottom (the backs), which keeps the board readable and
            // the usher in frame at every width above `md`.
            style={{ objectPosition: 'center 35%' }}
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        {/* Bottom-weighted, like the calendar's. This photograph is bright
            where the calendar's is black, so the copy needs the heavier tint
            at the bottom to stay legible over the queue; the top keeps only
            enough to hold the glass header. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, hsl(var(--background) / 0.35) 0%, hsl(var(--background) / 0.1) 28%, hsl(var(--background) / 0.5) 62%, hsl(var(--background) / 0.86) 85%, hsl(var(--background) / 0.96) 100%)',
          }}
        />
      </div>

      {/* gold hairline at the very top, like a marquee filament */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

      {/* Bottom-aligned: `mt-auto` on the copy pushes it into the tinted band. */}
      <div className="container relative w-full flex flex-col py-8 sm:py-10 md:py-12">
        <div className="mt-auto max-w-2xl">
          <p className="font-display uppercase tracking-[0.3em] text-xs sm:text-sm text-accent drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
            At the stand
          </p>
          <h1 className="mt-2 font-display uppercase tracking-wide text-[1.75rem] sm:text-3xl md:text-4xl lg:text-5xl leading-[1] sm:leading-[0.95] text-foreground drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
            Concessions
          </h1>
          <p className="mt-3 font-serif italic text-foreground/90 text-sm sm:text-base max-w-lg drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            {CONCESSIONS_BLURB}
          </p>
        </div>
      </div>
    </section>
  );
}
