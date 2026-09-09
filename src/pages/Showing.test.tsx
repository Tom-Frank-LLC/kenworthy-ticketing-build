import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

/**
 * A link to a showing must land on a page, whatever became of the showing.
 *
 * The bug this guards (BRIEF-past-event-graceful): when the row could not be
 * read the page called `navigate('/')`, so a patron on a shared link arrived
 * on the home page with no sentence to say why, and the team reported the
 * links as "404s". Two states replace it, and they are different facts:
 *
 *   * the showing has passed — a real page, in its passed state, with the
 *     run's remaining dates and two ways forward;
 *   * the showing cannot be read at all — the not-found state, still with
 *     the ways forward, still not a redirect.
 *
 * The home route renders a sentinel here so a redirect is a failure the test
 * can see rather than a passing render of the wrong page.
 */

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

// Rows the fake client answers from, keyed by table. Tests reassign these.
let tables: Record<string, any[]> = {};

vi.mock('@/integrations/supabase/client', () => {
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'filter', 'limit']) {
      b[m] = () => b;
    }
    const rows = () => tables[table] ?? [];
    // `.single()` is how the page reads one row; PostgREST answers a miss with
    // `data: null` and an error, which is exactly the shape a hidden or
    // deleted showing produces through RLS.
    b.single = () =>
      Promise.resolve(
        rows().length > 0
          ? { data: rows()[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: 'no rows' } },
      );
    b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
    b.then = (res: any, rej: any) => Promise.resolve({ data: rows(), error: null }).then(res, rej);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: () => builder('__rpc__'),
    },
  };
});

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));

const { default: Showing } = await import('./Showing');

function renderShowing(id: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/showing/${id}`]}>
        <Routes>
          <Route path="/" element={<p>HOME SENTINEL</p>} />
          <Route path="/showing/:id" element={<Showing />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  );
}

const movie = { id: 'movie-1', title: 'The Gold Rush', is_active: true, duration_minutes: 95, poster_url: null };

const pastShowing = {
  id: 'showing-past',
  movie_id: 'movie-1',
  event_id: null,
  live_performance_id: null,
  start_time: iso(-3 * DAY),
  ticket_price: 9,
  is_active: false,
  requires_seat_selection: false,
  no_ticket_required: false,
  manually_sold_out: false,
  total_seats: 200,
  venue_id: null,
};

beforeEach(() => {
  tables = {};
});

describe('Showing: a link that outlives its showing', () => {
  it('renders a past showing in its passed state, with ways forward, and does not redirect', async () => {
    tables = { showings: [pastShowing], movies: [movie] };
    renderShowing('showing-past');

    expect(await screen.findByText('This showing has passed.')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'The Gold Rush' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /see what.s playing now/i }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /browse the calendar/i }).getAttribute('href')).toBe('/calendar');
    expect(screen.queryByText('HOME SENTINEL')).toBeNull();
  });

  it('renders the not-found state, not the home page, when the showing cannot be read', async () => {
    tables = { showings: [], movies: [movie] };
    renderShowing('showing-gone');

    expect(await screen.findByText(/we couldn.t find that showing/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /see what.s playing now/i }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /browse the calendar/i }).getAttribute('href')).toBe('/calendar');
    expect(screen.queryByText('HOME SENTINEL')).toBeNull();
  });

  it('treats a readable showing whose title has been hidden as not found', async () => {
    tables = { showings: [pastShowing], movies: [] };
    renderShowing('showing-past');

    expect(await screen.findByText(/we couldn.t find that showing/i)).toBeTruthy();
    expect(screen.queryByText('This showing has passed.')).toBeNull();
    expect(screen.queryByText('HOME SENTINEL')).toBeNull();
  });
});
