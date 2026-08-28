import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { venueLocalToInstant } from '@/lib/datetime';

/** The instant the form will actually send for a wall clock, as it computes it. */
const instant = (naive: string) => venueLocalToInstant(naive).toISOString();

/**
 * The batch create loop.
 *
 * `showtimeBatch.test.ts` covers the arithmetic and the summary sentences. What
 * is left — and what the feature actually is — is that the *whole* per-showing
 * sequence runs once per showtime: the insert, the production template, the
 * price tiers, the pass eligibility and the Square call. Getting three showings
 * out of three rows while only the first one gets its tiers would be invisible
 * in the UI and visible at the box office.
 *
 * The other half is partial failure. There is no transaction behind a batch, so
 * a run can stop in the middle; these tests pin down that it says so, that the
 * showings either side of the failure survive, and that the row that failed
 * stays in the form rather than being quietly dropped after a "Created!".
 */

beforeAll(() => {
  // jsdom implements neither, and both are reached by Radix's popper and
  // cmdk's "keep the active item in view".
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const MOVIE_ID = 'aaaaaaaa-1111-4000-8000-000000000001';
const VENUE_ID = 'vvvvvvvv-1111-4000-8000-000000000001';
const EVENT_ID = 'eeeeeeee-1111-4000-8000-000000000001';
const RSVP_EVENT_ID = 'eeeeeeee-1111-4000-8000-000000000002';
const PERFORMANCE_ID = 'cccccccc-1111-4000-8000-000000000001';
const MOVIE_PASS_ID = 'pppppppp-1111-4000-8000-000000000001';

const state = vi.hoisted(() => ({
  showingInserts: [] as any[],
  tierInserts: [] as any[],
  rpcCalls: [] as Array<{ fn: string; args: any }>,
  invokes: [] as Array<{ fn: string; body: any }>,
  eligibility: [] as Array<{ showingId: string; passTypeIds: string[] }>,
  /** start_time ISO → the message its insert should fail with. */
  insertFailures: {} as Record<string, string>,
  /** start_time ISO → the message its tier insert should fail with. */
  tierFailures: {} as Record<string, string>,
  squareResponse: null as any,
  existingShowings: [] as any[],
  passTypes: [] as any[],
  toasts: { error: [] as string[], success: [] as string[], warning: [] as string[] },
}));

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ isAdmin: true, loading: false }) }));

vi.mock('sonner', () => ({
  toast: {
    error: (m: string) => state.toasts.error.push(m),
    success: (m: string) => state.toasts.success.push(m),
    warning: (m: string) => state.toasts.warning.push(m),
  },
}));

// Never rendered by these tests — the venue is general admission — but mocked so
// a change that starts rendering it fails on the assertion rather than on a
// missing seat map.
vi.mock('@/components/admin/SeatTierEditor', () => ({ SeatTierEditor: () => null }));

vi.mock('@/lib/fetchAllRows', () => ({
  fetchAllRows: () =>
    Promise.resolve({ data: [{ id: MOVIE_ID, title: 'Dune', is_active: true, release_year: 1984, duration_minutes: 137 }], error: null }),
}));

vi.mock('@/lib/passEligibility', () => ({
  STANDARD_MOVIE_TICKET_PRICE: 8,
  fetchPassTypes: () => Promise.resolve(state.passTypes),
  fetchShowingEligibility: () => Promise.resolve([]),
  setShowingEligibility: (showingId: string, passTypeIds: string[]) => {
    state.eligibility.push({ showingId, passTypeIds });
    return Promise.resolve();
  },
}));

