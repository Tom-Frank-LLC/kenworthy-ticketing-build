import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { cn } from '@/lib/utils';
import { GREEN_CTA } from '@/lib/greenCta';
import { formatShowtime } from '@/lib/datetime';
import { isPast } from '@/lib/purchasable';
import { isRichTextEmpty } from '@/lib/richText';
import { RichText } from '@/components/RichText';
import { dayLabel } from './EditorialCalendar';
import { ShowtimeChips } from './ShowtimeChips';
import type { FeedItem } from './TrailerFeed';
import {
  isInternalLink,
  orderSlides,
  slideAltText,
  type FeaturedSlideView,
} from '@/lib/featuredSlides';

/**
 * The showings the curator wants you to see, under the listing on the home
 * page.
 *
 * This used to live at the top of EditorialCalendar, which meant it rendered
 * on /calendar — where it stacked a second <h1> under that page's own title
 * and pushed the actual calendar below a full-width featured poster. The
 * calendar page is for finding a specific showing; the pick belongs on the
 * home page, under the listing, where it reads as a recommendation rather
 * than an obstacle.
 *
 * It used to show exactly one pick. Flagging a second film is_featured simply
 * hid it behind the first, so the flag silently did nothing past the earliest
 * item — every pick now gets a slide.
 *
 * Two sources feed it. The picks derived from the feed are the original one,
 * and everything in it sells a ticket. `featured_slides` is the second, and
 * nothing in it does: a slide is a picture, a headline and a link, written by
 * hand, so that a page with nothing to sell can be the thing pointed at. The
 * Silent Film Festival is the case that forced it — a real page at
 * /silent-film-festival with no showing anywhere behind it, previously
 * promotable only by inventing a fake showing and then hiding it from the
 * listings, the calendar and the box office.
 */

/** Roughly the height of the Upcoming list beside it, so the two sections
 *  read as bands of the same weight rather than one dwarfing the other. A
 *  long note scrolls inside its slide instead of growing the band. */
const BAND = 'lg:h-[440px]';

/**
 * The shape every slide is cut to: artwork on the left, copy on the right, and
 * the call to action in its own cell beneath the artwork.
 *
 * Shared rather than written twice. The two kinds of slide sit in one
 * carousel, and a reader flicking between them is entitled to see one system
 * rather than two layouts that nearly agree. What a pick and a hand-written
 * slide differ in is what they say and where the button points; what they do
 * not differ in is how the band is built, and a duplicated grid is exactly how
 * they would start to.
 *
 * Poster beside the copy, not above it — the same split ShowingPreview settled
 * on, and for the same reason: stacked, the artwork can only be a wide band,
 * and a one-sheet cropped to 16:10 is a strip of someone's chin. Stacks below
 * `md`, where two columns would leave the poster too narrow to read.
 *
 * The button is its own cell under the poster rather than a child of the
 * poster's, so that when the grid collapses to one column the three cells fall
 * in reading order — artwork, what it is, then how to act on it — instead of
 * offering a ticket before naming the film. The copy spans both rows, so a
 * long note grows downward past the button instead of pushing it away from the
 * poster.
 *
 * The row sizes flip at `lg`. Below that the artwork row is `auto` and the
 * copy row takes the slack, which is what keeps a long note from inflating
 * row 1 and leaving the button floating under the poster. At `lg` the band has
 * a fixed height instead, so the artwork row is the flexible one (`1fr`) and
 * the button keeps only what it needs.
 */
function SlideFrame({
  eyebrow,
  media,
  hasMedia,
  cta,
  children,
}: {
  eyebrow: ReactNode;
  /** The artwork cell, already wrapped in whatever control it deserves. */
  media: ReactNode;
  /** Whether `media` is really there — the whole grid changes shape without it. */
  hasMedia: boolean;
  cta: ReactNode;
  /** The copy column. */
  children: ReactNode;
}) {
  return (
    <>
      <p className="font-serif text-xs uppercase tracking-[0.25em] text-accent mb-5">
        {eyebrow}
      </p>

      <div
        className={cn(
          'grid gap-6',
          hasMedia &&
            'md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:grid-rows-[auto_1fr] md:gap-x-10 md:gap-y-4 md:items-start',
          hasMedia &&
            `lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_auto] lg:items-stretch ${BAND}`,
          !hasMedia && BAND,
        )}
      >
        {media}

        <div
          className={cn(
            'min-w-0 flex flex-col',
            hasMedia && 'md:col-start-2 md:row-start-1 md:row-span-2',
            'lg:min-h-0 lg:pr-6',
          )}
        >
          {children}

          {/* With no artwork there is no left column to sit under, so the
              button stays with the copy rather than claiming a cell of its own
              in a single-column grid. */}
          {!hasMedia && cta && <div className="mt-5 shrink-0">{cta}</div>}
        </div>

        {hasMedia && cta && (
          <div className="md:col-start-1 md:row-start-2 lg:self-end">{cta}</div>
        )}
      </div>
    </>
  );
}

