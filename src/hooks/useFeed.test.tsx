import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * The catalogue fetch is shared and cached.
 *
 * Home and Calendar used to each carry their own copy of the four queries and
 * refetch on every mount, so a home → calendar → home round-trip was three
 * downloads of the same catalogue. These tests pin the two things that fix
 * that: one hook builds the feed for both pages, and a second mount inside the
 * stale window reads the cache instead of the network.
 */

const selectCalls: string[] = [];
const gteCalls: Array<[string, string]> = [];

const soon = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const rows: Record<string, unknown[]> = {
  movies: [
    { id: 'm1', title: 'Metropolis', description: null, poster_url: null, trailer_url: null, is_featured: true },
  ],
  events: [
    { id: 'e1', title: 'Quiz Night', description: null, poster_url: null, trailer_url: null, ticket_type: 'rsvp', rsvp_url: 'https://x' },
    { id: 'e2', title: 'Gala', description: null, poster_url: null, trailer_url: null, ticket_type: 'ticketed' },
  ],
  live_performances: [],
  // Dated inside the next year, because the standalone RSVP item sorts on a
  // key one year out and the test below expects it last.
  showings: [
    { id: 's1', start_time: soon(2), ticket_price: 10, movie_id: 'm1', event_id: null, live_performance_id: null },
    { id: 's2', start_time: soon(1), ticket_price: 25, movie_id: null, event_id: 'e2', live_performance_id: null },
  ],
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const result = Promise.resolve({ data: rows[table] ?? [], error: null });
      // Every query ends in `.eq('is_active', true)`; showings go on to
      // `.gte().order()`. Each step returns the same thenable so the chain
      // resolves however long it is.
      const chain: any = {
        select: (cols: string) => { selectCalls.push(`${table}:${cols}`); return chain; },
        eq: () => chain,
        gte: (col: string, val: string) => { gteCalls.push([col, val]); return chain; },
        order: () => chain,
        then: result.then.bind(result),
      };
      return chain;
    },
  },
}));

const { useFeed, fetchFeed, FEED_STALE_MS } = await import('./useFeed');

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useFeed', () => {
  beforeEach(() => { selectCalls.length = 0; });

  it('builds one item per showing, plus a standalone item for an RSVP event with no dates', async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useFeed(), { wrapper: wrapperFor(client) });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    const ids = result.current.feed.map(i => i.id);
    // Chronological: the gala (tomorrow) before the film (the day after), the
    // dateless RSVP event last on its far-future key.
    expect(ids).toEqual(['event-e2-s2', 'movie-m1-s1', 'event-e1-standalone']);
    expect(result.current.feed[2].showingId).toBeNull();
    expect(result.current.feed[2].rsvpUrl).toBe('https://x');
    expect(result.current.productionsById.get('movie:m1')?.is_featured).toBe(true);
  });

  it('reads named showing columns, not *', async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useFeed(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const showingsSelect = selectCalls.find(c => c.startsWith('showings:'));
    expect(showingsSelect).toBeDefined();
    expect(showingsSelect).not.toContain('*');
    expect(showingsSelect).toContain('manually_sold_out');
  });

  it('serves a second mount from cache inside the stale window', async () => {
    const client = new QueryClient();
    const wrapper = wrapperFor(client);

    const first = renderHook(() => useFeed(), { wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    const fetchesAfterFirst = selectCalls.length;
    expect(fetchesAfterFirst).toBe(4);
    first.unmount();

    // The calendar mounting after the home page, or home again after the
    // calendar: same key, same client, no new queries.
    const second = renderHook(() => useFeed(), { wrapper });
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.feed.length).toBe(3);
    expect(selectCalls.length).toBe(fetchesAfterFirst);
    expect(FEED_STALE_MS).toBeGreaterThan(0);
  });
});

/**
 * A showing stays listed until it ends, not until it starts, and every item
 * and chip carries its production's runtime so the buttons know when that is.
 */
describe('fetchFeed — listed until the showing ends', () => {
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const saved = { ...rows };
  beforeEach(() => { gteCalls.length = 0; });

  it('keeps a show that is still playing, drops one that has ended, and carries the runtime', async () => {
    rows.movies = [{ id: 'short', title: 'Short Film', duration_minutes: 60 }, { id: 'nodur', title: 'Unknown Length', duration_minutes: 0 }];
    rows.events = [{ id: 'long', title: 'Bandstand', ticket_type: 'ticketed', duration_minutes: 150 }];
    rows.showings = [
      // 2h10m into a 150-minute show: still on.
      { id: 'playing', start_time: ago(130), ticket_price: 20, movie_id: null, event_id: 'long', live_performance_id: null },
      // 90 minutes into a 60-minute film: over.
      { id: 'ended', start_time: ago(90), ticket_price: 10, movie_id: 'short', event_id: null, live_performance_id: null },
      // No runtime set: the two-hour default, so 100 minutes in is still on.
      { id: 'default', start_time: ago(100), ticket_price: 10, movie_id: 'nodur', event_id: null, live_performance_id: null },
    ];
    try {
      const { feed } = await fetchFeed();
      const byShowing = Object.fromEntries(feed.map((i) => [i.showingId, i]));
      expect(Object.keys(byShowing).sort()).toEqual(['default', 'playing']);
      expect(byShowing.playing.durationMinutes).toBe(150);
      expect(byShowing.playing.upcomingShowings?.[0].duration_minutes).toBe(150);

      // The query reaches back far enough to see a show that started hours ago.
      const [col, since] = gteCalls.find(([c]) => c === 'start_time')!;
      expect(col).toBe('start_time');
      expect(Date.now() - new Date(since).getTime()).toBeGreaterThanOrEqual(12 * 60 * 60 * 1000 - 1000);
    } finally {
      Object.assign(rows, saved);
    }
  });
});
