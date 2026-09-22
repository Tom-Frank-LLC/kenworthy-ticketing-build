import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
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
const EXTERNAL_MOVIE_ID = 'aaaaaaaa-2222-4000-8000-000000000002';
const VENUE_ID = 'vvvvvvvv-1111-4000-8000-000000000001';
const EVENT_ID = 'eeeeeeee-1111-4000-8000-000000000001';
const RSVP_EVENT_ID = 'eeeeeeee-1111-4000-8000-000000000002';
const PERFORMANCE_ID = 'cccccccc-1111-4000-8000-000000000001';
const MOVIE_PASS_ID = 'pppppppp-1111-4000-8000-000000000001';

const state = vi.hoisted(() => ({
  showingInserts: [] as any[],
  /** Every set_showing_price_tiers call, as { showingId, tiers }. */
  tierWrites: [] as Array<{ showingId: string; tiers: any[] }>,
  /** Any direct write to showing_price_tiers — there must never be one. */
  tierTableWrites: [] as string[],
  rpcCalls: [] as Array<{ fn: string; args: any }>,
  invokes: [] as Array<{ fn: string; body: any }>,
  eligibility: [] as Array<{ showingId: string; passTypeIds: string[] }>,
  /** start_time ISO → the message its insert should fail with. */
  insertFailures: {} as Record<string, string>,
  /** showing id → the message its tier write should fail with. */
  tierFailures: {} as Record<string, string>,
  squareResponse: null as any,
  existingShowings: [] as any[],
  /** Edit mode: the showing being edited, and its live tiers. */
  editShowing: null as any,
  existingTiers: [] as any[],
  passTypes: [] as any[],
  /** What the film picker lists. Reset to the one ticketed film before each test. */
  movies: [] as any[],
  toasts: { error: [] as string[], success: [] as string[], warning: [] as string[] },
}));

const DUNE = { id: MOVIE_ID, title: 'Dune', is_active: true, release_year: 1984, duration_minutes: 137, ticket_type: 'ticketed', rsvp_url: null };

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
  fetchAllRows: () => Promise.resolve({ data: state.movies, error: null }),
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
      filter: () => self,
      order: () => self,
      gte: () => self,
      lte: () => self,
      single: () => Promise.resolve({
        ...result,
        data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
      }),
      range: () => Promise.resolve(result),
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    };
    return self;
  };

  const rows = (table: string) => {
    if (table === 'venues') {
      return [{ id: VENUE_ID, name: 'Main Auditorium', has_assigned_seating: false, total_seats: 265 }];
    }
    if (table === 'showings') return state.editShowing ? [state.editShowing] : state.existingShowings;
    if (table === 'showing_price_tiers') return state.existingTiers;
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
        delete: () => {
          if (table === 'showing_price_tiers') state.tierTableWrites.push('delete');
          return chain({ data: null, error: null });
        },
        update: () => {
          if (table === 'showing_price_tiers') state.tierTableWrites.push('update');
          return chain({ data: null, error: null });
        },
        insert: (payload: any) => {
          if (table === 'showings') {
            state.showingInserts.push(payload);
            const failure = state.insertFailures[payload.start_time];
            if (failure) return chain({ data: null, error: { message: failure } });
            return chain({ data: { id: `showing-${state.showingInserts.length}` }, error: null });
          }
          if (table === 'showing_price_tiers') state.tierTableWrites.push('insert');
          return chain({ data: null, error: null });
        },
      }),
      rpc: (fn: string, args: any) => {
        state.rpcCalls.push({ fn, args });
        if (fn === 'set_showing_price_tiers') {
          state.tierWrites.push({ showingId: args.p_showing_id, tiers: args.p_tiers });
          const failure = state.tierFailures[args.p_showing_id];
          if (failure) return Promise.resolve({ data: null, error: { message: failure } });
          return Promise.resolve({
            data: args.p_tiers.map((t: any, i: number) => ({ id: `tier-${i}`, showing_id: args.p_showing_id, ...t, display_order: i, is_active: true })),
            error: null,
          });
        }
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
  state.tierWrites = [];
  state.tierTableWrites = [];
  state.rpcCalls = [];
  state.invokes = [];
  state.eligibility = [];
  state.insertFailures = {};
  state.tierFailures = {};
  // A clean planner response: something was planned and nothing fell short.
  state.squareResponse = { counts: { created: 2 }, tally: { written: 2 }, skipped: [] };
  state.existingShowings = [];
  state.editShowing = null;
  state.existingTiers = [];
  state.passTypes = [];
  state.movies = [DUNE];
  state.toasts = { error: [], success: [], warning: [] };
});

