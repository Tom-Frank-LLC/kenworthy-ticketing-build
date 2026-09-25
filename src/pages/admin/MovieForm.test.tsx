import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * A film can be ticketed somewhere else, the way an event can.
 *
 * BRIEF-movie-external-ticketing. These pin down the shape of what the form
 * writes: `ticketed` by default (what every existing film is), the link only
 * when the mode is RSVP and only when it is a real https link, and cleared the
 * moment the mode moves away — a stale link would be rendered as a booking
 * button for a film people are meant to buy a ticket for here.
 */

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const MOVIE_ID = 'aaaaaaaa-1111-4000-8000-000000000001';

const state = vi.hoisted(() => ({
  writes: [] as Array<{ table: string; op: 'insert' | 'update'; payload: any }>,
  rows: {} as Record<string, any>,
  toasts: { error: [] as string[], success: [] as string[] },
}));

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ isAdmin: true, loading: false }) }));
vi.mock('sonner', () => ({
  toast: {
    error: (m: string) => state.toasts.error.push(m),
    success: (m: string) => state.toasts.success.push(m),
  },
}));
vi.mock('@/components/admin/SeatTierEditor', () => ({ SeatTierEditor: () => <div>SEAT PRICING</div> }));
vi.mock('@/components/admin/DiscountRulesEditor', () => ({ default: () => <div>DISCOUNTS</div> }));
vi.mock('@/components/admin/PosterUpload', () => ({ PosterUpload: () => null }));
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ id }: any) => <textarea id={id} />,
}));

vi.mock('@/integrations/supabase/client', () => {
  const chain = (result: any): any => {
    const self: any = {
      select: () => self,
      eq: () => self,
      order: () => self,
      single: () => Promise.resolve(result),
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    };
    return self;
  };
  return {
    supabase: {
      from: (table: string) => ({
        select: () => chain({ data: state.rows[table] ?? null, error: null }),
        insert: (payload: any) => {
          state.writes.push({ table, op: 'insert', payload });
          return chain({ data: [{ id: 'new-id' }], error: null });
        },
        update: (payload: any) => {
          state.writes.push({ table, op: 'update', payload });
          return chain({ data: [{ id: 'existing-id' }], error: null });
        },
      }),
    },
  };
});

const { default: MovieForm } = await import('./MovieForm');

beforeEach(() => {
  state.writes = [];
  state.rows = {};
  state.toasts = { error: [], success: [] };
});

// Stands in for the dashboard and shows the query string it was sent, since
// the dashboard reads its sort and tab from there.
function AdminStub() {
  const { search } = useLocation();
  return <div data-testid="admin">{`admin dashboard${search}`}</div>;
}