vi.mock('@/integrations/supabase/client', () => {
  const chain = (result: any): any => {
    const self: any = {
      select: () => self,
      eq: () => self,
      in: () => self,
      order: () => self,
      gte: () => self,
      lte: () => self,
      single: () => Promise.resolve(result),
      range: () => Promise.resolve(result),
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    };
    return self;
  };

  const rows = (table: string) => {
    if (table === 'venues') {
      return [{ id: VENUE_ID, name: 'Main Auditorium', has_assigned_seating: false, total_seats: 265 }];
    }
    if (table === 'showings') return state.existingShowings;
    if (table === 'events') {
      return [
        { id: EVENT_ID, title: 'Gala Night', ticket_type: 'ticketed', is_active: true },
        // Non-ticketed, so the form's own filter drops it — the case a
        // hand-edited ?event= can still name.
        { id: RSVP_EVENT_ID, title: 'Community Potluck', ticket_type: 'rsvp', is_active: true },
      ];
    }
    if (table === 'live_performances') {
      return [
        { id: PERFORMANCE_ID, title: 'Palouse Jazz Quartet', ticket_type: 'ticketed', is_active: true },
      ];
    }
    return [];
  };

  return {
    supabase: {
      from: (table: string) => ({
        select: () => chain({ data: rows(table), error: null }),
        delete: () => chain({ data: null, error: null }),
        update: () => chain({ data: null, error: null }),
        insert: (payload: any) => {
          if (table === 'showings') {
            state.showingInserts.push(payload);
            const failure = state.insertFailures[payload.start_time];
            if (failure) return chain({ data: null, error: { message: failure } });
            return chain({ data: { id: `showing-${state.showingInserts.length}` }, error: null });
          }
          if (table === 'showing_price_tiers') {
            state.tierInserts.push(payload);
            const showingId = payload[0]?.showing_id;
            const failure = state.tierFailures[showingId];
            return chain({ data: null, error: failure ? { message: failure } : null });
          }
          return chain({ data: null, error: null });
        },
      }),
      rpc: (fn: string, args: any) => {
        state.rpcCalls.push({ fn, args });
        return Promise.resolve({ data: null, error: null });
      },
      functions: {
        invoke: (fn: string, opts: any) => {
          state.invokes.push({ fn, body: opts?.body });
          return Promise.resolve({ data: state.squareResponse, error: null });
        },
      },
    },
  };
});

const { default: ShowingForm } = await import('./ShowingForm');

beforeEach(() => {
  state.showingInserts = [];
  state.tierInserts = [];
  state.rpcCalls = [];
  state.invokes = [];
  state.eligibility = [];
  state.insertFailures = {};
  state.tierFailures = {};
  // A clean planner response: something was planned and nothing fell short.
  state.squareResponse = { counts: { created: 2 }, tally: { written: 2 }, skipped: [] };
  state.existingShowings = [];
  state.passTypes = [];
  state.toasts = { error: [], success: [], warning: [] };
});

function renderForm(entry = '/admin/showings/new') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/showings/new" element={<ShowingForm />} />
        <Route path="/admin/showings/:id" element={<div>showing detail</div>} />
        <Route path="/admin" element={<div>admin dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Pick the one film, so the form has an item and will submit. */
async function chooseMovie() {
  const trigger = await screen.findByLabelText('Movie *');
  fireEvent.click(trigger);
  const option = await screen.findByText('Dune');
  fireEvent.click(option);
  await waitFor(() => expect(screen.getByLabelText('Movie *')).toHaveTextContent('Dune'));
}

/** Fill the list with `values`, adding rows as needed. */
function fillShowtimes(values: string[]) {
  values.forEach((value, i) => {
    if (i > 0) fireEvent.click(screen.getByRole('button', { name: /add another showtime/i }));
    fireEvent.change(screen.getByLabelText(`Showtime ${i + 1}`), { target: { value } });
  });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /^Create/ }));
}

const startTimes = () => state.showingInserts.map(s => s.start_time);