function LandedOnAdmin() {
  const [params] = useSearchParams();
  return (
    <div>
      <div>admin dashboard</div>
      <div>{`tab=${params.get('tab') ?? 'movies'}`}</div>
    </div>
  );
}

function renderForm(entry = '/admin/showings/new') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/showings/new" element={<ShowingForm />} />
        {/* The app mounts the form itself at /admin/showings/:id. Here that
            path stays a stub so the create tests can see where they landed,
            and edit mode gets its own path — the form only reads :id. */}
        <Route path="/admin/showings/:id/edit" element={<ShowingForm />} />
        <Route path="/admin/showings/:id" element={<div>showing detail</div>} />
        <Route path="/admin" element={<LandedOnAdmin />} />
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
    expect(state.tierWrites.map(w => w.showingId)).toEqual(['showing-1', 'showing-2', 'showing-3']);
    expect(state.tierTableWrites).toEqual([]);
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
  it('says nothing about category from Movies — not even as a readout', async () => {
    renderForm('/admin/showings/new?kind=movie');

    await waitFor(() => expect(screen.getByLabelText('Movie *')).toBeInTheDocument());
    // Neither the selector nor the "Category: Movie" line it was replaced by.
    // With one category and no way out of it, both answer a question the admin
    // was never asked, and the picker underneath already says Movie.
    expect(screen.queryByText('Category *')).toBeNull();
    expect(screen.queryByText('Category')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create Showing' })).toBeInTheDocument();
  });

  it('says nothing about category when opened from a film’s own card either', async () => {
    renderForm(`/admin/showings/new?kind=movie&movie=${MOVIE_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Movie *')).toHaveTextContent('Dune'));
    expect(screen.queryByText('Category')).toBeNull();
  });

  it('keeps the readout on the live side, where there is another category', async () => {
    renderForm(`/admin/showings/new?kind=live&event=${EVENT_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Event *')).toHaveTextContent('Gala Night'));
    // Here it earns its place: a performance is one click away.
    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
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

/**
 * Closing the form should put you back where you were working.
 *
 * `?tab=` names the listing sub-tab and falls back to Movies when absent, so
 * every exit here went to a bare `/admin` and dropped anyone mid-way through
 * scheduling a run of concerts back onto the film list.
 */
describe('ShowingForm — closing returns to the listing you came from', () => {
  it('goes back to Live Events from a show', async () => {
    renderForm('/admin/showings/new?kind=live');
    fireEvent.click(await screen.findByRole('button', { name: '← Back' }));
    expect(await screen.findByText(/tab=live-events/)).toBeInTheDocument();
  });

  it('goes back to Movies from a showing', async () => {
    renderForm('/admin/showings/new?kind=movie');
    fireEvent.click(await screen.findByRole('button', { name: '← Back' }));
    expect(await screen.findByText(/tab=movies/)).toBeInTheDocument();
  });

  it('lands on Live Events after actually saving a run of shows', async () => {
    renderForm(`/admin/showings/new?kind=live&event=${EVENT_ID}`);
    await waitFor(() => expect(screen.getByLabelText('Event *')).toHaveTextContent('Gala Night'));
    fillShowtimes(['2026-09-12T19:30', '2026-09-13T19:30']);
    submit();

    // A clean batch leaves the form on its own, so there is no Done to press.
    await waitFor(() => expect(state.showingInserts).toHaveLength(2));
    expect(await screen.findByText('admin dashboard')).toBeInTheDocument();
    expect(screen.getByText(/tab=live-events/)).toBeInTheDocument();
  });
});

describe('ShowingForm — online ticket limit per buyer', () => {
  async function createWith(setup: () => void) {
    renderForm();
    await chooseMovie();
    fireEvent.change(screen.getByLabelText('Base Ticket Price ($)'), { target: { value: '10' } });
    fillShowtimes(['2026-08-14T19:30']);
    setup();
    submit();
    await waitFor(() => expect(state.showingInserts).toHaveLength(1));
    return state.showingInserts[0];
  }

  it('defaults to 20', async () => {
    expect((await createWith(() => {})).max_tickets_per_buyer).toBe(20);
  });

  it('can be tightened for one showing', async () => {
    const row = await createWith(() =>
      fireEvent.change(screen.getByLabelText('Online ticket limit per buyer'), { target: { value: '6' } }));
    expect(row.max_tickets_per_buyer).toBe(6);
  });

  it('is removed — saved as NULL — only by ticking "No limit"', async () => {
    const row = await createWith(() => fireEvent.click(screen.getByLabelText(/No limit/)));
    expect(row.max_tickets_per_buyer).toBeNull();
  });

  it('a blank or nonsense number falls back to 20, never to unlimited', async () => {
    const row = await createWith(() =>
      fireEvent.change(screen.getByLabelText('Online ticket limit per buyer'), { target: { value: '' } }));
    expect(row.max_tickets_per_buyer).toBe(20);
  });
});

describe('ShowingForm — editing the price tiers of a showing that has sold', () => {
  const SHOWING_ID = 'e53371fe-5b04-491f-8e04-198482a2bbe5';

  beforeEach(() => {
    state.editShowing = {
      id: SHOWING_ID, movie_id: MOVIE_ID, event_id: null, live_performance_id: null,
      venue_id: VENUE_ID, start_time: '2026-09-26T02:00:00+00:00', ticket_price: 50,
      duration_minutes: null, requires_seat_selection: false, no_ticket_required: false,
      manually_sold_out: false, max_tickets_per_buyer: 20, sold_out_message: null, is_featured: false,
    };
    state.existingTiers = [
      { id: 'ga', showing_id: SHOWING_ID, tier_name: 'General Admission', price: 50, display_order: 0, is_active: true },
      { id: 'ps', showing_id: SHOWING_ID, tier_name: 'Preferred Seating', price: 75, display_order: 1, is_active: true },
    ];
  });

  async function openForEdit() {
    renderForm(`/admin/showings/${SHOWING_ID}/edit`);
    await waitFor(() => expect(screen.getByDisplayValue('Preferred Seating')).toBeInTheDocument());
  }

  it('deleting a tier and saving reconciles once, with the survivor — never a delete-and-reinsert', async () => {
    // The regression. Delete-then-insert failed at the delete (a sold tier
    // cannot be deleted), swallowed it, and appended: General Admission ×4.
    await openForEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Remove tier Preferred Seating' }));
    expect(screen.queryByDisplayValue('Preferred Seating')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Update Showing' }));

    await waitFor(() => expect(state.toasts.success).toContain('Showing updated!'));
    expect(state.tierWrites).toEqual([
      { showingId: SHOWING_ID, tiers: [{ tier_name: 'General Admission', price: 50 }] },
    ]);
    expect(state.tierTableWrites).toEqual([]);
  });

  it('a refused tier write is reported, not swallowed', async () => {
    state.tierFailures[SHOWING_ID] = 'Two tiers are named "General Admission"';
    await openForEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Update Showing' }));

    await waitFor(() => expect(state.toasts.error).toHaveLength(1));
    expect(state.toasts.error[0]).toMatch(/tiers failed: Two tiers are named/);
    expect(state.toasts.success).toEqual([]);
  });

  it('unticking tiered pricing sends an empty list, so sold tiers are retired rather than deleted', async () => {
    await openForEdit();
    fireEvent.click(screen.getByLabelText('Enable tiered pricing'));
    fireEvent.click(screen.getByRole('button', { name: 'Update Showing' }));

    await waitFor(() => expect(state.toasts.success).toContain('Showing updated!'));
    expect(state.tierWrites).toEqual([{ showingId: SHOWING_ID, tiers: [] }]);
    expect(state.tierTableWrites).toEqual([]);
  });
});

/**
 * A film ticketed somewhere else still takes showings — the dates are what put
 * it on the calendar — but nothing about a sale: no price, no tiers, no
 * passes, no sold-out switch, and no Square item, because price_ticket_order
 * refuses every sale against it and a variation nothing can reference is dead
 * weight in the catalog. BRIEF-movie-external-ticketing.
 */
describe('ShowingForm — a film whose tickets are not sold here', () => {
  const FESTIVAL = {
    id: EXTERNAL_MOVIE_ID, title: 'Festival Film', is_active: true, release_year: 2026,
    duration_minutes: 100, ticket_type: 'rsvp', rsvp_url: 'https://festival.example/tickets',
  };

  it('replaces the pricing controls with the fact, and keeps the date', async () => {
    state.movies = [DUNE, FESTIVAL];
    renderForm(`/admin/showings/new?movie=${EXTERNAL_MOVIE_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Movie *')).toHaveTextContent('Festival Film'));
    expect(await screen.findByText('External ticketing')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'https://festival.example/tickets' })).toBeTruthy();
    expect(screen.queryByLabelText('Base Ticket Price ($)')).toBeNull();
    expect(screen.queryByText('Price Tiers')).toBeNull();
    expect(screen.queryByText(/Accept passes at the door/)).toBeNull();
    expect(screen.queryByText(/Sold out — close online sales/)).toBeNull();
    expect(screen.queryByLabelText('Online ticket limit per buyer')).toBeNull();
    // The date is the point, and it is still asked for.
    expect(screen.getByLabelText('Showtime 1')).toBeTruthy();
  });

  it('creates the showing with nothing sale-shaped on it, and never calls Square', async () => {
    state.movies = [DUNE, FESTIVAL];
    state.passTypes = [{ id: 'pass-std', name: 'Film Pass', redemption_price: 6, per_showing_use_limit: null, is_active: true, is_default_for_movies: true }];
    renderForm(`/admin/showings/new?movie=${EXTERNAL_MOVIE_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Movie *')).toHaveTextContent('Festival Film'));
    fillShowtimes(['2026-10-03T19:30']);
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(1));
    const row = state.showingInserts[0];
    expect(row.movie_id).toBe(EXTERNAL_MOVIE_ID);
    // Not a walk-in night: that flag says "Free — no ticket needed", which is a
    // different fact from "tickets are sold over there".
    expect(row.no_ticket_required).toBe(false);
    expect(row.requires_seat_selection).toBe(false);
    expect(row.manually_sold_out).toBe(false);

    await waitFor(() => expect(state.eligibility).toHaveLength(1));
    expect(state.eligibility[0].passTypeIds).toEqual([]);
    // Tiers cleared rather than written — the production template may have seeded some.
    expect(state.tierWrites).toHaveLength(1);
    expect(state.tierWrites[0].tiers).toEqual([]);
    expect(state.invokes.filter(i => i.fn === 'square-showing-variations')).toHaveLength(0);
  });

  it('still prices and tells Square about an ordinary film chosen the same way', async () => {
    state.movies = [DUNE, FESTIVAL];
    renderForm(`/admin/showings/new?movie=${MOVIE_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Movie *')).toHaveTextContent('Dune'));
    expect(screen.getByLabelText('Base Ticket Price ($)')).toBeTruthy();
    expect(screen.queryByText('External ticketing')).toBeNull();
    fillShowtimes(['2026-10-03T19:30']);
    submit();

    await waitFor(() => expect(state.showingInserts).toHaveLength(1));
    await waitFor(() => expect(state.invokes.filter(i => i.fn === 'square-showing-variations')).toHaveLength(1));
  });
});