function renderForm(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/movies/new" element={<MovieForm />} />
        <Route path="/admin/movies/:id" element={<MovieForm />} />
        <Route path="/admin" element={<AdminStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function choose(label: string, option: string) {
  fireEvent.click(await screen.findByLabelText(label));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('MovieForm — how people get in', () => {
  it('writes a new film as ticketed with no link, which is what every existing film is', async () => {
    renderForm('/admin/movies/new');

    fireEvent.change(await screen.findByLabelText('Title *'), { target: { value: 'The Gold Rush' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Movie' }));

    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0].table).toBe('movies');
    expect(state.writes[0].payload).toMatchObject({ ticket_type: 'ticketed', rsvp_url: null });
  });

  it('stores an External film with its outside link (stored as rsvp — the column value events use)', async () => {
    renderForm('/admin/movies/new');

    fireEvent.change(await screen.findByLabelText('Title *'), { target: { value: 'Festival Film' } });
    await choose('Ticketing *', 'External');
    fireEvent.change(screen.getByLabelText('External ticket URL'), { target: { value: 'https://festival.example/tickets' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Movie' }));

    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0].payload).toMatchObject({
      ticket_type: 'rsvp',
      rsvp_url: 'https://festival.example/tickets',
    });
  });

  it('refuses an External film without a link rather than saving one that sells nothing anywhere', async () => {
    renderForm('/admin/movies/new');

    fireEvent.change(await screen.findByLabelText('Title *'), { target: { value: 'Festival Film' } });
    await choose('Ticketing *', 'External');
    fireEvent.click(screen.getByRole('button', { name: 'Create Movie' }));

    await waitFor(() => expect(state.toasts.error).toHaveLength(1));
    expect(state.toasts.error[0]).toMatch(/link is needed/);
    expect(state.writes).toHaveLength(0);
  });

  it('refuses a link that is not https', async () => {
    renderForm('/admin/movies/new');

    fireEvent.change(await screen.findByLabelText('Title *'), { target: { value: 'Festival Film' } });
    await choose('Ticketing *', 'External');
    fireEvent.change(screen.getByLabelText('External ticket URL'), { target: { value: 'http://festival.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Movie' }));

    await waitFor(() => expect(state.toasts.error).toHaveLength(1));
    expect(state.writes).toHaveLength(0);
  });

  it('drops a stale link when the mode moves back to ticketed', async () => {
    renderForm('/admin/movies/new');

    fireEvent.change(await screen.findByLabelText('Title *'), { target: { value: 'Gala' } });
    await choose('Ticketing *', 'External');
    fireEvent.change(screen.getByLabelText('External ticket URL'), { target: { value: 'https://festival.example/old' } });
    await choose('Ticketing *', 'Ticketed');
    fireEvent.click(screen.getByRole('button', { name: 'Create Movie' }));

    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0].payload).toMatchObject({ ticket_type: 'ticketed', rsvp_url: null });
  });

  it('loads an existing External film with its mode and link, and keeps them on save', async () => {
    state.rows.movies = {
      id: MOVIE_ID, title: 'Festival Film', duration_minutes: 100, is_active: true,
      ticket_type: 'rsvp', rsvp_url: 'https://festival.example/tickets',
    };
    renderForm(`/admin/movies/${MOVIE_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Title *')).toHaveValue('Festival Film'));
    expect(screen.getByLabelText('External ticket URL')).toHaveValue('https://festival.example/tickets');
    fireEvent.click(screen.getByRole('button', { name: 'Update Movie' }));

    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0].op).toBe('update');
    expect(state.writes[0].payload).toMatchObject({
      ticket_type: 'rsvp',
      rsvp_url: 'https://festival.example/tickets',
    });
  });

  it('hides seat pricing and discounts for a film that sells nothing here', async () => {
    state.rows.movies = {
      id: MOVIE_ID, title: 'Festival Film', duration_minutes: 100, is_active: true,
      ticket_type: 'rsvp', rsvp_url: 'https://festival.example/tickets',
    };
    renderForm(`/admin/movies/${MOVIE_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Title *')).toHaveValue('Festival Film'));
    expect(screen.queryByText('SEAT PRICING')).toBeNull();
    expect(screen.queryByText('DISCOUNTS')).toBeNull();

    // And back again: the film is ticketed here after all.
    await choose('Ticketing *', 'Ticketed');
    expect(await screen.findByText('SEAT PRICING')).toBeTruthy();
    expect(screen.getByText('DISCOUNTS')).toBeTruthy();
  });
});

describe('MovieForm — where it goes after saving', () => {
  // BRIEF-listings-date-added-default. A new film has no showings, so the
  // default showtime sort would put it at the bottom of the list it was just
  // added to. The create redirect asks for date-added order; the edit redirect
  // does not, so editing never re-sorts the list.
  it('returns from a create sorted by date added, so the new film is on top', async () => {
    renderForm('/admin/movies/new');

    fireEvent.change(await screen.findByLabelText('Title *'), { target: { value: 'The Gold Rush' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Movie' }));

    expect(await screen.findByTestId('admin')).toHaveTextContent('admin dashboard?sort=newest');
  });

  it('returns from an edit without touching the sort', async () => {
    state.rows.movies = { id: MOVIE_ID, title: 'The Gold Rush', duration_minutes: 95, is_active: true };
    renderForm(`/admin/movies/${MOVIE_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Title *')).toHaveValue('The Gold Rush'));
    fireEvent.click(screen.getByRole('button', { name: 'Update Movie' }));

    expect(await screen.findByTestId('admin')).toHaveTextContent(/^admin dashboard$/);
  });
});

describe('MovieForm — the word is External, not RSVP', () => {
  it('offers External where an event form offers RSVP, for the same stored value', async () => {
    renderForm('/admin/movies/new');
    fireEvent.click(await screen.findByLabelText('Ticketing *'));
    expect(await screen.findByRole('option', { name: 'External' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'RSVP' })).toBeNull();
  });
});
