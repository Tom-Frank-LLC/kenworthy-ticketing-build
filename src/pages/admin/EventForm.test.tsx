import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * One form for a live event.
 *
 * There were two — Add Event and Add Performance — writing to two tables and
 * differing by one field each. What they were really asking was two separate
 * questions that neither table could hold together: what the thing is, and how
 * people get in. These pin down that both are asked once, that both are
 * written, and that an existing performance row is still editable through the
 * same form without being offered a type its own enum cannot store.
 */

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const EVENT_ID = 'eeeeeeee-1111-4000-8000-000000000001';
const PERF_ID = 'cccccccc-1111-4000-8000-000000000001';

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
vi.mock('@/components/admin/SeatTierEditor', () => ({ SeatTierEditor: () => null }));
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

const { default: EventForm } = await import('./EventForm');

beforeEach(() => {
  state.writes = [];
  state.rows = {};
  state.toasts = { error: [], success: [] };
});

function renderForm(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/events/new" element={<EventForm />} />
        <Route path="/admin/events/:id" element={<EventForm />} />
        <Route path="/admin/concerts/:id" element={<EventForm />} />
        <Route path="/admin" element={<div>admin dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function choose(label: string, option: string) {
  fireEvent.click(await screen.findByLabelText(label));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('EventForm — one form, both questions', () => {
  it('asks what it is and how people get in, and writes both', async () => {
    renderForm('/admin/events/new');

    fireEvent.change(await screen.findByLabelText('Title *'), { target: { value: 'Palouse Jazz' } });
    await choose('Type *', 'Concert');
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0].table).toBe('events');
    expect(state.writes[0].op).toBe('insert');
    expect(state.writes[0].payload.subcategory).toBe('concert');
    expect(state.writes[0].payload.ticket_type).toBe('ticketed');
  });

  it('stores the combination neither table could hold: an RSVP concert', async () => {
    renderForm('/admin/events/new');

    fireEvent.change(await screen.findByLabelText('Title *'), { target: { value: 'Community Concert' } });
    await choose('Type *', 'Concert');
    await choose('Ticketing *', 'RSVP');
    fireEvent.change(screen.getByLabelText('RSVP URL'), { target: { value: 'https://example.org/rsvp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0].payload).toMatchObject({
      subcategory: 'concert',
      ticket_type: 'rsvp',
      rsvp_url: 'https://example.org/rsvp',
    });
  });

  it('drops a stale RSVP link when the mode moves back to ticketed', async () => {
    renderForm('/admin/events/new');

    fireEvent.change(await screen.findByLabelText('Title *'), { target: { value: 'Gala' } });
    await choose('Type *', 'Theatre');
    await choose('Ticketing *', 'RSVP');
    fireEvent.change(screen.getByLabelText('RSVP URL'), { target: { value: 'https://example.org/old' } });
    await choose('Ticketing *', 'Ticketed');
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

    await waitFor(() => expect(state.writes).toHaveLength(1));
    // Left behind, the site would still render a booking link for a showing
    // people are meant to buy a ticket for.
    expect(state.writes[0].payload.rsvp_url).toBeNull();
  });

  it('refuses to save without a type rather than inventing one', async () => {
    renderForm('/admin/events/new');

    fireEvent.change(await screen.findByLabelText('Title *'), { target: { value: 'Untyped' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

    await waitFor(() => expect(state.toasts.error).toHaveLength(1));
    expect(state.writes).toHaveLength(0);
  });

  it('offers every type on an events row, including a screening', async () => {
    state.rows.events = { id: EVENT_ID, title: 'Nutcracker', ticket_type: 'ticketed', subcategory: 'dance', is_active: true };
    renderForm(`/admin/events/${EVENT_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Title *')).toHaveValue('Nutcracker'));
    fireEvent.click(screen.getByLabelText('Type *'));
    expect(await screen.findByRole('option', { name: 'Film screening' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dance' })).toBeInTheDocument();
  });

  it('edits a legacy performance in place, offering only types its enum holds', async () => {
    state.rows.live_performances = {
      id: PERF_ID, title: 'Giant Palouse Earthworm', subcategory: 'concert',
      ticket_type: 'ticketed', is_active: true,
    };
    renderForm(`/admin/concerts/${PERF_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Title *')).toHaveValue('Giant Palouse Earthworm'));
    fireEvent.click(screen.getByLabelText('Type *'));
    expect(await screen.findByRole('option', { name: 'Concert' })).toBeInTheDocument();
    // live_performance_subcategory has no such value — offering it would fail
    // at the database rather than in the form.
    expect(screen.queryByRole('option', { name: 'Film screening' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Community event' })).toBeNull();
  });

  it('updates the legacy row in its own table, never moving it', async () => {
    state.rows.live_performances = {
      id: PERF_ID, title: 'Giant Palouse Earthworm', subcategory: 'concert',
      ticket_type: 'ticketed', is_active: true,
    };
    renderForm(`/admin/concerts/${PERF_ID}`);

    await waitFor(() => expect(screen.getByLabelText('Title *')).toHaveValue('Giant Palouse Earthworm'));
    fireEvent.click(screen.getByRole('button', { name: 'Update Event' }));

    await waitFor(() => expect(state.writes).toHaveLength(1));
    // Its showings, Square link and seat tiers all hang off this id.
    expect(state.writes[0].table).toBe('live_performances');
    expect(state.writes[0].op).toBe('update');
  });
});
