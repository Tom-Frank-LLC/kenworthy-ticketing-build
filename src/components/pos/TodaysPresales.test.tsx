import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * What "today" means, and what counts as sold.
 *
 * Both are easy to get wrong in ways that look right. The day window is the
 * dangerous one: `start_time` is a UTC instant, so on any evening show the UTC
 * date has already rolled over to tomorrow while the venue is still in today.
 * A window built from UTC dates — or from the *viewer's* midnight, which is a
 * different instant on a laptop set to Mountain — drops the current evening's
 * screenings and pulls in last night's. The panel would still render, with the
 * wrong showings, on exactly the nights it exists for.
 *
 * The fixture time below is chosen so the two disagree: 02:00 UTC on 2 Sep is
 * 7 PM Pacific on 1 Sep.
 */

const calls: any[][] = [];
const tables: Record<string, any[]> = {};

vi.mock('@/integrations/supabase/client', () => {
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'is', 'or']) {
      b[m] = (...args: any[]) => {
        calls.push([table, m, ...args]);
        return b;
      };
    }
    b.range = () => Promise.resolve({ data: tables[table] ?? [], error: null });
    return b;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});

const { TodaysPresales } = await import('./TodaysPresales');

const argOf = (table: string, method: string) =>
  calls.find(c => c[0] === table && c[1] === method)?.slice(2);

describe('TodaysPresales', () => {
  beforeEach(() => {
    calls.length = 0;
    for (const k of Object.keys(tables)) delete tables[k];
    // Only Date is faked. Faking the timer queue too stalls waitFor, which
    // polls on a real setInterval.
    vi.useFakeTimers({ toFake: ['Date'] });
    // 7 PM Pacific on 1 Sep 2026 — already 2 Sep in UTC.
    vi.setSystemTime(new Date('2026-09-02T02:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for the venue-local day, not the UTC one', async () => {
    render(<TodaysPresales />);
    await waitFor(() => expect(argOf('showings', 'gte')).toBeTruthy());

    // 1 Sep 00:00 Pacific (PDT, UTC-7) .. 2 Sep 00:00 Pacific.
    expect(argOf('showings', 'gte')).toEqual(['start_time', '2026-09-01T07:00:00.000Z']);
    expect(argOf('showings', 'lt')).toEqual(['start_time', '2026-09-02T07:00:00.000Z']);
  });

  it('keeps a matinee that has already started', async () => {
    tables.showings = [
      {
        id: 's1',
        // 2 PM Pacific — five hours before "now".
        start_time: '2026-09-01T21:00:00Z',
        total_seats: 200,
        no_ticket_required: false,
        movies: { title: 'The Gold Rush' },
      },
    ];
    tables.tickets = [
      { showing_id: 's1', scanned_at: '2026-09-01T21:05:00Z', payment_method: 'cash' },
      { showing_id: 's1', scanned_at: null, payment_method: 'online' },
    ];

    render(<TodaysPresales />);

    // The window is the day, not "from now on": a showing staff are still
    // tearing tickets for must not vanish the moment it begins.
    expect(await screen.findByText('The Gold Rush')).toBeInTheDocument();
    expect(await screen.findByText('2 / 200 sold')).toBeInTheDocument();
    expect(await screen.findByText('1 checked in')).toBeInTheDocument();
  });

  it('counts confirmed tickets only', async () => {
    tables.showings = [
      {
        id: 's1',
        start_time: '2026-09-02T02:30:00Z',
        total_seats: 100,
        no_ticket_required: false,
        events: { title: 'Palouse Jazz' },
      },
    ];
    render(<TodaysPresales />);
    await waitFor(() => expect(argOf('tickets', 'eq')).toBeTruthy());

    // A pending row is an unpaid hold from a checkout in progress and admits
    // nobody; a refunded one has been given back. Either would overstate the
    // house to the person on the door.
    expect(argOf('tickets', 'eq')).toEqual(['status', 'confirmed']);
  });

  it('does not repeat a lone showing as a day total', async () => {
    tables.showings = [
      {
        id: 's1',
        start_time: '2026-09-02T02:30:00Z',
        total_seats: 265,
        no_ticket_required: false,
        movies: { title: 'The Crowd' },
      },
    ];
    tables.tickets = [{ showing_id: 's1', scanned_at: null, payment_method: 'online' }];

    render(<TodaysPresales />);
    expect(await screen.findByText('The Crowd')).toBeInTheDocument();

    // With one showing the aggregate badges are arithmetically the row beneath
    // them, so they are not drawn at all — printing the same two numbers twice
    // only invites the reader to hunt for a difference that cannot exist.
    expect(screen.queryByText(/sold for today’s showings/)).not.toBeInTheDocument();
    expect(screen.queryByText('1 showings')).not.toBeInTheDocument();
    // And the row's own wording never says bare "today": the tile above this
    // panel counts tickets *bought* today for any date, which is a different
    // number on any normal evening.
    expect(screen.queryByText(/sold today/)).not.toBeInTheDocument();
  });

  it('totals the day only when there is more than one showing', async () => {
    tables.showings = [
      { id: 's1', start_time: '2026-09-01T21:00:00Z', total_seats: 265,
        no_ticket_required: false, movies: { title: 'Matinee' } },
      { id: 's2', start_time: '2026-09-02T02:30:00Z', total_seats: 265,
        no_ticket_required: false, movies: { title: 'Evening' } },
    ];
    tables.tickets = [
      { showing_id: 's1', scanned_at: '2026-09-01T21:05:00Z', payment_method: 'cash' },
      { showing_id: 's2', scanned_at: null, payment_method: 'online' },
      { showing_id: 's2', scanned_at: null, payment_method: 'online' },
    ];

    render(<TodaysPresales />);
    expect(await screen.findByText('3 sold for today’s showings')).toBeInTheDocument();
    expect(await screen.findByText('2 showings')).toBeInTheDocument();
  });

  it('counts film-pass admissions, and only shows the badge once there are any', async () => {
    tables.showings = [
      { id: 's1', start_time: '2026-09-02T02:30:00Z', total_seats: 265,
        no_ticket_required: false, movies: { title: 'The Crowd' } },
    ];
    // redeem_film_pass writes these at the door with scanned_at already set,
    // so a pass admission is sold and checked in in the same instant — it is
    // never a presale.
    tables.tickets = [
      { showing_id: 's1', scanned_at: '2026-09-02T02:31:00Z', payment_method: 'film_pass' },
      { showing_id: 's1', scanned_at: null, payment_method: 'online' },
    ];

    render(<TodaysPresales />);
    expect(await screen.findByText('1 on passes')).toBeInTheDocument();
    expect(await screen.findByText('2 / 265 sold')).toBeInTheDocument();
    expect(await screen.findByText('1 checked in')).toBeInTheDocument();
  });

  it('says so when the day is empty', async () => {
    render(<TodaysPresales />);
    expect(await screen.findByText('Nothing is scheduled for today.')).toBeInTheDocument();
  });
});
