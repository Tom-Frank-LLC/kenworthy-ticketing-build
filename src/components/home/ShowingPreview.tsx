import { Link } from 'react-router-dom';
import { addDays } from 'date-fns';
import { PlayCircle, Ticket, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { GREEN_CTA } from '@/lib/greenCta';
import { formatShowtime, venueDayKey } from '@/lib/datetime';
import { isPast } from '@/lib/purchasable';
import type { FeedItem } from './TrailerFeed';
import { htmlToPlainText } from '@/lib/richText';

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
        {/* Poster beside the text, not above it. Stacked, the artwork could
            only be a wide band, and a one-sheet cropped to 16:10 is a strip of
            someone's chin. A portrait column shows the poster as designed and
            gives the synopsis a tall neighbour to fill.

            This pane only ever renders at `lg` and up (both callers gate it),
            so the split needs no breakpoint of its own. */}
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* The cell stretches even though the poster inside it doesn't, so a
              long synopsis leaves a clean muted plinth under the artwork
              rather than a ragged card corner. */}
          <div className="relative bg-muted">
            {item.posterUrl ? (
              // `contain`, not `cover`: the artwork is not reliably a
              // one-sheet. Plenty of listings use square or landscape promo
              // graphics, and cropping those to 2:3 cuts the title clean off
              // (Farmers Market Cartoons loses the word "CARTOONS"). Same
              // intent as ProductionMedia's `aspect='auto'` — show the whole
              // poster — but in a fixed frame, so the sticky pane doesn't
              // resize every time a different row is picked.
              <img
                src={item.posterUrl}
                alt={item.title}
                className="w-full aspect-[2/3] object-contain"
                loading="lazy"
              />
            ) : (
              <div className="w-full aspect-[2/3] flex items-center justify-center p-4 text-center text-muted-foreground font-serif italic">
                No artwork yet
              </div>
            )}
            {/* No gradient scrim: it existed to fade a landscape image into the
                copy sitting beneath it, and nothing sits beneath it now. */}
            {item.isFeatured && (
              <Badge className="absolute top-3 left-3 bg-primary text-primary-foreground">
                Featured
              </Badge>
            )}
          </div>
          <div className="min-w-0 p-5 md:p-6">
            <p className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-2">
              {formatWhen(item.startTime)}
            </p>
            <h3 className="font-display text-2xl md:text-3xl uppercase tracking-wide leading-tight mb-3">
              {item.title}
            </h3>
            {/* A full-height poster next door buys roughly twice the room the
                stacked layout had, so the note gets to finish more often. */}
            {item.curatorNote && (
              <p className="font-serif text-sm md:text-base text-muted-foreground line-clamp-[10] mb-5">
                {htmlToPlainText(item.curatorNote)}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {/* Straight to the ticket page. Previously the only route out of
                  this panel was the drawer, which then made the reader pick the
                  showing a second time — for a preview of one specific showing
                  that is a step with nothing in it.

                  Gone entirely once the showing is over: "All showings" below
                  still gets the reader somewhere useful, so a past preview is
                  a readable panel rather than a dead button. The rule is
                  src/lib/purchasable.ts. */}
              {item.showingId && !isPast({ start_time: item.startTime }) && (
                <Button asChild className={cn('gap-2', GREEN_CTA)}>
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
    </div>
  );
}
