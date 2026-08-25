import { Link } from 'react-router-dom';
import { addDays } from 'date-fns';
import { PlayCircle, Ticket, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { GREEN_CTA } from '@/lib/greenCta';
import { formatShowtime, venueDayKey } from '@/lib/datetime';
import { isPast } from '@/lib/purchasable';
import { TrailerModal } from '@/components/TrailerModal';
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
 * This pane is now self-contained: it used to take an `onViewDetails` callback
 * and spend two of its three buttons opening ProductionDetailDrawer — one to
 * list the other showtimes, one to play the trailer. Both are answered here
 * instead, by showtime chips and a lightbox, because a sheet that slides in
 * from the right to say "it also plays Saturday at 2" costs a click and a
 * whole screen to deliver one line of text.
 *
 * The drawer is not gone: below `lg` this pane does not render at all, and
 * tapping a row there still opens it. See UpcomingList.
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
  className,
}: {
  item: FeedItem;
  className?: string;
}) {
  // Every *other* date this production plays. The previewed showing already
  // has the green button below, so repeating it as a chip would offer the
  // same link twice under two different labels.
  //
  // Filtered by `isPast` here rather than at feed-build time so that this
  // agrees with the Get Tickets button it sits under — both ask the question
  // at render, of the same clock. The rule is src/lib/purchasable.ts.
  const alsoPlaying = (item.upcomingShowings ?? []).filter(
    (s) => s.id !== item.showingId && !isPast({ start_time: s.start_time }),
  );
  const alsoPlayingHeadingId = `also-playing-${item.id}`;

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

                  Gone entirely once the showing is over: the chips below still
                  get the reader to a date they can actually buy, so a past
                  preview is a readable panel rather than a dead button. The
                  rule is src/lib/purchasable.ts. */}
              {item.showingId && !isPast({ start_time: item.startTime }) && (
                <Button asChild className={cn('gap-2', GREEN_CTA)}>
                  <Link to={`/showing/${item.showingId}`}>
                    <Ticket className="h-4 w-4" />
                    Get Tickets
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              )}
              {/* TrailerModal owns this button — it renders it as its own
                  dialog trigger, and renders nothing when the production has
                  no trailer. */}
              <TrailerModal
                title={item.title}
                trailerUrl={item.trailerUrl}
                posterUrl={item.posterUrl}
              >
                <Button variant="outline" className="gap-2">
                  <PlayCircle className="h-4 w-4" />
                  Watch trailer
                </Button>
              </TrailerModal>
            </div>

            {/* The rest of the run, inline. This is the whole of what the
                "All showings" button used to travel to the drawer to fetch,
                and a film that plays once — the common case — renders nothing
                here at all rather than a heading over a single chip that
                duplicates the button above it. */}
            {alsoPlaying.length > 0 && (
              <div className="mt-5">
                <h4
                  id={alsoPlayingHeadingId}
                  className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-2"
                >
                  Also playing
                </h4>
                {/* A list, so a screen reader announces how many dates there
                    are before reading them. */}
                <ul aria-labelledby={alsoPlayingHeadingId} className="flex flex-wrap gap-2">
                  {alsoPlaying.map((s) => (
                    <li key={s.id}>
                      <Link
                        to={`/showing/${s.id}`}
                        // The visible text is a date and a time, which out of
                        // context reads as a label rather than a destination.
                        // The accessible name keeps the visible string intact
                        // and says what the link does with it.
                        aria-label={`Get tickets for ${formatShowtime(s.start_time, 'EEE, MMM d · h:mm a')}`}
                        className="inline-flex items-center rounded-full border border-accent/40 bg-background px-3 py-1.5 font-serif text-sm text-foreground transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        {formatShowtime(s.start_time, 'EEE, MMM d · h:mm a')}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
