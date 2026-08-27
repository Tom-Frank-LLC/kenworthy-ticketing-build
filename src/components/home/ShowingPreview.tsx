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
import { ShowtimeChips } from './ShowtimeChips';
import type { FeedItem } from './TrailerFeed';
import { isRichTextEmpty } from '@/lib/richText';
import { RichText } from '@/components/RichText';

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
  // Scoped to this item so two previews on one page cannot share a heading id.
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
                stacked layout had. Past that the note scrolls rather than
                clamping at ten lines: a clamp ends a synopsis mid-sentence
                with no way to read the rest, and the pane is the only place
                this copy appears on the page.

                tabIndex makes the region reachable by keyboard — Chrome does
                not focus a scroll container on its own, so without it the
                hidden text is mouse-only. */}
            {!isRichTextEmpty(item.curatorNote) && (
              <div
                tabIndex={0}
                role="region"
                aria-label={`About ${item.title}`}
                className="themed-scroll max-h-[15rem] overflow-y-auto pr-3 mb-5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {/* The same renderer the ticket page uses, so a note reads the
                    same in both places. It renders here rather than flattening
                    because this pane already scrolls: the reason the teaser
                    slots flatten is `line-clamp`, and there is no clamp left in
                    this one. The emptiness guard is on the text rather than the
                    string — an editor the author cleared out stores `<p></p>`,
                    which is truthy and would otherwise draw an empty scroll
                    region above the buttons. */}
                <RichText
                  html={item.curatorNote}
                  className="font-serif text-sm md:text-base text-muted-foreground"
                />
              </div>
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
                <Button
                  asChild
                  variant={item.manuallySoldOut ? 'secondary' : 'default'}
                  className={cn('gap-2', !item.manuallySoldOut && GREEN_CTA)}
                >
                  <Link to={`/showing/${item.showingId}`}>
                    {/* A walk-in night has nothing to sell, so the ticket
                        glyph and the word go — but the link stays. The
                        showing page still holds the time, the venue and the
                        trailer, which is the whole of what somebody deciding
                        whether to come needs. */}
                    {/* The house is full, so the ticket glyph and the word
                        go the same way they do on a walk-in night. The link
                        stays: the chips below may offer a date that is still
                        open, and this panel is how the reader gets to them. */}
                    {item.manuallySoldOut ? (
                      <>
                        Sold Out
                        <ArrowRight className="h-4 w-4" />
                      </>
                    ) : item.noTicketRequired ? (
                      <>
                        Free · Details
                        <ArrowRight className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        <Ticket className="h-4 w-4" />
                        Get Tickets
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
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

            {/* The rest of the run, inline — now shared with the curator's
                pick, which offers the same dates when the production is what
                was picked. See ShowtimeChips. */}
            <ShowtimeChips
              showings={item.upcomingShowings}
              excludeShowingId={item.showingId}
              headingId={alsoPlayingHeadingId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
