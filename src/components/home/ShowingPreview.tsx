import { Link } from 'react-router-dom';
import { addDays } from 'date-fns';
import { PlayCircle, Ticket, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatShowtime, venueDayKey } from '@/lib/datetime';
import type { FeedItem } from './TrailerFeed';

/**
 * The inline preview panel that sits beside a list of showings.
 *
 * Extracted from UpcomingList so the Calendar page's desktop List view can
 * show the same thing. Both places had the same job — "you picked a row, here
 * is what it is and here is how to buy" — and the Calendar page was solving it
 * with a slide-out drawer instead, which is the wrong instrument when there is
 * a whole empty column to the right.
 *
 * `onViewDetails` is optional and that optionality is the contract: pass it
 * where a ProductionDetailDrawer exists to receive the click, omit it where
 * the preview *is* the detail view. When it is omitted the drawer-only actions
 * (View details, Watch trailer) simply aren't rendered rather than rendering
 * dead.
 */

function formatWhen(iso: string) {
  // "Tonight" has to mean tonight at the theatre. Comparing against the
  // viewer's own day would label a 7 PM Pacific show "Tomorrow" for anyone
  // whose clock has already crossed midnight.
  const day = venueDayKey(iso);
  const now = new Date();
  const time = formatShowtime(iso, 'h:mm a');
  if (day === venueDayKey(now)) return `Tonight · ${time}`;
  if (day === venueDayKey(addDays(now, 1))) return `Tomorrow · ${time}`;
  return formatShowtime(iso, 'EEE, MMM d · h:mm a');
}

export function ShowingPreview({
  item,
  onViewDetails,
  className,
}: {
  item: FeedItem;
  /** Opens the production drawer. Omit where no drawer is mounted. */
  onViewDetails?: (item: FeedItem) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="rounded-lg border border-accent/20 bg-card overflow-hidden">
        <div className="relative aspect-[16/10] bg-muted">
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              alt={item.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground font-serif italic">
              No artwork yet
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent pointer-events-none" />
          {item.isFeatured && (
            <Badge className="absolute top-3 left-3 bg-primary text-primary-foreground">
              Featured
            </Badge>
          )}
        </div>
        <div className="p-5 md:p-6">
          <p className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-2">
            {formatWhen(item.startTime)}
          </p>
          <h3 className="font-display text-2xl md:text-3xl uppercase tracking-wide leading-tight mb-3">
            {item.title}
          </h3>
          {item.curatorNote && (
            <p className="font-serif text-sm md:text-base text-muted-foreground line-clamp-5 mb-5">
              {item.curatorNote}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {/* Straight to the ticket page. Previously the only route out of
                this panel was the drawer, which then made the reader pick the
                showing a second time — for a preview of one specific showing
                that is a step with nothing in it. */}
            {item.showingId && (
              <Button asChild className="gap-2">
                <Link to={`/showing/${item.showingId}`}>
                  <Ticket className="h-4 w-4" />
                  Get Tickets
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
            {onViewDetails && (
              <Button
                variant={item.showingId ? 'outline' : 'default'}
                onClick={() => onViewDetails(item)}
                className="gap-2"
              >
                All showings
              </Button>
            )}
            {item.trailerUrl && onViewDetails && (
              <Button
                variant="outline"
                onClick={() => onViewDetails(item)}
                className="gap-2"
              >
                <PlayCircle className="h-4 w-4" />
                Watch trailer
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