/** The artwork cell's own classes, shared by the two things that fill it. */
const MEDIA_CELL =
  'group block w-full max-w-[300px] md:max-w-none mx-auto md:mx-0 md:col-start-1 md:row-start-1 lg:h-full lg:min-h-0';

/**
 * The picture on a slide.
 *
 * `contain` on a muted plinth, not `cover`: the artwork is not reliably a
 * one-sheet. Square and landscape promo graphics are common here, and cropping
 * those to 2:3 cuts the title clean off. Inside the fixed band the frame stops
 * being 2:3 and becomes whatever height is left — `contain` means the artwork
 * still shows whole, just letterboxed on the plinth.
 */
function SlideImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative overflow-hidden rounded-sm bg-muted lg:h-full">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="w-full aspect-[2/3] object-contain transition-transform duration-700 group-hover:scale-[1.02] lg:aspect-auto lg:h-full"
      />
    </div>
  );
}

/**
 * The prose on a slide — a curator's note, or a slide's blurb.
 *
 * Scrolls rather than clamps, so a long one grows a scrollbar instead of the
 * band. tabIndex makes the region reachable by keyboard; Chrome does not focus
 * a scroll container on its own.
 *
 * Because it scrolls rather than clamps, the copy renders formatted, through
 * the ticket page's own renderer: the clamp is what forces a teaser to
 * flatten, and there is none here. It sits in the copy column as body copy,
 * never nested inside a control — an `<a>` inside a `<button>` is invalid HTML
 * and browsers recover from it unpredictably.
 */
function SlideCopy({ label, html }: { label: string; html: string | null | undefined }) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label}
      className="themed-scroll min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <RichText html={html} className="font-serif italic text-foreground/80 leading-relaxed" />
    </div>
  );
}

/**
 * `production` — the title was picked, so the slide speaks for the whole run
 * and lists the other dates. `showing` — one night was picked, so it speaks
 * for that night only and stays silent about the rest.
 */
type PickKind = 'production' | 'showing';

