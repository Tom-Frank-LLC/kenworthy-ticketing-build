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

/**
 * A film ticketed somewhere else keeps its showing page — the date, the venue
 * and the trailer are what somebody deciding whether to go needs — and sends
 * them out for the ticket. Nothing here sells: price_ticket_order refuses the
 * sale for a stale tab, and this pins that the page never offers one.
 */
describe('Showing: a film whose tickets are not sold here', () => {
  const upcoming = {
    ...pastShowing,
    id: 'showing-soon',
    start_time: iso(3 * DAY),
    is_active: true,
  };

  it('links out for an RSVP film, in a new tab, and renders no purchase panel', async () => {
    tables = {
      showings: [upcoming],
      movies: [{ ...movie, ticket_type: 'rsvp', rsvp_url: 'https://festival.example/gold-rush' }],
    };
    renderShowing('showing-soon');

    expect(await screen.findByText('Tickets for this showing are not sold here.')).toBeTruthy();
    const link = screen.getByRole('link', { name: /get tickets/i });
    expect(link.getAttribute('href')).toBe('https://festival.example/gold-rush');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByRole('heading', { name: 'General Admission' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Order Summary' })).toBeNull();
    expect(screen.queryByText(/per ticket/)).toBeNull();
    expect(screen.getByText('Tickets sold elsewhere')).toBeTruthy();
  });

  it('offers nothing at all for an info-only film', async () => {
    tables = { showings: [upcoming], movies: [{ ...movie, ticket_type: 'info_only' }] };
    renderShowing('showing-soon');

    expect(await screen.findByText('Tickets for this showing are not sold here.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /get tickets/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'General Admission' })).toBeNull();
    expect(screen.getByText('Not ticketed')).toBeTruthy();
  });

  it('still sells an ordinary ticketed film — the default every existing row has', async () => {
    tables = { showings: [upcoming], movies: [{ ...movie, ticket_type: 'ticketed' }] };
    renderShowing('showing-soon');

    expect(await screen.findByRole('heading', { name: 'General Admission' })).toBeTruthy();
    expect(screen.queryByText('Tickets for this showing are not sold here.')).toBeNull();
  });

  it('says passed, not "sold elsewhere", once the date is behind us', async () => {
    tables = {
      showings: [pastShowing],
      movies: [{ ...movie, ticket_type: 'rsvp', rsvp_url: 'https://festival.example/gold-rush' }],
    };
    renderShowing('showing-past');

    expect(await screen.findByText('This showing has passed.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /get tickets/i })).toBeNull();
  });
});
