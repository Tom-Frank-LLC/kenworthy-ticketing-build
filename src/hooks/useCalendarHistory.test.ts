import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The calendar's history fetch. What is worth pinning is the data shape it was
 * built against (production, 2026-10-09): past showings are almost all
 * `is_active = false` archive rows, and there are more active films than
 * PostgREST will return in one read. Either mistake fails silently — a short
 * history, or titles missing at random — so both are asserted on the query
 * itself.
 */

type Call = { table: string; op: string; args: unknown[] };
const calls: Call[] = [];
const rows: Record<string, any[]> = {};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const chain: any = {};
      for (const op of ['select', 'eq', 'gte', 'lt', 'order', 'limit', 'in']) {
        chain[op] = (...args: unknown[]) => {
          calls.push({ table, op, args });
          return chain;
        };
      }
      chain.then = (resolve: any, reject: any) => {
        // Showings come back with their production embedded, as PostgREST
        // returns `movie:movies(...)`: null when RLS hides the title.
        const find = (t: string, id: string | null | undefined) => rows[t]?.find((r) => r.id === id) ?? null;
        const data = (rows[table] ?? []).map((s) => ({
          ...s,
          movie: find('movies', s.movie_id),
          event: find('events', s.event_id),
          live_performance: find('live_performances', s.live_performance_id),
        }));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      };
      return chain;
    },
  },
}));

const { fetchHistoryMonth, historyMonthsFor } = await import('./useCalendarHistory');

const NOW = new Date('2026-10-09T20:00:00Z').getTime(); // 1 PM at the venue

describe('fetchHistoryMonth', () => {
  beforeEach(() => {
    calls.length = 0;
    rows.movies = [
      { id: 'm1', title: 'Metropolis', duration_minutes: 150, is_active: true },
      { id: 'm2', title: 'Nosferatu', duration_minutes: 90, is_active: true },
    ];
    rows.events = [];
    rows.live_performances = [];
    rows.showings = [
      // Archive row: inactive, long over. Must be included.
      { id: 'a', start_time: '2026-10-02T02:00:00Z', is_active: false, movie_id: 'm1' },
      // Started an hour ago, 90-minute film: still playing. The live feed
      // lists it; history must not.
      { id: 'b', start_time: '2026-10-09T19:00:00Z', is_active: true, movie_id: 'm2' },
      // Title hidden (RLS returns no production row): dropped.
      { id: 'c', start_time: '2026-10-03T02:00:00Z', is_active: false, movie_id: 'hidden' },
    ];
  });

  it('includes inactive archive showings, marks them ended, and drops one still playing', async () => {
    const items = await fetchHistoryMonth('2026-10', NOW);
    expect(items.map((i) => i.showingId)).toEqual(['a']);
    expect(items[0].ended).toBe(true);
    expect(items[0].title).toBe('Metropolis');

    const showingFilters = calls.filter((c) => c.table === 'showings' && c.op === 'eq');
    expect(showingFilters).toEqual([]);
  });

  it('asks for the venue month, up to now, not past it', async () => {
    await fetchHistoryMonth('2026-10', NOW);
    const gte = calls.find((c) => c.table === 'showings' && c.op === 'gte');
    const lt = calls.find((c) => c.table === 'showings' && c.op === 'lt');
    // Midnight Oct 1 Pacific (PDT, UTC-7).
    expect(gte?.args).toEqual(['start_time', '2026-10-01T07:00:00.000Z']);
    expect(lt?.args).toEqual(['start_time', new Date(NOW).toISOString()]);
  });

  it('reads productions embedded in the showings, never the whole catalogue', async () => {
    await fetchHistoryMonth('2026-10', NOW);
    expect(new Set(calls.map((c) => c.table))).toEqual(new Set(['showings']));
    const select = calls.find((c) => c.op === 'select');
    expect(select?.args[0]).toContain('movie:movies(');
  });

  it('drops a showing whose title is no longer active', async () => {
    rows.movies[0].is_active = false;
    expect(await fetchHistoryMonth('2026-10', NOW)).toEqual([]);
  });

  it('asks nothing of a month that has not started', async () => {
    expect(await fetchHistoryMonth('2026-11', NOW)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('historyMonthsFor', () => {
  const now = new Date(2026, 9, 9);

  it('loads the months on screen plus the one before, never the future', () => {
    // The opening week view: early October to mid November.
    expect(historyMonthsFor([new Date(2026, 9, 1), new Date(2026, 10, 1)], now)).toEqual([
      '2026-09',
      '2026-10',
    ]);
  });

  it('prefetches across a year boundary', () => {
    expect(historyMonthsFor([new Date(2025, 0, 1)], now)).toEqual(['2024-12', '2025-01']);
  });

  it('asks for nothing before the grid reports what it shows', () => {
    expect(historyMonthsFor([], now)).toEqual([]);
  });
});
