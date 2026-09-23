// Responsive variants of src/assets/concessions-counter.jpg (2000×1500, 520KB),
// cut to the same widths and the same webp+jpg pairing as the calendar, home
// and rentals heroes (docs/MOBILE-OPTIMIZATION.md: sips -Z, then cwebp -q 72).
// A phone pulls ~45KB instead of the full-res original. The archival master
// stays in src/assets/ and is not shipped to browsers.
import band768 from '@/assets/optimized/concessions-counter-768.jpg';
import band1280 from '@/assets/optimized/concessions-counter-1280.jpg';
import band1920 from '@/assets/optimized/concessions-counter-1920.jpg';
import band768Webp from '@/assets/optimized/concessions-counter-768.webp';
import band1280Webp from '@/assets/optimized/concessions-counter-1280.webp';
import band1920Webp from '@/assets/optimized/concessions-counter-1920.webp';

const webpSrcSet = `${band768Webp} 768w, ${band1280Webp} 1280w, ${band1920Webp} 1920w`;
const jpegSrcSet = `${band768} 768w, ${band1280} 1280w, ${band1920} 1920w`;

/**
 * The stand on a show night — the line at the counter and the usher in the
 * red cap — closing the concessions page under the menu.
 *
 * Built to CalendarHero's pattern: the same `<picture>` with a webp/jpg pair
 * at the same three widths, the same `object-cover` fill, the same gold
 * hairline, the same 50/56vh band. It sat at the top of the page first, as
 * the calendar's does, and was moved below the menu: this is a page people
 * arrive at wanting a price list, and the photograph reads better as the
 * reward for scrolling than as something to scroll past. The page keeps its
 * own centred header; this band carries no copy of its own, so the
 * photograph is the whole statement.
 *
 * Lazy where the heroes are eager. It is below the fold by definition, so a
 * high-priority fetch would compete with the menu for the connection.
 */
export function ConcessionsPhotoBand() {
  return (
    <section
      aria-label="The concessions stand on a show night"
      className="relative overflow-hidden border-t border-accent/25 bg-background min-h-[50vh] lg:min-h-[56vh]"
    >
      <picture>
        <source type="image/webp" srcSet={webpSrcSet} sizes="100vw" />
        <img
          src={band1280}
          srcSet={jpegSrcSet}
          sizes="100vw"
          alt="The concessions counter at the Kenworthy on a show night: the menu board and popcorn bags above the marble bar, an usher in a red cap and bow tie serving, and patrons waiting in line"
          className="absolute inset-0 h-full w-full object-cover"
          // A little above centre, derived rather than chosen. `object-cover`
          // scales this 4:3 photograph to the band's width, so at 1280 it
          // renders 960px tall into a ~448px box and ~512px has to come off.
          // The subject sits in the upper-middle band — menu board, the usher,
          // the counter — with plain soffit above and the backs of the queue
          // below. 35% takes about a third of the trim off the top and the
          // rest off the bottom, which keeps the board readable and the usher
          // in frame at every width above `md`.
          style={{ objectPosition: 'center 35%' }}
          loading="lazy"
          decoding="async"
        />
      </picture>
      {/* Tinted top and bottom only, and lightly: the band sits between the
          menu and the footer, so it fades in from the page above and out to
          the footer below, and the middle — where the subject is — stays
          clear. The calendar's gradient is bottom-heavy because copy sits
          there; nothing sits here. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, hsl(var(--background) / 0.7) 0%, hsl(var(--background) / 0.1) 22%, hsl(var(--background) / 0.1) 72%, hsl(var(--background) / 0.85) 100%)',
        }}
      />
      {/* gold hairline at the very top, like a marquee filament */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
    </section>
  );
}
