import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarqueeBookingForm } from '@/components/rentals/MarqueeBookingForm';

// Responsive variants of src/assets/marquee-cupid-crop.jpg, cut to the same
// widths and the same webp+jpg pairing as the home hero
// (src/assets/optimized/hero-*). The archival master stays in src/assets/ and
// is not shipped to browsers, alongside the uncropped marquee-cupid.jpg this
// replaced — same photograph, framed wider.
import hero768 from '@/assets/optimized/marquee-cupid-crop-768.jpg';
import hero1280 from '@/assets/optimized/marquee-cupid-crop-1280.jpg';
import hero1920 from '@/assets/optimized/marquee-cupid-crop-1920.jpg';
import hero768Webp from '@/assets/optimized/marquee-cupid-crop-768.webp';
import hero1280Webp from '@/assets/optimized/marquee-cupid-crop-1280.webp';
import hero1920Webp from '@/assets/optimized/marquee-cupid-crop-1920.webp';

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
 * webp/jpg pair at the same three widths, same `object-cover` fill, the same
 * 61/70vh band, same eager/high-priority load. Two heroes built two different
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
      className="relative overflow-hidden border-b border-accent/25 bg-background min-h-[61vh] lg:min-h-[70vh] flex"
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
            // 0%, not the 42% this carried before the tighter crop and the
            // shorter band. object-position aligns the same percentage of image
            // and box, so 0 takes the entire overflow off the bottom and keeps
            // every pixel of brick at the top — and the brick is the only place
            // the copy can sit without covering the sign.
            //
            // Measured, because the old value was tuned for a wider frame in a
            // taller band and neither still holds. The sign's brightness starts
            // rising at ~40% of this crop, so the brick above it renders ~256px
            // tall at 1280 and ~286px at 1440, while the copy block needs ~336px.
            // No value can clear it at those widths; 0% simply loses the least,
            // and what it costs is the doors at the bottom, which are the least
            // of the photograph. From ~1600 up the brick outgrows the copy and
            // the block clears the sign outright.
            //
            // Horizontally centred because on a phone the frame narrows to the
            // middle, where the K and both faces are.
            style={{ objectPosition: 'center 0%' }}
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
      <div className="container relative w-full flex flex-col justify-start py-8 sm:py-9 md:py-10">
        <p className="font-display uppercase tracking-[0.3em] text-xs sm:text-sm text-accent flex items-center gap-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          Rent the Historic Theatre
        </p>

        {/* Held to roughly the upper half so it never reaches the sign.

            The buttons sit beside the copy rather than under it. Stacked, the
            block ran eyebrow → headline → paragraph → buttons, and that fourth
            row pushed the buttons down onto the marquee's top edge — they were
            landing on the lit bulbs and the "I LOVE YOU" panel, which is the
            part of the photograph the page is selling. Moving them into a
            second column ends the block a row earlier and leaves the sign
            alone. Below `md` they go back underneath, where a phone has the
            height for them and no width to spare.

            `items-start`, not `items-end`, and that is the part doing the work.
            Bottom-aligned, the buttons inherit the text column's full height and
            land exactly where they did before — at 1280 that put them back on
            the sign's top edge. Aligned to the top they finish level with the
            headline, roughly 30px clear of it, which is the whole point of
            moving them. The paragraph's last line still reaches the sign's left
            edge at that width; it is light italic over a drop shadow and reads,
            where a solid button did not. */}
        <div className="mt-3 sm:mt-5 flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
          {/* min-w-0 so this column yields before the buttons do: at `md` the
              container is narrower than max-w-xl on its own, and without it the
              text would hold its width and squeeze the buttons instead. */}
          <div className="max-w-xl min-w-0">
            <h1 className="font-display uppercase text-[1.75rem] sm:text-3xl md:text-4xl lg:text-5xl leading-[1] sm:leading-[0.95] text-foreground break-words drop-shadow-[0_4px_16px_rgba(0,0,0,0.95)]">
              See your name
              <span className="block text-primary">in lights.</span>
            </h1>
            <p className="mt-3 font-serif italic text-foreground/90 text-sm sm:text-base max-w-lg drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
              See your message on downtown Moscow's historic sign — a birthday, a
              congratulations, a proposal, or just something you really wanted to share.
            </p>
          </div>

          {/*
            Two doors, both real. The marquee opens its own form; renting the
            room goes to the full request form — the same destination as
            "Request a date" further down the page.

            This second button used to be `to="#availability"`, which did
            nothing at all: React Router does not scroll to a hash fragment, so
            it rewrote the URL and left the page where it was. A button that
            looks clickable and moves nothing is worse than no button, and
            pointing it at the form is the better answer anyway — someone who
            has decided to rent wants the form, not a calendar to read.
          */}
          <div className="flex flex-wrap gap-3 md:mt-0 md:flex-col md:flex-nowrap md:shrink-0">
            <MarqueeBookingForm trigger={<Button size="lg">Book the marquee</Button>} />
            <Button asChild variant="outline" size="lg">
              <Link to="/rental-request">Rent the theatre</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
