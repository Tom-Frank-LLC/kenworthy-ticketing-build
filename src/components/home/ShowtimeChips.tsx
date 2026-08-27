import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { formatShowtime } from '@/lib/datetime';
import { isPast } from '@/lib/purchasable';
import type { UpcomingShowing } from './TrailerFeed';

/**
 * The rest of a production's run, as tappable dates.
 *
 * This is the whole of what the old "All showings" button used to travel to a
 * drawer to fetch. It lives in its own file because two places now offer the
 * same thing — the listing preview beside the Upcoming list, and the curator's
 * pick when the *production* is what was picked rather than one night of it.
 * They were the same markup twice, which is the shape of thing that drifts:
 * one gets a hover state or an aria-label and the other quietly doesn't.
 *
 * `isPast` is asked here, at render, rather than at feed-build time, so this
 * agrees with the Get Tickets button it sits under — both ask the same
 * question of the same clock. The rule is src/lib/purchasable.ts.
 */
export function ShowtimeChips({
  showings,
  excludeShowingId,
  headingId,
  heading = 'Also playing',
  className,
}: {
  showings: UpcomingShowing[] | undefined;
  /** The date already named above these chips — offering it twice under two
   *  labels reads as two different screenings. */
  excludeShowingId: string | null;
  headingId: string;
  heading?: string;
  className?: string;
}) {
  const alsoPlaying = (showings ?? []).filter(
    (s) => s.id !== excludeShowingId && !isPast({ start_time: s.start_time }),
  );

  // A production that plays once — the common case — renders nothing at all,
  // rather than a heading over a single chip duplicating the button above it.
  if (alsoPlaying.length === 0) return null;

  return (
    <div className={cn('mt-5', className)}>
      <h4
        id={headingId}
        className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-2"
      >
        {heading}
      </h4>
      {/* A list, so a screen reader announces how many dates there are before
          reading them. */}
      <ul aria-labelledby={headingId} className="flex flex-wrap gap-2">
        {alsoPlaying.map((s) => (
          <li key={s.id}>
            <Link
              to={`/showing/${s.id}`}
              // The visible text is a date and a time, which out of context
              // reads as a label rather than a destination. The accessible
              // name keeps the visible string and says what it does with it.
              aria-label={`Get tickets for ${formatShowtime(s.start_time, 'EEE, MMM d · h:mm a')}`}
              className="inline-flex items-center rounded-full border border-accent/40 bg-background px-3 py-1.5 font-serif text-sm text-foreground transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {formatShowtime(s.start_time, 'EEE, MMM d · h:mm a')}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