function Pick({
  item,
  kind,
  onSelect,
}: {
  item: FeedItem;
  kind: PickKind;
  onSelect?: (item: FeedItem) => void;
}) {
  // On the text, not the string: an editor the author cleared out stores
  // `<p></p>`, which is truthy and would otherwise reserve the note's row in
  // the band for nothing.
  const hasNote = !isRichTextEmpty(item.curatorNote);
  const hasPoster = Boolean(item.posterUrl);

  // useFeed filters past showings out at query time, so this only bites in a
  // tab left open across a start time — which is the one case where the page
  // would otherwise sell a finished screening. The rule is
  // src/lib/purchasable.ts.
  const cta =
    item.showingId && !isPast({ start_time: item.startTime }) ? (
      // A pick that has since sold out is still worth showing — it is the
      // curator's note that earned the slot, and the date and venue are still
      // worth reading. What goes is the green button and the promise in it.
      <Button
        asChild
        variant={item.manuallySoldOut ? 'secondary' : 'default'}
        className={cn('h-11', !item.manuallySoldOut && GREEN_CTA)}
      >
        <Link to={`/showing/${item.showingId}`}>
          {/* A pick can be a free community night as easily as a paid one, and
              on those there is nothing to get. The slide still links through —
              the showing page is where the time and the venue are. */}
          {item.manuallySoldOut
            ? 'Sold Out'
            : item.noTicketRequired
              ? 'Free · Details'
              : 'Get Tickets'}{' '}
          <ArrowRight className="h-4 w-4 ml-1" />
        </Link>
      </Button>
    ) : null;

  return (
    <SlideFrame
      hasMedia={hasPoster}
      cta={cta}
      eyebrow={
        <>
          {item.isFeatured || item.isFeaturedShowing ? "Curator's pick" : 'Featured'} ·{' '}
          {dayLabel(item.startTime)}
          {/* Said out loud only when the pick is a single night out of several.
              On a production pick the dates are listed in full below, so
              labelling it would be noise; on a film that only plays once there
              is no "this night rather than that one" to draw. */}
          {kind === 'showing' && (item.upcomingShowings?.length ?? 0) > 1 && (
            <span className="text-muted-foreground"> · this screening</span>
          )}
        </>
      }
      media={
        item.posterUrl ? (
          <button
            type="button"
            onClick={() => onSelect?.(item)}
            aria-label={`Details for ${item.title}`}
            className={MEDIA_CELL}
          >
            <SlideImage src={item.posterUrl} alt={item.title} />
          </button>
        ) : null
      }
    >
      {/* h2: with the section's old "What we're watching this week" heading
          gone, this is the section's heading, and the marquee still owns the
          page's only h1. */}
      <h2 className="font-display text-3xl md:text-4xl leading-tight mb-2">
        <button
          type="button"
          onClick={() => onSelect?.(item)}
          className="text-left hover:text-primary transition-colors"
        >
          {item.title}
        </button>
      </h2>
      <p className="font-serif text-sm text-muted-foreground mb-3">
        {formatShowtime(item.startTime, "EEEE, MMMM d 'at' h:mm a")}
      </p>
      {hasNote && <SlideCopy label={`About ${item.title}`} html={item.curatorNote} />}
      {/* The rest of the run — the same chips the listing preview offers, and
          only on a production pick. A picked *showing* is a recommendation of
          one night; listing the others underneath would argue with it. */}
      {kind === 'production' && (
        <ShowtimeChips
          showings={item.upcomingShowings}
          excludeShowingId={item.showingId}
          headingId={`pick-also-playing-${item.id}`}
          className="mt-5 shrink-0"
        />
      )}
    </SlideFrame>
  );
}

/**
 * A slide somebody wrote, rather than one derived from a showing.
 *
 * Everything it says is in the row: the picture, the headline, the sentence,
 * and where the button goes. There is no production behind it, so there is no
 * drawer to open and no date to print — which is the point. It is how a page
 * that sells nothing gets into a band that otherwise only holds things that
 * do.
 *
 * The button is the ordinary primary one, not the green ticket CTA. Green is
 * scarcity on this site and `src/lib/greenCta.ts` lists every place it is
 * allowed to appear; a slide that links to a page is not a sale, and painting
 * its button green would spend that meaning on a page visit.
 */
function ManualSlide({ slide }: { slide: FeaturedSlideView }) {
  const internal = isInternalLink(slide.link_url);

  // An external link opens in a new tab: the reader came to the home page to
  // browse, and an outside promo is a detour rather than a destination. `rel`
  // carries noopener because the new tab would otherwise hold a handle on ours
  // through `window.opener`, and noreferrer so the destination is not told
  // which page sent them. An internal one goes through the router, or the SPA
  // reloads itself whole to move one page sideways.
  const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

  const label = (
    <>
      {slide.cta_label} <ArrowRight className="h-4 w-4 ml-1" />
    </>
  );

  const cta = (
    <Button asChild className="h-11">
      {internal ? (
        <Link to={slide.link_url}>{label}</Link>
      ) : (
        <a href={slide.link_url} {...external}>
          {label}
        </a>
      )}
    </Button>
  );

  // The picture is clickable, because a reader who has decided aims at the
  // artwork before the button. It is hidden from assistive technology and
  // taken out of the tab order rather than labelled: it goes exactly where the
  // button below it goes, and two stops at one destination is a tax on anyone
  // navigating by keyboard or by a list of links.
  const picture = slide.imageUrl ? (
    <SlideImage src={slide.imageUrl} alt={slideAltText(slide)} />
  ) : null;

  return (
    <SlideFrame
      hasMedia={picture !== null}
      cta={cta}
      eyebrow="Curator's pick"
      media={
        picture &&
        (internal ? (
          <Link to={slide.link_url} aria-hidden="true" tabIndex={-1} className={MEDIA_CELL}>
            {picture}
          </Link>
        ) : (
          <a href={slide.link_url} {...external} aria-hidden="true" tabIndex={-1} className={MEDIA_CELL}>
            {picture}
          </a>
        ))
      }
    >
      <h2 className="font-display text-3xl md:text-4xl leading-tight mb-3">{slide.title}</h2>
      {!isRichTextEmpty(slide.blurb) && (
        <SlideCopy label={`About ${slide.title}`} html={slide.blurb} />
      )}
    </SlideFrame>
  );
}

