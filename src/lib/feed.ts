import type { FeedItem, UpcomingShowing } from '@/components/home/TrailerFeed';

/**
 * Give every item the full set of dates its production plays.
 *
 * The feed is one item per *showing*, so a film with four screenings is four
 * near-identical items. Anything that wants to offer the whole run — the
 * listing preview's showtime chips — has to reassemble that set, and both the
 * home page and the Calendar page were doing it inline, by hand, at the moment
 * they opened the drawer. This is that reassembly, done once at feed-build
 * time so the two pages cannot drift.
 *
 * "Upcoming" is already true of everything here: both builders query
 * `start_time >= now`. The live check against a tab left open across a showtime
 * belongs at render, next to the button it hides — see `ShowingPreview`, which
 * asks `isPast` per chip.
 *
 * Items with no showing of their own (standalone RSVP / info-only events) get
 * an empty list rather than being skipped, so callers never have to null-check.
 *
 * This lives in `lib/` rather than beside `useFeed` because it is a pure
 * function and `useFeed` imports the Supabase client — importing the helper
 * from there drags a configured client into anything that wants to test it.
 */
export function attachUpcomingShowings(items: FeedItem[]): FeedItem[] {
  const byProduction = new Map<string, UpcomingShowing[]>();
  for (const item of items) {
    if (!item.showingId) continue;
    const key = `${item.type}:${item.productionId}`;
    const list = byProduction.get(key) ?? [];
    list.push({
      id: item.showingId,
      start_time: item.startTime,
      ticket_price: item.ticketPrice ?? 0,
      no_ticket_required: item.noTicketRequired ?? false,
    });
    byProduction.set(key, list);
  }

  for (const list of byProduction.values()) {
    list.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }

  return items.map((item) => ({
    ...item,
    upcomingShowings: byProduction.get(`${item.type}:${item.productionId}`) ?? [],
  }));
}
