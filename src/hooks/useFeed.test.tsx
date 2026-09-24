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
        gte: () => chain,
        order: () => chain,
        then: result.then.bind(result),
      };
      return chain;
    },
  },
}));

const { useFeed, FEED_STALE_MS } = await import('./useFeed');

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
