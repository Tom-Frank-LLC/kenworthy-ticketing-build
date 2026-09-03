import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * Eligibility has to agree with the door, or the card is worse than absent.
 *
 * `redeem_film_pass` admits on one test: does a `pass_type_showings` row pair
 * this pass's type with this screening. No category, and no default — "nobody
 * tagged it" means refused. A card that softened that into "probably" would
 * send staff to argue with a patron the scanner is about to turn away.
 */

const calls: any[][] = [];
const tables: Record<string, any[]> = {};

vi.mock('@/integrations/supabase/client', () => {
  const builder = (table: string) => {
    let usedIn = false;
    let status: string | null = null;
    const b: any = {};
    for (const m of ['select', 'eq', 'gte', 'lt', 'in']) {
      b[m] = (...args: any[]) => {
        if (m === 'in') usedIn = true;
        if (m === 'eq' && args[0] === 'status') status = args[1];
        calls.push([table, m, ...args]);
        return b;
      };
    }
    b.then = (res: any, rej: any) => {
      // `tickets` is queried twice: refunds bought today, and confirmed seats
      // for today's showings. The `.in()` is what tells them apart.
      const key =
        table === 'tickets' ? (usedIn ? 'tickets_in' : `tickets_${status}`) : table;
      return Promise.resolve({ data: tables[key] ?? [], error: null }).then(res, rej);
    };
    return b;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});

const { PosTodayStats } = await import('./PosTodayStats');

describe('PosTodayStats — film pass eligibility', () => {
  beforeEach(() => {
    calls.length = 0;
    for (const k of Object.keys(tables)) delete tables[k];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-02T02:00:00Z')); // 7 PM Pacific, 1 Sep
  });
  afterEach(() => vi.useRealTimers());

  it('names the pass when tonight’s showing is tagged', async () => {
    tables.showings = [{ id: 's1' }];
    tables.pass_type_showings = [
      { showing_id: 's1', film_pass_types: { name: '10-Film Pass' } },
    ];
    tables.tickets_in = [{ id: 't1' }];

    render(<PosTodayStats />);
    expect(await screen.findByText('Yes')).toBeInTheDocument();
    expect(await screen.findByText('10-Film Pass')).toBeInTheDocument();
  });

  it('says No when nothing is tagged, without hedging', async () => {
    tables.showings = [{ id: 's1' }];
    tables.pass_type_showings = [];

    render(<PosTodayStats />);
    expect(await screen.findByText('No')).toBeInTheDocument();
    expect(await screen.findByText('No pass is accepted today')).toBeInTheDocument();
  });

  it('says how many showings accept a pass when only some do', async () => {
    tables.showings = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
    tables.pass_type_showings = [
      { showing_id: 's1', film_pass_types: { name: 'Festival Pass' } },
      { showing_id: 's2', film_pass_types: { name: 'Festival Pass' } },
    ];

    render(<PosTodayStats />);
    expect(await screen.findByText('Festival Pass — 2 of 3 showings')).toBeInTheDocument();
  });

  it('distinguishes an empty schedule from a refused one', async () => {
    tables.showings = [];
    render(<PosTodayStats />);
    expect(await screen.findByText('Nothing scheduled today')).toBeInTheDocument();
    // Never "No": there is no showing to refuse a pass at.
    expect(screen.queryByText('No pass is accepted today')).not.toBeInTheDocument();
  });

  it('scopes the day to the venue, and counts the right tickets', async () => {
    tables.showings = [{ id: 's1' }];
    tables.tickets_in = [{ id: 'a' }, { id: 'b' }];
    tables.tickets_refunded = [{ id: 'r' }];

    render(<PosTodayStats />);
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument()); // house
    expect(screen.getByText('1')).toBeInTheDocument();                      // refunds

    const gte = calls.find(c => c[0] === 'showings' && c[1] === 'gte')?.slice(2);
    expect(gte).toEqual(['start_time', '2026-09-01T07:00:00.000Z']);
  });
});
