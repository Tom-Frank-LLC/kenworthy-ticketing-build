// Responsive variants of src/assets/theatre-in-blue.jpg (2370×1306, 1.1MB),
// cut to the same widths and the same webp+jpg pairing as the home and rentals
// heroes. A phone pulls ~20KB instead of the full-res original. The archival
// master stays in src/assets/ and is not shipped to browsers.
import hero768 from '@/assets/optimized/theatre-in-blue-768.jpg';
import hero1280 from '@/assets/optimized/theatre-in-blue-1280.jpg';
import hero1920 from '@/assets/optimized/theatre-in-blue-1920.jpg';
import hero768Webp from '@/assets/optimized/theatre-in-blue-768.webp';
import hero1280Webp from '@/assets/optimized/theatre-in-blue-1280.webp';
import hero1920Webp from '@/assets/optimized/theatre-in-blue-1920.webp';

const webpSrcSet = `${hero768Webp} 768w, ${hero1280Webp} 1280w, ${hero1920Webp} 1920w`;
const jpegSrcSet = `${hero768} 768w, ${hero1280} 1280w, ${hero1920} 1920w`;

/**
 * The calendar's masthead — a full house, lit only by the screen.
 *
 * The mechanics mirror HomeMarquee and RentalsHero deliberately: the same
 * `<picture>` with a webp/jpg pair at the same three widths, the same
 * `object-cover` fill, the same gold hairline, the same eager/high-priority
 * load. Three heroes built three different ways drift apart the first time any
 * one of them is touched.
 *
 * The band is shorter than either of those, and that is the point. Home and
 * rentals are pitches, where the photograph *is* the content and earns 70–78vh.
 * This is a page people arrive at already knowing what they want — a list of
 * showings to scan — so the image introduces the page without pushing the first
 * showing off the screen. 50/56vh keeps the view toggle and the top of the
 * listing within reach of the fold on a laptop.
 */
export function CalendarHero() {
  return (
    <section
      aria-label="What's on at the Kenworthy"
      className="relative overflow-hidden border-b border-accent/25 bg-background min-h-[50vh] lg:min-h-[56vh] flex"
    >
      <div className="absolute inset-0">
        <picture>
          <source type="image/webp" srcSet={webpSrcSet} sizes="100vw" />
          <img
            src={hero1280}
            srcSet={jpegSrcSet}
            sizes="100vw"
            alt="A full house at the Kenworthy seen from the balcony, the audience in silhouette and the screen lit at the front"
            className="h-full w-full object-cover"
            // Anchored hard to the top, which is unusual here and is derived
            // rather than chosen. `object-cover` scales this image to the band's
            // *width*, so at 1280 it renders ~705px tall into a ~448px box and
            // ~257px has to come off somewhere. The screen — the one lit thing
            // in an otherwise black photograph, and the reason the shot works —
            // is already cut off by the top edge of the original, so any crop
            // taken from the top eats the screen first. 0% takes the whole trim
            // off the bottom instead, where it costs only the nearest rows of
            // silhouettes.
            //
            // Below `md` this stops applying: the band is taller than the image
            // is proportionally deep, so the image scales to the *height*, there
            // is no vertical overflow left to distribute, and the crop moves to
            // the sides — where `center` keeps the screen and the aisle.
            style={{ objectPosition: 'center 0%' }}
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        {/* Bottom-weighted, like the home hero and unlike the rentals one,
            because this photograph is composed the same way up as the home
            shot: the bright subject sits high and the dark mass of the audience
            fills the bottom, which is exactly where the copy can sit without
            covering anything. The top stays nearly clear so the screen is not
            veiled — only enough tint to keep the glass header legible over it. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, hsl(var(--background) / 0.3) 0%, hsl(var(--background) / 0.08) 28%, hsl(var(--background) / 0.4) 62%, hsl(var(--background) / 0.82) 85%, hsl(var(--background) / 0.95) 100%)',
          }}
        />
      </div>

      {/* gold hairline at the very top, like a marquee filament */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

      {/* Bottom-aligned: `mt-auto` on the copy pushes it into the dark seats. */}
      <div className="container relative w-full flex flex-col py-8 sm:py-10 md:py-12">
        <div className="mt-auto max-w-2xl">
          <p className="font-display uppercase tracking-[0.3em] text-xs sm:text-sm text-accent drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
            What's on the
          </p>
          <h1 className="mt-2 font-display uppercase tracking-wide text-[1.75rem] sm:text-3xl md:text-4xl lg:text-5xl leading-[1] sm:leading-[0.95] text-foreground drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
            Calendar
          </h1>
          <p className="mt-3 font-serif italic text-foreground/90 text-sm sm:text-base max-w-lg drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            Search for a title, or use the calendar view to see what's playing.
          </p>
        </div>
      </div>
    </section>
  );
}
