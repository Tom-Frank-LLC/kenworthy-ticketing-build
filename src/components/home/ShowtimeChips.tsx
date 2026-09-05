import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { formatShowtime } from '@/lib/datetime';
import { isPast } from '@/lib/purchasable';
import type { UpcomingShowing } from './TrailerFeed';

/**
 * The rest of a production's run, as tappable dates.
 *
 * This is the whole of what the old "All showings" button used to travel to a
 * drawer to fetch. It lives in its own file because three places now offer the
 * same thing — the listing preview beside the Upcoming list, the curator's
 * pick when the *production* is what was picked rather than one night of it,
 * and the ticketing page for a single date. They were the same markup twice,
 * which is the shape of thing that drifts: one gets a hover state or an
 * aria-label and the other quietly doesn't.
 *
 * `isPast` is asked here, at render, rather than at feed-build time, so this
 * agrees with the Get Tickets button it sits under — both ask the same
 * question of the same clock. The rule is src/lib/purchasable.ts.
 */
export function ShowtimeChips({
  showings,
  currentShowingId,
  currentMode = 'exclude',
  currentVenueName,
  headingId,
  heading = 'Also playing',
  headingLevel: Heading = 'h3',
  className,
}: {
  showings: UpcomingShowing[] | undefined;
  /** The date this list is being shown *next to*, whichever way it is treated. */
  currentShowingId: string | null;
  /**
   * What to do with that date.
   *
   * `exclude` — the listings. The date is already named above the chips, and
   * offering it twice under two labels reads as two different screenings.
   *
   * `mark` — the ticketing page. The chips are the whole run and leaving a
   * hole where tonight belongs makes the reader count dates to find where
   * they are. It renders as plain text rather than a link to itself, carrying
   * `aria-current`.
   *
   * One prop names the date and one says what happens to it, rather than two
   * props that both mean "the current showing" — that pair is how the two
   * behaviours would drift apart.
   */
  currentMode?: 'exclude' | 'mark';
  /**
   * The venue named beside these chips. A date in a *different* room says so
   * on its own chip; passing nothing means no chip ever names a venue, which
   * is what the listings want.
   */
  currentVenueName?: string | null;
  headingId: string;
  heading?: string;
  /**
   * The heading level this block sits at.
   *
   * It was a hardcoded <h4>, which skipped a level under BoothNote's <h2>
   * and two under the showing page's <h1> — axe's `heading-order`, and a
   * screen-reader user hearing a section that is not there. The default
   * suits the two card callers; the showing page passes h2.
   */
  headingLevel?: 'h2' | 'h3' | 'h4';
  className?: string;
}) {
  // duration_minutes is passed through so a long programme still in progress
  // stays in its own list; absent, the rule uses its own default.
  const upcoming = (showings ?? []).filter(
    (s) => !isPast({ start_time: s.start_time, duration_minutes: s.duration_minutes }),
  );

  const others = upcoming.filter((s) => s.id !== currentShowingId);
  const visible = currentMode === 'mark' ? upcoming : others;

  // A production that plays once — the common case — renders nothing at all,
  // rather than a heading over a single chip duplicating the button above it.
  // The count that matters is of the *other* dates either way: in `mark` mode
  // a lone chip for the date the reader is already on is the same empty
  // chrome, just harder to spot.
  if (others.length === 0) return null;

  return (
    <div className={cn('mt-5', className)}>
      <Heading
        id={headingId}
        className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-2"
      >
        {heading}
      </Heading>
      {/* A list, so a screen reader announces how many dates there are before
          reading them. */}
      <ul aria-labelledby={headingId} className="flex flex-wrap gap-2">
        {visible.map((s) => {
          const when = formatShowtime(s.start_time, 'EEE, MMM d · h:mm a');
          // Only worth saying when it is news. In the ordinary run every date
          // is in the room already named at the top of the page.
          const elsewhere =
            s.venue_name && currentVenueName && s.venue_name !== currentVenueName
              ? s.venue_name
              : null;
          const isCurrent = currentMode === 'mark' && s.id === currentShowingId;

          const body = (
            <>
              {when}
              {elsewhere && (
                <span className="ml-1.5 text-muted-foreground">· {elsewhere}</span>
              )}
              {/* Said in the chip as well as in the label above. Marking a
                  free date for screen readers only would leave the two
                  audiences reading different lists. */}
              {s.no_ticket_required && (
                <span className="ml-1.5 text-success font-medium">· Free</span>
              )}
              {/* Marked for the same reason a free date is: this list is where
                  a reader picks which night to come to, and "Get tickets for
                  Friday" is the wrong promise on a Friday that has none. */}
              {s.manually_sold_out && (
                <span className="ml-1.5 text-destructive font-medium">· Sold Out</span>
              )}
            </>
          );

          return (
            <li key={s.id}>
              {isCurrent ? (
                // Not a link, because it points at the page the reader is
                // already reading. `aria-current` is what says so to a screen
                // reader; the filled chip is what says so to everyone else.
                <span
                  aria-current="page"
                  className="inline-flex items-center rounded-full border border-accent bg-accent/15 px-3 py-1.5 font-serif text-sm font-semibold text-foreground"
                >
                  {body}
                  <span className="sr-only"> — the showtime you are viewing</span>
                </span>
              ) : (
                <Link
                  to={`/showing/${s.id}`}
                  // The visible text is a date and a time, which out of context
                  // reads as a label rather than a destination. The accessible
                  // name keeps the visible string and says what it does with it.
                  // "Get tickets for Friday" is the wrong promise on a date that
                  // issues none, and a screen reader gets only this string — the
                  // visible chip is a bare date either way, so this is the only
                  // place the difference can be said at all.
                  aria-label={
                    s.manually_sold_out
                      ? `Details for ${when}${elsewhere ? ` at ${elsewhere}` : ''} — sold out`
                      : s.no_ticket_required
                        ? `Details for ${when}${elsewhere ? ` at ${elsewhere}` : ''} — free, no ticket needed`
                        : `Get tickets for ${when}${elsewhere ? ` at ${elsewhere}` : ''}`
                  }
                  className="inline-flex items-center rounded-full border border-accent/40 bg-background px-3 py-1.5 font-serif text-sm text-foreground transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