describe('ShowingForm — creating several showtimes at once', () => {
  it('runs the whole per-showing sequence once per showtime', async () => {
    renderForm();
    await chooseMovie();
    fillShowtimes(['2026-08-14T19:30', '2026-08-15T19:30', '2026-08-16T14:00']);
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(3));

    // Every side effect, per showing — not just for the first one.
    expect(state.rpcCalls.filter(c => c.fn === 'apply_production_template_to_showing')).toHaveLength(3);
    expect(state.tierInserts).toHaveLength(3);
    expect(state.eligibility).toHaveLength(3);
    expect(state.invokes.filter(i => i.fn === 'square-showing-variations')).toHaveLength(3);
    expect(state.invokes.map(i => i.body.showing_id)).toEqual(['showing-1', 'showing-2', 'showing-3']);
  });

  it('gives every showing in the batch the same shared config', async () => {
    renderForm();
    await chooseMovie();
    fireEvent.change(screen.getByLabelText('Base Ticket Price ($)'), { target: { value: '12.50' } });
    fillShowtimes(['2026-08-14T19:30', '2026-08-15T19:30']);
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(2));
    for (const row of state.showingInserts) {
      expect(row.movie_id).toBe(MOVIE_ID);
      expect(row.venue_id).toBe(VENUE_ID);
      expect(row.ticket_price).toBe(12.5);
      expect(row.requires_seat_selection).toBe(false);
      // Capacity comes from the room, on every showing and not only the first.
      expect(row.total_seats).toBe(265);
    }
    // Only the date differs.
    expect(new Set(startTimes()).size).toBe(2);
  });

  it('creates the showings oldest first however they were typed', async () => {
    renderForm();
    await chooseMovie();
    fillShowtimes(['2026-08-16T19:30', '2026-08-14T19:30', '2026-08-15T19:30']);
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(3));
    expect(startTimes()).toEqual([...startTimes()].sort());
  });

  it('writes one showing for a datetime listed twice, and says it will', async () => {
    renderForm();
    await chooseMovie();
    fillShowtimes(['2026-08-14T19:30', '2026-08-14T19:30']);

    expect(await screen.findByText(/already listed above/i)).toBeInTheDocument();
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(1));
  });

  it('leaves the form for the admin list when every showtime landed', async () => {
    // Staying put read as failure: the summary renders above a form the admin
    // is scrolled to the bottom of, so the only visible change was their
    // filled-in fields going blank behind a success toast.
    renderForm();
    await chooseMovie();
    fillShowtimes(['2029-11-06T19:30', '2029-11-07T19:30', '2029-11-08T19:30']);
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(3));
    await waitFor(() => expect(screen.getByText('admin dashboard')).toBeInTheDocument());
    expect(state.toasts.success).toContain('Created 3 showtimes.');
    // No summary to leave behind when there is nothing on it to act on.
    expect(screen.queryByText(/Created 3 of 3/)).not.toBeInTheDocument();
  });

  it('reports Square once for the batch rather than once per showing', async () => {
    // Every showing shares one title, so the planner says the same thing about
    // all three. Three identical toasts say nothing the first one did not.
    state.squareResponse = { counts: { needs_item: 1 }, tally: {}, skipped: [] };
    renderForm();
    await chooseMovie();
    fillShowtimes(['2026-08-14T19:30', '2026-08-15T19:30', '2026-08-16T19:30']);
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(3));
    await waitFor(() => expect(state.toasts.warning.length).toBeGreaterThan(0));

    // Square falling short does not hold the admin on the form — the showings
    // were all created, and the one warning says what is owed.
    await waitFor(() => expect(screen.getByText('admin dashboard')).toBeInTheDocument());
    const squareWarnings = state.toasts.warning.filter(m => m.includes('Square'));
    expect(squareWarnings).toHaveLength(1);
    expect(squareWarnings[0]).toContain('3 showtimes');
  });
});

