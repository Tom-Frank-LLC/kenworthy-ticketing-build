import { supabase } from '@/integrations/supabase/client';
import type { UpcomingShowing } from '@/components/home/TrailerFeed';
import { isPast, resolveDurationMinutes } from './purchasable';

/**
 * How far back the sibling query reaches before `isPast` gets the final say.
 *
 * A showing is not past until it *ends*, so "upcoming" cannot be asked of the
 * database as `start_time >= now` — that drops a programme that began an hour
 * ago and is still selling, including, on the ticketing page, the very date
 * the reader is looking at. The database cannot answer the real question
 * either: the end depends on `duration_minutes` falling back to the film's,
 * falling back to a default, which is src/lib/purchasable.ts's chain and not
 * something to restate in a filter.
 *
 * So the query casts one bounded net backwards and `isPast` decides. Twelve
 * hours is well past the longest thing this house programmes (a silent-film
 * marathon runs eight) while still keeping the query small — the alternative,
 * no lower bound at all, would pull a hundred years of screenings to display
 * a week of them.
 */
const LOOKBACK_MS = 12 * 60 * 60 * 1000;

/** Which column ties a showing to its production. Exactly one is ever set. */
export function productionKey(
  showing: { movie_id?: string | null; event_id?: string | null; live_performance_id?: string | null } | null | undefined,
): { column: 'movie_id' | 'event_id' | 'live_performance_id'; id: string } | null {
  if (!showing) return null;
  if (showing.event_id) return { column: 'event_id', id: showing.event_id };
  if (showing.live_performance_id) return { column: 'live_performance_id', id: showing.live_performance_id };
  if (showing.movie_id) return { column: 'movie_id', id: showing.movie_id };
  return null;
}

/**
 * Every date of this production still worth linking to, soonest first.
 *
 * Includes the showing passed in when it has not ended — the ticketing page
 * marks it as the current one rather than leaving a hole in its own run.
 * `production` is the movie row, only so that a film's `duration_minutes` can
 * stand in where a showing has none; events and live performances have no such
 * column and pass nothing. It may be handed in as a promise, so the caller can
 * start this query and the production query together rather than waiting for
 * one to name the other.
 *
 * Returns [] rather than throwing on any failure. This list is an extra beside
 * a working purchase flow, and a page that renders no chips is a smaller
 * failure than a page that renders nothing.
 */
export async function fetchSiblingShowings(
  showing: { movie_id?: string | null; event_id?: string | null; live_performance_id?: string | null } | null | undefined,
  production?:
    | { duration_minutes?: number | null }
    | null
    | PromiseLike<{ duration_minutes?: number | null } | null>,
): Promise<UpcomingShowing[]> {
  const key = productionKey(showing);
  if (!key) return [];

  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { data, error } = await supabase
    .from('showings')
    .select('id,start_time,ticket_price,duration_minutes,no_ticket_required,manually_sold_out,venues(name)')
    .eq(key.column, key.id)
    .eq('is_active', true)
    .gte('start_time', since)
    .order('start_time');

  if (error || !data) return [];

  // Awaited only now: the query above and the caller's production fetch have
  // been in flight together, and the runtime is not needed until the rows are.
  const runtime = (await production) ?? null;

  return (data as any[])
    .filter((s) => !isPast(s, runtime))
    .map((s) => ({
      id: s.id,
      start_time: s.start_time,
      ticket_price: Number(s.ticket_price ?? 0),
      // The *resolved* runtime, not the raw column. ShowtimeChips asks
      // isPast again at render, and it has no production row to fall back
      // through — handed the bare column, a long film with no per-showing
      // override would survive the filter here and be dropped there.
      duration_minutes: resolveDurationMinutes(s, runtime),
      no_ticket_required: s.no_ticket_required === true,
      manually_sold_out: s.manually_sold_out === true,
      venue_name: s.venues?.name ?? null,
    }));
}
