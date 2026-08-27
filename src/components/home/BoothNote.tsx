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
 */

/** Roughly the height of the Upcoming list beside it, so the two sections
 *  read as bands of the same weight rather than one dwarfing the other. A
 *  long note scrolls inside its slide instead of growing the band. */
const BAND = 'lg:h-[440px]';

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
      <Button asChild className={cn('h-11', GREEN_CTA)}>
        <Link to={`/showing/${item.showingId}`}>
          {/* A pick can be a free community night as easily as a paid one, and
              on those there is nothing to get. The slide still links through —
              the showing page is where the time and the venue are. */}
          {item.noTicketRequired ? 'Free · Details' : 'Get Tickets'}{' '}
          <ArrowRight className="h-4 w-4 ml-1" />
        </Link>
      </Button>
    ) : null;

  return (
    <>
      <p className="font-serif text-xs uppercase tracking-[0.25em] text-accent mb-5">
        {item.isFeatured || item.isFeaturedShowing ? "Curator's pick" : 'Featured'} ·{' '}
        {dayLabel(item.startTime)}
        {/* Said out loud only when the pick is a single night out of several.
            On a production pick the dates are listed in full below, so
            labelling it would be noise; on a film that only plays once there
            is no "this night rather than that one" to draw. */}
        {kind === 'showing' && (item.upcomingShowings?.length ?? 0) > 1 && (
          <span className="text-muted-foreground"> · this screening</span>
        )}
      </p>

      {/* Poster beside the copy, not above it — the same split ShowingPreview
          settled on, and for the same reason: stacked, the artwork can only be
          a wide band, and a one-sheet cropped to 16:10 is a strip of someone's
          chin. Stacks below `md`, where two columns would leave the poster too
          narrow to read.

          The button is its own cell under the poster rather than a child of
          the poster's, so that when the grid collapses to one column the three
          cells fall in reading order — artwork, what it is, then how to buy it
          — instead of offering a ticket before naming the film. The copy spans
          both rows, so a long curator's note grows downward past the button
          instead of pushing it away from the poster.

          The row sizes flip at `lg`. Below that the poster row is `auto` and
          the copy row takes the slack, which is what keeps a long note from
          inflating row 1 and leaving the button floating under the poster. At
          `lg` the band has a fixed height instead, so the poster row is the
          flexible one (`1fr`) and the button keeps only what it needs. */}
      <div
        className={cn(
          'grid gap-6',
          hasPoster &&
            'md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:grid-rows-[auto_1fr] md:gap-x-10 md:gap-y-4 md:items-start',
          hasPoster &&
            `lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_auto] lg:items-stretch ${BAND}`,
          !hasPoster && BAND,
        )}
      >
        {item.posterUrl && (
          <button
            type="button"
            onClick={() => onSelect?.(item)}
            aria-label={`Details for ${item.title}`}
            className="group block w-full max-w-[300px] md:max-w-none mx-auto md:mx-0 md:col-start-1 md:row-start-1 lg:h-full lg:min-h-0"
          >
            {/* `contain` on a muted plinth, not `cover`: the artwork is not
                reliably a one-sheet. Square and landscape promo graphics are
                common here, and cropping those to 2:3 cuts the title clean
                off. Inside the fixed band the frame stops being 2:3 and
                becomes whatever height is left — `contain` means the artwork
                still shows whole, just letterboxed on the plinth. */}
            <div className="relative overflow-hidden rounded-sm bg-muted lg:h-full">
              <img
                src={item.posterUrl}
                alt={item.title}
                loading="lazy"
                decoding="async"
                className="w-full aspect-[2/3] object-contain transition-transform duration-700 group-hover:scale-[1.02] lg:aspect-auto lg:h-full"
              />
            </div>
          </button>
        )}

        <div
          className={cn(
            'min-w-0 flex flex-col',
            hasPoster && 'md:col-start-2 md:row-start-1 md:row-span-2',
            'lg:min-h-0 lg:pr-6',
          )}
        >
          {/* h2: with the section's old "What we're watching this week"
              heading gone, this is the section's heading, and the marquee
              still owns the page's only h1. */}
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
          {hasNote && (
            // Scrolls rather than clamps, so a long note grows a scrollbar
            // instead of the band. tabIndex makes the region reachable by
            // keyboard — Chrome does not focus a scroll container on its own.
            //
            // Because it scrolls rather than clamps, the note renders as
            // formatted copy through the ticket page's own renderer: the
            // clamp is what forces a teaser to flatten, and there is none
            // here. The pick sits after the title's `</button>` above, so
            // this is body copy in the copy column, not markup nested in a
            // control.
            <div
              tabIndex={0}
              role="region"
              aria-label={`About ${item.title}`}
              className="themed-scroll min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <RichText
                html={item.curatorNote}
                className="font-serif italic text-foreground/80 leading-relaxed"
              />
            </div>
          )}
          {/* The rest of the run — the same chips the listing preview offers,
              and only on a production pick. A picked *showing* is a
              recommendation of one night; listing the others underneath would
              argue with it. */}
          {kind === 'production' && (
            <ShowtimeChips
              showings={item.upcomingShowings}
              excludeShowingId={item.showingId}
              headingId={`pick-also-playing-${item.id}`}
              className="mt-5 shrink-0"
            />
          )}

          {/* With no artwork there is no left column to sit under, so the
              button stays with the copy rather than claiming a cell of its
              own in a single-column grid. */}
          {!hasPoster && cta && <div className="mt-5 shrink-0">{cta}</div>}
        </div>

        {hasPoster && cta && (
          <div className="md:col-start-1 md:row-start-2 lg:self-end">{cta}</div>
        )}
      </div>
    </>
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

export function BoothNote({
  items,
  onSelect,
}: {
  items: FeedItem[];
  onSelect?: (item: FeedItem) => void;
}) {
  // Two independent flags feed this carousel, and a title may carry both.
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

  // Chronological across both kinds, so the carousel reads as a running order
  // rather than as two lists stapled together.
  const flagged = [...productionPicks, ...showingPicks].sort(
    (a, b) => new Date(a.item.startTime).getTime() - new Date(b.item.startTime).getTime(),
  );

  // Falls back to the first chronological item so the section never renders
  // empty. Unlike the old placement, nothing is removed from the calendar to
  // build this — the listing on /calendar shows every showing including these,
  // so a featured film is no longer missing from the page that exists to list
  // them all.
  const picks =
    flagged.length > 0
      ? flagged
      : items.slice(0, 1).map((item) => ({ item, kind: 'production' as const }));

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
          <Pick item={picks[0].item} kind={picks[0].kind} onSelect={onSelect} />
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
              {picks.map(({ item, kind }) => (
                // A film can appear twice — once for its run, once for a
                // singled-out night — so the key has to carry the kind.
                <CarouselItem key={`${kind}-${item.id}`}>
                  <Pick item={item} kind={kind} onSelect={onSelect} />
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