describe('ShowingForm — a batch that partly fails', () => {
  it('keeps the showings either side of a failed insert and counts them honestly', async () => {
    // Keyed by the instant the form actually sends — the wall clock read in the
    // venue's zone, via the same helper the form uses.
    state.insertFailures = { [instant('2026-08-15T19:30')]: 'venue is already booked' };
    renderForm();
    await chooseMovie();
    fillShowtimes(['2026-08-14T19:30', '2026-08-15T19:30', '2026-08-16T19:30']);
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(3));
    await waitFor(() => expect(screen.getByText('Created 2 of 3 showtimes.')).toBeInTheDocument());

    // Not a blanket success, and the reason is named.
    expect(state.toasts.success).toHaveLength(0);
    expect(await screen.findByText(/venue is already booked/)).toBeInTheDocument();
    expect(screen.getByText('Not created')).toBeInTheDocument();
    // Stays on the form: there is a failed row here to retry.
    expect(screen.queryByText('admin dashboard')).not.toBeInTheDocument();
  });

  it('leaves only the failed row in the form, ready to try again', async () => {
    state.insertFailures = { [instant('2026-08-15T19:30')]: 'nope' };
    renderForm();
    await chooseMovie();
    fillShowtimes(['2026-08-14T19:30', '2026-08-15T19:30']);
    submit();

    await waitFor(() => expect(screen.getByText('Created 1 of 2 showtimes.')).toBeInTheDocument());
    // One row left, holding the datetime that failed — so pressing Create again
    // retries that night and cannot double-create the one that worked.
    await waitFor(() => {
      expect(screen.getByLabelText('Showtime 1')).toHaveValue('2026-08-15T19:30');
    });
    expect(screen.queryByLabelText('Showtime 2')).not.toBeInTheDocument();
  });

  it('calls a showing whose tiers failed created-but-unfinished, not failed', async () => {
    // The showing exists and will sell. Reporting it as failed would invite a
    // retry, and the retry would put two showings on the same night.
    state.tierFailures['showing-2'] = 'connection reset';
    renderForm();
    await chooseMovie();
    fillShowtimes(['2026-08-14T19:30', '2026-08-15T19:30']);
    submit();

    await waitFor(() => expect(screen.getByText('Created 2 of 2 showtimes.')).toBeInTheDocument());
    expect(screen.getByText('Created, but not finished')).toBeInTheDocument();
    expect(screen.getByText(/price tiers failed — connection reset/)).toBeInTheDocument();
    expect(screen.queryByText('Not created')).not.toBeInTheDocument();
    // Nothing is left in the form to retry — retrying is the wrong move here.
    expect(screen.getByLabelText('Showtime 1')).toHaveValue('');
    // But it still stays, because an unfinished showing needs opening.
    expect(screen.queryByText('admin dashboard')).not.toBeInTheDocument();
  });
});

describe('ShowingForm — one showtime is still the form it always was', () => {
  it('creates one showing and navigates to it, with no batch summary', async () => {
    renderForm();
    await chooseMovie();
    fillShowtimes(['2026-08-14T19:30']);
    expect(screen.getByRole('button', { name: 'Create Showing' })).toBeInTheDocument();
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(1));
    await waitFor(() => expect(screen.getByText('showing detail')).toBeInTheDocument());
    expect(state.toasts.success).toContain('Showing created!');
  });

  it('names the count on the button once there is more than one', async () => {
    renderForm();
    await chooseMovie();
    fillShowtimes(['2026-08-14T19:30', '2026-08-15T19:30', '2026-08-16T19:30']);
    expect(screen.getByRole('button', { name: 'Create 3 Showtimes' })).toBeInTheDocument();
  });
});

/**
 * The deep link that makes Live Events usable.
 *
 * Adding a showing to a concert used to mean opening the *Movies* tab, pressing
 * Add Showing, switching the category and hunting the title out of a picker —
 * the Live Events listing offered no way in at all. Each card now links here
 * pre-scoped, so these pin down that the scope actually lands on the right
 * foreign key, and that the one path which never touches the category selector
 * still gets what switching that selector by hand would have done.
 */
