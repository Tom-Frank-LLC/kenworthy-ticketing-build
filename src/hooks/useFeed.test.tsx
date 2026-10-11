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

/** Every table the feed read from, in order: the catalogue-wide reads that
 *  hit PostgREST's row cap must not come back. */
const tableCalls: string[] = [];

/** A production row as the database holds it: active unless a test says not. */
const stored = (table: string, id: string | null) => {
  const row = (rows[table] as any[] | undefined)?.find((r) => r.id === id);
  return row ? { is_active: true, ...row } : null;
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      tableCalls.push(table);
      const filters: Array<(r: any) => boolean> = [];
      // Showings come back with their production embedded, as PostgREST
      // returns `movie:movies(...)`; other tables honour eq/in like it would.
      const resolve = () => {
        const base = (rows[table] ?? []) as any[];
        const data =
          table === 'showings'
            ? base.map((s) => ({
                ...s,
                movie: stored('movies', s.movie_id),
                event: stored('events', s.event_id),
                live_performance: stored('live_performances', s.live_performance_id),
              }))
            : base.map((r) => ({ is_active: true, ...r })).filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data, error: null });
      };
      const chain: any = {
        select: (cols: string) => { selectCalls.push(`${table}:${cols}`); return chain; },
        eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return chain; },
        in: (col: string, vals: unknown[]) => { filters.push((r) => vals.includes(r[col])); return chain; },
        gte: (col: string, val: string) => { gteCalls.push([col, val]); return chain; },
        order: () => chain,
        then: (ok: any, fail: any) => resolve().then(ok, fail),
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
  beforeEach(() => { selectCalls.length = 0; tableCalls.length = 0; });

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
    // The showing's own columns. Its embedded event and performance come back
    // whole on purpose: they leave the feed as productionsById.
    const ownColumns = showingsSelect!.split(',movie:')[0];
    expect(ownColumns).not.toContain('*');
    expect(showingsSelect).toContain('manually_sold_out');
  });

  it('reads the titles the showings name, never the whole catalogue', async () => {
    // Production has more active films than PostgREST returns in one read
    // (1,131 against a cap of 1,000), so a catalogue-wide read loses some at
    // random. The films must arrive embedded in the showings instead.
    const client = new QueryClient();
    const { result } = renderHook(() => useFeed(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(tableCalls.sort()).toEqual(['events', 'showings']);
    expect(selectCalls.find((c) => c.startsWith('showings:'))).toContain('movie:movies(');
    // The events read is the standalone RSVP / info-only ones, and only those.
    expect(result.current.productionsById.has('event:e1')).toBe(true);
    expect([...result.current.productionsById.keys()].sort()).toEqual(['event:e1', 'event:e2', 'movie:m1']);
  });

  it('serves a second mount from cache inside the stale window', async () => {
    const client = new QueryClient();
    const wrapper = wrapperFor(client);

    const first = renderHook(() => useFeed(), { wrapper });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    const fetchesAfterFirst = selectCalls.length;
    expect(fetchesAfterFirst).toBe(2);
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
describe('fetchFeed — hidden titles', () => {
  it("drops a showing whose title is not active, as the old catalogue read did", async () => {
    const saved = { ...rows };
    rows.movies = [{ id: 'gone', title: 'Withdrawn', is_active: false }];
    rows.events = [];
    rows.showings = [{ id: 'sx', start_time: soon(1), ticket_price: 10, movie_id: 'gone', event_id: null, live_performance_id: null }];
    try {
      const { feed, productionsById } = await fetchFeed();
      expect(feed).toEqual([]);
      expect(productionsById.size).toBe(0);
    } finally {
      Object.assign(rows, saved);
    }
  });
});

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
