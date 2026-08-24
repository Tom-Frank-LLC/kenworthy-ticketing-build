import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GREEN_CTA } from '@/lib/greenCta';
import { formatShowtime } from '@/lib/datetime';
import { isPast } from '@/lib/purchasable';
import { htmlToPlainText } from '@/lib/richText';
import { dayLabel } from './EditorialCalendar';
import type { FeedItem } from './TrailerFeed';

/**
 * The one showing the curator wants you to see, under the listing on the home
 * page.
 *
 * This used to live at the top of EditorialCalendar, which meant it rendered
 * on /calendar — where it stacked a second <h1> under that page's own title
 * and pushed the actual calendar below a full-width featured poster. The
 * calendar page is for finding a specific showing; the pick belongs on the
 * home page, under the listing, where it reads as a recommendation rather
 * than an obstacle.
 */
export function BoothNote({
  items,
  onSelect,
}: {
  items: FeedItem[];
  onSelect?: (item: FeedItem) => void;
}) {
  // Curator-controlled pick: prefer the earliest item flagged is_featured,
  // falling back to the first chronological item so the section never renders
  // empty. Unlike the old placement, nothing is removed from the calendar to
  // build this — the listing on /calendar shows every showing including this
  // one, so a featured film is no longer missing from the page that exists to
  // list them all.
  const featured = items.find((i) => i.isFeatured) ?? items[0];

  if (!featured) return null;

  const note = featured.curatorNote ? htmlToPlainText(featured.curatorNote) : null;

  return (
    <section className="border-b border-accent/20 bg-background">
      <div className="container py-10 md:py-14">
        <div className="max-w-4xl mx-auto">
          <p className="font-serif text-xs uppercase tracking-[0.25em] text-accent mb-5">
            {featured.isFeatured ? "Curator's pick" : 'Featured'} · {dayLabel(featured.startTime)}
          </p>

          {/* Poster beside the copy, not above it — the same split
              ShowingPreview settled on, and for the same reason: stacked, the
              artwork can only be a wide band, and a one-sheet cropped to 16:10
              is a strip of someone's chin. Stacks below `md`, where two
              columns would leave the poster too narrow to read. */}
          <div
            className={cn(
              'grid gap-6 md:gap-10 md:items-start',
              featured.posterUrl && 'md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]',
            )}
          >
            {featured.posterUrl && (
              <button
                type="button"
                onClick={() => onSelect?.(featured)}
                aria-label={`Details for ${featured.title}`}
                className="group block w-full max-w-[300px] md:max-w-none mx-auto md:mx-0"
              >
                {/* `contain` on a muted plinth, not `cover`: the artwork is not
                    reliably a one-sheet. Square and landscape promo graphics
                    are common here, and cropping those to 2:3 cuts the title
                    clean off. */}
                <div className="relative overflow-hidden rounded-sm bg-muted">
                  <img
                    src={featured.posterUrl}
                    alt={featured.title}
                    loading="lazy"
                    decoding="async"
                    className="w-full aspect-[2/3] object-contain transition-transform duration-700 group-hover:scale-[1.02]"
                  />
                </div>
              </button>
            )}

            <div className="min-w-0">
              {/* h2: with the section's old "What we're watching this week"
                  heading gone, this is the section's heading, and the marquee
                  still owns the page's only h1. */}
              <h2 className="font-display text-3xl md:text-4xl leading-tight mb-2">
                <button
                  type="button"
                  onClick={() => onSelect?.(featured)}
                  className="text-left hover:text-primary transition-colors"
                >
                  {featured.title}
                </button>
              </h2>
              <p className="font-serif text-sm text-muted-foreground mb-3">
                {formatShowtime(featured.startTime, "EEEE, MMMM d 'at' h:mm a")}
              </p>
              {note && (
                <p className="font-serif italic text-foreground/80 leading-relaxed">
                  {note}
                </p>
              )}
              {/* useFeed filters past showings out at query time, so this only
                  bites in a tab left open across a start time — which is the one
                  case where the page would otherwise sell a finished screening.
                  The rule is src/lib/purchasable.ts. */}
              {featured.showingId && !isPast({ start_time: featured.startTime }) && (
                <div className="mt-5">
                  <Button asChild className={cn('h-11', GREEN_CTA)}>
                    <Link to={`/showing/${featured.showingId}`}>
                      Get Tickets <ArrowRight className="h-4 w-4 ml-1" />
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