describe('ShowingForm — opened from a title’s card', () => {
  it('attaches the showing to the performance named in the URL', async () => {
    renderForm(`/admin/showings/new?performance=${PERFORMANCE_ID}`);

    await waitFor(() =>
      expect(screen.getByLabelText('Live Performance *')).toHaveTextContent('Palouse Jazz Quartet'),
    );
    // The category is settled by the link, so it is stated rather than offered.
    expect(screen.queryByText('Category *')).toBeNull();

    fillShowtimes(['2026-09-12T19:30']);
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(1));
    expect(state.showingInserts[0].live_performance_id).toBe(PERFORMANCE_ID);
    expect(state.showingInserts[0].movie_id).toBeNull();
    expect(state.showingInserts[0].event_id).toBeNull();
  });

  it('attaches the showing to the event named in the URL', async () => {
    renderForm(`/admin/showings/new?event=${EVENT_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Event *')).toHaveTextContent('Gala Night'));

    fillShowtimes(['2026-09-12T19:30']);
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(1));
    expect(state.showingInserts[0].event_id).toBe(EVENT_ID);
    expect(state.showingInserts[0].live_performance_id).toBeNull();
  });

  it('still works for a movie, which is what the Movies card links to', async () => {
    renderForm(`/admin/showings/new?movie=${MOVIE_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Movie *')).toHaveTextContent('Dune'));

    fillShowtimes(['2026-09-12T19:30']);
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(1));
    expect(state.showingInserts[0].movie_id).toBe(MOVIE_ID);
  });

  it('leaves the standard film passes off a performance, as switching category does', async () => {
    state.passTypes = [
      {
        id: MOVIE_PASS_ID,
        name: 'Standard',
        redemption_price: 8,
        per_showing_use_limit: null,
        is_default_for_movies: true,
        is_active: true,
      },
    ];
    renderForm(`/admin/showings/new?performance=${PERFORMANCE_ID}`);

    await waitFor(() =>
      expect(screen.getByLabelText('Live Performance *')).toHaveTextContent('Palouse Jazz Quartet'),
    );
    fillShowtimes(['2026-09-12T19:30']);
    submit();

    // Pre-ticking here would make a concert redeemable against a film pass
    // without anyone choosing that — the form's one path that never passes
    // through the category selector where the same default is dropped.
    await waitFor(() => expect(state.eligibility).toHaveLength(1));
    expect(state.eligibility[0].passTypeIds).toEqual([]);
  });

  it('still ticks the standard passes for a movie opened the same way', async () => {
    state.passTypes = [
      {
        id: MOVIE_PASS_ID,
        name: 'Standard',
        redemption_price: 8,
        per_showing_use_limit: null,
        is_default_for_movies: true,
        is_active: true,
      },
    ];
    renderForm(`/admin/showings/new?movie=${MOVIE_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Movie *')).toHaveTextContent('Dune'));
    fillShowtimes(['2026-09-12T19:30']);
    submit();

    await waitFor(() => expect(state.eligibility).toHaveLength(1));
    expect(state.eligibility[0].passTypeIds).toEqual([MOVIE_PASS_ID]);
  });

  it('hands back the pickers when the URL names a title that cannot take a showing', async () => {
    // An RSVP event: the listing offers no Add Showing for one, but the URL can
    // still be typed. Without this it would open on an empty, unchangeable
    // picker with no way out.
    renderForm(`/admin/showings/new?event=${RSVP_EVENT_ID}`);

    await waitFor(() => expect(state.toasts.error).toHaveLength(1));
    expect(state.toasts.error[0]).toMatch(/cannot take a show/i);
    expect(await screen.findByText('Category *')).toBeInTheDocument();
  });
});

/**
 * Which listing sent us here.
 *
 * One selector used to offer Movie, Event and Live Performance from wherever
 * the form was opened, which is why dating a concert began in the Movies tab.
 * A showing belongs to exactly one listing, so the form only ever offers that
 * listing's categories now — and calls the row what that listing calls it.
 */
describe('ShowingForm — scoped to the listing it was opened from', () => {
  it('offers no category at all from Movies, because there is only one', async () => {
    renderForm('/admin/showings/new?kind=movie');

    await waitFor(() => expect(screen.getByLabelText('Movie *')).toBeInTheDocument());
    expect(screen.queryByText('Category *')).toBeNull();
    // Nothing to switch to, so no way to reach an event from here.
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create Showing' })).toBeInTheDocument();
  });

  it('offers events and performances from Live Events, and never a film', async () => {
    renderForm('/admin/showings/new?kind=live');

    expect(await screen.findByText('Category *')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: /category/i }));

    expect(await screen.findByRole('option', { name: 'Event' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Live Performance' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Movie' })).toBeNull();
  });

  it('calls it a Show on the live side and a Showing on the film side', async () => {
    const live = renderForm('/admin/showings/new?kind=live');
    expect(await screen.findByRole('button', { name: 'Create Show' })).toBeInTheDocument();
    live.unmount();

    renderForm('/admin/showings/new?kind=movie');
    expect(await screen.findByRole('button', { name: 'Create Showing' })).toBeInTheDocument();
  });

  it('still writes the right foreign key when scoped from Live Events', async () => {
    renderForm(`/admin/showings/new?kind=live&event=${EVENT_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Event *')).toHaveTextContent('Gala Night'));
    fillShowtimes(['2026-09-12T19:30']);
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(1));
    expect(state.showingInserts[0].event_id).toBe(EVENT_ID);
    expect(state.showingInserts[0].movie_id).toBeNull();
  });
});
