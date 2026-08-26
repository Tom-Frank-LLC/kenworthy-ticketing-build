import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarqueeBookingForm } from '@/components/rentals/MarqueeBookingForm';
import { MARQUEE_RATE } from '@/lib/rentalRates';

// Responsive variants of src/assets/marquee-cupid.jpg, cut to the same widths
// and the same webp+jpg pairing as the home hero (src/assets/optimized/hero-*).
// The archival master stays in src/assets/ and is not shipped to browsers.
import hero768 from '@/assets/optimized/marquee-cupid-768.jpg';
import hero1280 from '@/assets/optimized/marquee-cupid-1280.jpg';
import hero1920 from '@/assets/optimized/marquee-cupid-1920.jpg';
import hero768Webp from '@/assets/optimized/marquee-cupid-768.webp';
import hero1280Webp from '@/assets/optimized/marquee-cupid-1280.webp';
import hero1920Webp from '@/assets/optimized/marquee-cupid-1920.webp';

const webpSrcSet = `${hero768Webp} 768w, ${hero1280Webp} 1280w, ${hero1920Webp} 1920w`;
const jpegSrcSet = `${hero768} 768w, ${hero1280} 1280w, ${hero1920} 1920w`;

/**
 * The marquee pitch, over a photograph of the marquee doing the thing.
 *
 * "See your name in lights" used to be the last section on the page, under the
 * rates, the fees and the discounts — an easy sell buried below the hard one.
 * It is the cheapest thing the Kenworthy rents and the one with the widest
 * audience, so it leads now, and the hero image is a night the sign was doing
 * exactly what it is being sold for.
 *
 * The structure deliberately mirrors HomeMarquee: same `<picture>` with a
 * webp/jpg pair at the same three widths, same `object-cover` fill, same
 * top-and-bottom scrim, same min-heights. Matching it is the point — Tom asked
 * for the crop to match the home hero, and two heroes built two different ways
 * drift apart the first time either is touched.
 */
export function RentalsHero() {
  return (
    <section
      aria-label="Rent the Kenworthy marquee"
      className="relative overflow-hidden border-b border-accent/25 bg-background min-h-[68vh] lg:min-h-[78vh] flex"
    >
      <div className="absolute inset-0">
        <picture>
          <source type="image/webp" srcSet={webpSrcSet} sizes="100vw" />
          <img
            src={hero1280}
            srcSet={jpegSrcSet}
            sizes="100vw"
            alt="The Kenworthy marquee at night reading “I LOVE YOU” on one side and “I KNOW” on the other, above the hashtag KENWORTHYCUPID"
            className="h-full w-full object-cover"
            // The sign sits low in the frame, under the bare tree. Pulling the
            // crop below centre keeps both faces of the marquee — and the
            // message, which is the whole reason this photo is here — inside
            // the frame as the viewport gets shorter.
            style={{ objectPosition: 'center 62%' }}
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        {/* Darkness at the top and bottom, daylight across the middle band
            where the sign itself is. Same shape as the home hero's scrim. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, hsl(var(--background) / 0.72) 0%, hsl(var(--background) / 0.2) 24%, hsl(var(--background) / 0.05) 48%, hsl(var(--background) / 0.6) 78%, hsl(var(--background) / 0.94) 100%)',
          }}
        />
      </div>

      {/* gold hairline, like a marquee filament */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

      <div className="container relative w-full flex flex-col justify-between py-8 sm:py-10 md:py-12">
        <p className="font-display uppercase tracking-[0.3em] text-xs sm:text-sm text-accent flex items-center gap-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          Rent the Historic Theatre
        </p>

        <div className="mt-auto pt-32 sm:pt-40 md:pt-48 lg:pt-56 max-w-2xl">
          <h1 className="font-display uppercase text-[1.75rem] sm:text-3xl md:text-4xl lg:text-5xl leading-[1] sm:leading-[0.95] text-foreground break-words drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
            See your name
            <span className="block text-primary">in lights.</span>
          </h1>
          <p className="mt-3 font-serif italic text-foreground/90 text-sm sm:text-base max-w-lg drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
            For ${MARQUEE_RATE.price}, put a message on downtown Moscow's most-read sign — a
            birthday, a new arrival, a congratulations, or a question you only get to ask once.
            One side, one day.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <MarqueeBookingForm trigger={<Button size="lg">Book the marquee</Button>} />
            <Button asChild variant="outline" size="lg">
              <Link to="#availability">Rent the theatre</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