/** First sighting of each production wins; the feed is already date-sorted. */
function dedupeByProduction(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.type}:${i.productionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Which of the two components a slide is, kept in one place. */
function Slide({
  slide,
  onSelect,
}: {
  slide: CarouselSlide;
  onSelect?: (item: FeedItem) => void;
}) {
  return slide.source === 'manual' ? (
    <ManualSlide slide={slide.slide} />
  ) : (
    <Pick item={slide.item} kind={slide.kind} onSelect={onSelect} />
  );
}

/**
 * One slide, whichever of the two sources it came from.
 *
 * A discriminated union rather than a lowest-common-denominator object,
 * because the two are genuinely different things: a feed pick knows a
 * production, a date and a ticket, and a manual slide knows none of that and
 * knows a link instead. Flattening them into a shared `{image, title, blurb,
 * cta}` shape would mean building that shape from a FeedItem — reimplementing
 * the Get-Tickets rules, the past-showing guard and the run's other dates on
 * the way. What the carousel actually needs held in common is the *frame*, and
 * that is `SlideFrame`, not the data.
 */
export type CarouselSlide =
  | { source: 'manual'; key: string; slide: FeaturedSlideView }
  | { source: 'feed'; key: string; item: FeedItem; kind: PickKind };

/**
 * The running order of the band.
 *
 * Manual slides lead, in the admin's own `display_order`; the picks derived
 * from the feed follow, chronologically. Two orders rather than one merged
 * sort, and deliberately: a manual slide has no date to sort by — a festival
 * in November and a standing rentals promo are not points on the same line as
 * "Thursday at 7" — so any unified sort would have to invent a date for it,
 * and an invented date is a rule the admin cannot see. "Yours first, in the
 * order you gave; then what's on, soonest first" is a sentence they can hold
 * in their head, and it is the one that lets a festival promo lead the band on
 * the week it matters.
 *
 * The fallback is unchanged in spirit and narrower in fact: the first
 * chronological item, but only when *neither* source produced anything. A
 * hand-written slide is a deliberate choice, and stapling an unpicked film to
 * it to avoid a one-slide carousel would be second-guessing that.
 */
export function buildSlides(
  items: FeedItem[],
  slides: FeaturedSlideView[] = [],
): CarouselSlide[] {
  const manual: CarouselSlide[] = orderSlides(slides).map((slide) => ({
    source: 'manual',
    key: `manual-${slide.id}`,
    slide,
  }));

  // Two independent flags feed the other source, and a title may carry both.
  //
  // A picked *production* is one slide for the whole run. A FeedItem is a
  // showing (see the type), so a featured film playing four times arrives as
  // four items differing only by date; deduping keeps the first, and because
  // the feed is date-sorted that is the soonest — the one Get Tickets should
  // point at. The other dates are listed on the slide rather than thrown away.
  //
  // A picked *showing* is one slide for that night, and is not deduped: two
  // flagged nights of the same film are two deliberate picks, not a mistake.
  //
  // Both set on one title is not a conflict to resolve. It reads as "see this
  // film, and especially this night", so it produces both slides.
  const productionPicks = dedupeByProduction(items.filter((i) => i.isFeatured)).map(
    (item) => ({ item, kind: 'production' as const }),
  );
  const showingPicks = items
    .filter((i) => i.isFeaturedShowing)
    .map((item) => ({ item, kind: 'showing' as const }));

  // Chronological across both kinds, so this half reads as a running order
  // rather than as two lists stapled together.
  const flagged = [...productionPicks, ...showingPicks]
    .sort((a, b) => new Date(a.item.startTime).getTime() - new Date(b.item.startTime).getTime())
    // A film can appear twice — once for its run, once for a singled-out
    // night — so the key has to carry the kind as well as the item.
    .map(({ item, kind }): CarouselSlide => ({ source: 'feed', key: `${kind}-${item.id}`, item, kind }));

  if (manual.length > 0 || flagged.length > 0) return [...manual, ...flagged];

  // Nothing picked at all. Falls back to the first chronological item so the
  // section never renders empty. Unlike the old placement, nothing is removed
  // from the calendar to build this — the listing on /calendar shows every
  // showing including these, so a featured film is no longer missing from the
  // page that exists to list them all.
  return items
    .slice(0, 1)
    .map((item): CarouselSlide => ({ source: 'feed', key: `production-${item.id}`, item, kind: 'production' }));
}

export function BoothNote({
  items,
  slides = [],
  onSelect,
}: {
  items: FeedItem[];
  /**
   * The hand-written slides, already filtered to the ones the public may see.
   *
   * Optional, and empty by default: every caller that has nothing to add — the
   * tests, and any future page that wants the band without the manual source —
   * gets the old behaviour without saying so.
   */
  slides?: FeaturedSlideView[];
  onSelect?: (item: FeedItem) => void;
}) {
  const picks = buildSlides(items, slides);

  if (picks.length === 0) return null;

  const single = picks.length === 1;

  return (
    <section className="relative border-b border-accent/20 bg-background">
      {/* Full-bleed now, so the band needs its own edges.

          It darkens towards black rather than towards `--background`. Fading
          the edges to the background colour is the obvious way to write this
          and it paints nothing whatsoever — the band already *is* that colour.
          `--background` is 6% lightness, so black is the only direction with
          any room left in it.

          Darkening cannot cost text contrast here: every glyph in the band is
          light on dark, so a darker ground raises the ratio rather than
          lowering it. It also sits behind the content (the inner wrapper is
          `relative`), which keeps the poster and the green CTA at full
          strength while the empty margins carry the falloff. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 100% at 50% 50%, hsl(0 0% 0% / 0) 45%, hsl(0 0% 0% / 0.55) 100%)',
        }}
      />

      <div className="container relative py-10 md:py-14">
        {single ? (
          <Slide slide={picks[0]} onSelect={onSelect} />
        ) : (
          // No autoplay, so there is no motion the reader did not ask for and
          // nothing to gate on prefers-reduced-motion. The arrows clamp at the
          // ends rather than looping — a disabled Next is how the reader
          // learns there are three picks and they have seen all three.
          // `lg:px-16` opens a lane down each side for the arrows. Without
          // it they would sit on the poster, which starts at the container's
          // own gutter — there is no spare margin in a full-bleed band to
          // hang them in, which is also why the primitive's default
          // `-left-12` is wrong here: it parks them off the page.
          <Carousel
            opts={{ align: 'start', loop: false }}
            aria-label="Curator's picks"
            className="relative lg:px-16"
          >
            <CarouselContent>
              {picks.map((pick) => (
                <CarouselItem key={pick.key}>
                  <Slide slide={pick} onSelect={onSelect} />
                </CarouselItem>
              ))}
            </CarouselContent>

            {/* Two placements, one pair of buttons. From `lg` they are tall
                pills flanking the slide, where the band has a fixed height to
                centre them against. Below that they stay in this row: the
                slide is stacked and full-bleed there, so a centred side arrow
                would land on the copy rather than beside it — and touch has
                the swipe anyway. Going absolute at `lg` takes them out of
                this flex row, leaving the count behind. */}
            <div className="mt-6 flex items-center justify-end gap-3">
              <p className="font-serif text-sm text-muted-foreground">
                {picks.length} picks
              </p>
              <CarouselPrevious className="static translate-y-0 h-11 w-11 lg:absolute lg:left-0 lg:top-1/2 lg:-translate-y-1/2 lg:h-16 lg:w-11" />
              <CarouselNext className="static translate-y-0 h-11 w-11 lg:absolute lg:right-0 lg:top-1/2 lg:-translate-y-1/2 lg:h-16 lg:w-11" />
            </div>
          </Carousel>
        )}
      </div>
    </section>
  );
}
