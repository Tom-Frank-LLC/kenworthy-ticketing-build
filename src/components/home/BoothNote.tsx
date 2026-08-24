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
 * The editorial voice of the site: a note from the projection booth and the
 * one showing the curator wants you to see.
 *
 * This used to live at the top of EditorialCalendar, which meant it rendered
 * on /calendar — where it stacked a second <h1> under that page's own title
 * and pushed the actual calendar below a full-width featured poster. The
 * calendar page is for finding a specific showing; the editorial pitch belongs
 * on the home page, under the listing, where it reads as a recommendation
 * rather than an obstacle.
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

  return (
    <section className="border-b border-accent/20 bg-background">
      <div className="container py-10 md:py-14">
        <div className="max-w-[640px] mx-auto">
          <div className="mb-10">
            <p className="font-serif text-xs uppercase tracking-[0.3em] text-accent mb-3">
              A note from the booth
            </p>
            {/* h2, not the h1 this markup carried on /calendar: the home page's
                marquee already owns the page's only h1. */}
            <h2 className="font-display text-4xl md:text-5xl leading-[0.95] mb-4">
              What we're watching this week
            </h2>
            <p className="font-serif text-muted-foreground">
              One screen, a hundred years of stories. Here's what's lighting up
              the marquee on Main Street.
            </p>
            <div className="marquee-rule mt-8" />
          </div>

          <article>
            <p className="font-serif text-xs uppercase tracking-[0.25em] text-accent mb-3">
              {featured.isFeatured ? "Curator's pick" : 'Featured'} · {dayLabel(featured.startTime)}
            </p>
            <button
              type="button"
              onClick={() => onSelect?.(featured)}
              className="text-left w-full group"
            >
              {featured.posterUrl && (
                <div className="relative aspect-[16/10] overflow-hidden rounded-sm mb-4 bg-secondary">
                  <img
                    src={featured.posterUrl}
                    alt={featured.title}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                </div>
              )}
              <h3 className="font-display text-3xl md:text-4xl leading-tight mb-2 group-hover:text-primary transition-colors">
                {featured.title}
              </h3>
              <p className="font-serif text-sm text-muted-foreground mb-2">
                {formatShowtime(featured.startTime, "EEEE, MMMM d 'at' h:mm a")}
              </p>
              {featured.curatorNote && (
                <p className="font-serif italic text-foreground/80 leading-relaxed">
                  {htmlToPlainText(featured.curatorNote)}
                </p>
              )}
            </button>
            {/* useFeed filters past showings out at query time, so this only
                bites in a tab left open across a start time — which is the one
                case where the page would otherwise sell a finished screening.
                The rule is src/lib/purchasable.ts. */}
            {featured.showingId && !isPast({ start_time: featured.startTime }) && (
              <div className="mt-4">
                <Button asChild className={cn('h-11', GREEN_CTA)}>
                  <Link to={`/showing/${featured.showingId}`}>
                    Get Tickets <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}
