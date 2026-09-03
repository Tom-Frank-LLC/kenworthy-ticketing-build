import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * The card answers "what did this counter take today", and every one of its
 * numbers has a way of being quietly wrong.
 *
 * Unsettled rows are the main one: a `pending` pass order is an unfinished
 * checkout and a `refunded` ticket has been given back, so counting either
 * overstates the day. The second is the two "todays" — revenue is scoped by
 * when the money arrived, the ticket count by when the showing is — which is
 * why a seat bought last week for tonight appears in one and not the other.
 */

const calls: any[][] = [];
const tables: Record<string, any[]> = {};

vi.mock('@/integrations/supabase/client', () => {
  const builder = (table: string) => {
    let usedIn = false;
    const b: any = {};
    for (const m of ['select', 'eq', 'gte', 'lt', 'in', 'order', 'range']) {
      b[m] = (...args: any[]) => {
        if (m === 'in') usedIn = true;
        calls.push([table, m, ...args]);
        return b;
      };
    }
    // Thenable rather than a promise, so the chain stays chainable until it is
    // awaited. `tickets` is queried twice with different shapes; the `.in()`
    // call is what distinguishes tonight's house from today's sales.
    b.then = (res: any, rej: any) =>
      Promise.resolve({ data: tables[usedIn ? `${table}_in` : table] ?? [], error: null })
        .then(res, rej);
    return b;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});

const { BoxOfficeToday } = await import('./BoxOfficeToday');

const argOf = (table: string, method: string) =>
  calls.find(c => c[0] === table && c[1] === method)?.slice(2);

describe('BoxOfficeToday', () => {
  beforeEach(() => {
    calls.length = 0;
    for (const k of Object.keys(tables)) delete tables[k];
    vi.useFakeTimers({ toFake: ['Date'] });
    // 7 PM Pacific on 1 Sep 2026 — already 2 Sep in UTC.
    vi.setSystemTime(new Date('2026-09-02T02:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('scopes the day to the venue, not to UTC or the viewer', async () => {
    render(<BoxOfficeToday />);
    await waitFor(() => expect(argOf('tickets', 'gte')).toBeTruthy());
    expect(argOf('tickets', 'gte')).toEqual(['purchased_at', '2026-09-01T07:00:00.000Z']);
    expect(argOf('tickets', 'lt')).toEqual(['purchased_at', '2026-09-02T07:00:00.000Z']);
  });

  it('sums the three streams and ignores unsettled rows', async () => {
    tables.tickets = [
      { total_price: 381.6, status: 'confirmed' },
      { total_price: 12, status: 'refunded' },   // given back
      { total_price: 9, status: 'pending' },     // never completed
      // A film-pass admission: no price, so it must add nothing here.
      { total_price: null, status: 'confirmed' },
    ];
    tables.film_pass_orders = [
      { amount_paid: 80, status: 'paid' },
      { amount_paid: 80, status: 'pending' },    // unfinished checkout
      { amount_paid: 80, status: 'failed' },
    ];
    tables.concession_sales = [];

    render(<BoxOfficeToday />);

    expect(await screen.findByText('$381.60')).toBeInTheDocument(); // tickets
    expect(await screen.findByText('$80.00')).toBeInTheDocument();  // passes
    expect(await screen.findByText('$461.60')).toBeInTheDocument(); // total
    // One refunded row, and it is a count rather than a subtraction.
    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('counts tonight’s house from today’s showings, not today’s sales', async () => {
    tables.showings = [{ id: 's1' }];
    tables.tickets = [{ total_price: 8, status: 'confirmed' }];
    // Bought whenever; what matters is that the showing is today.
    tables.tickets_in = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];

    render(<BoxOfficeToday />);
    expect(await screen.findByText('Tickets for Today')).toBeInTheDocument();
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(argOf('tickets', 'in')).toEqual(['showing_id', ['s1']]);
  });

  it('names its source, because the Square card below will disagree', async () => {
    render(<BoxOfficeToday />);
    expect(await screen.findByText(/this counter/)).toBeInTheDocument();
    expect(await screen.findByText(/whole theatre/)).toBeInTheDocument();
  });
});
