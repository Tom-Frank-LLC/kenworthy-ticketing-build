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
 * The mechanics mirror HomeMarquee deliberately: same `<picture>` with a
 * webp/jpg pair at the same three widths, same `object-cover` fill, same
 * min-heights, same eager/high-priority load. Two heroes built two different
 * ways drift apart the first time either is touched.
 *
 * The composition is the mirror image of it, though, and has to be. The home
 * photograph puts the marquee high with dark crowd silhouettes underneath, so
 * its headline tucks into the bottom. This one puts the marquee low with blank
 * brick above, so the same bottom-aligned treatment lands the headline on top
 * of "I LOVE YOU" and buries the #KENWORTHYCUPID line — covering the exact
 * thing worth showing. Hence top-aligned copy and a top-weighted scrim: same
 * intent as the home hero (text on the quiet part, subject left alone), which
 * this photo happens to reach by turning the layout upside down.
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
            // Biased above centre, which pushes the sign *down* the frame:
            // object-position aligns the same percentage of image and box, so a
            // lower number keeps more of the brick at the top and sheds the
            // pavement at the bottom. That is the trade wanted here — the brick
            // is where the copy lives, and the buttons clear the marquee's top
            // edge because of it. Horizontally centred because on a phone the
            // frame narrows to the middle, where the K and both faces are.
            style={{ objectPosition: 'center 42%' }}
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        {/* Weighted to the top, unlike the home hero's, because this photo is
            composed the other way up: the copy sits over the blank brick in the
            upper half and the sign holds the lower half, so the darkness has to
            follow the text rather than bracket the image. It lifts off by
            halfway so the marquee itself is never veiled. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, hsl(var(--background) / 0.92) 0%, hsl(var(--background) / 0.8) 28%, hsl(var(--background) / 0.45) 46%, hsl(var(--background) / 0.12) 62%, hsl(var(--background) / 0.35) 88%, hsl(var(--background) / 0.8) 100%)',
          }}
        />
      </div>

      {/* gold hairline, like a marquee filament */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

      {/*
        Top-aligned, where the home hero is bottom-aligned. That is not a style
        choice: this photograph puts the marquee low and leaves blank brick
        above it, so text tucked into the bottom lands squarely on "I LOVE YOU"
        and buries the #KENWORTHYCUPID line — covering the exact thing the photo
        is here to show. The copy goes in the brick instead, and the sign is
        left to read.
      */}
      <div className="container relative w-full flex flex-col justify-start py-8 sm:py-10 md:py-12">
        <p className="font-display uppercase tracking-[0.3em] text-xs sm:text-sm text-accent flex items-center gap-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          Rent the Historic Theatre
        </p>

        {/* Held to roughly the upper half so it never reaches the sign. */}
        <div className="mt-4 sm:mt-6 max-w-xl">
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
