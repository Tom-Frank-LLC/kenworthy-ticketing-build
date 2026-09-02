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
      { showing_id: 's1', scanned_at: '2026-09-01T21:05:00Z' },
      { showing_id: 's1', scanned_at: null },
    ];

    render(<TodaysPresales />);

    // The window is the day, not "from now on": a showing staff are still
    // tearing tickets for must not vanish the moment it begins.
    expect(await screen.findByText('The Gold Rush')).toBeInTheDocument();
    expect(await screen.findByText('2 / 200 sold')).toBeInTheDocument();
    expect(await screen.findByText('1 in')).toBeInTheDocument();
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

  it('says so when the day is empty', async () => {
    render(<TodaysPresales />);
    expect(await screen.findByText('Nothing is scheduled for today.')).toBeInTheDocument();
  });
});
