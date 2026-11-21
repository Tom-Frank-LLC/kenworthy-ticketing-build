import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * What matters about this editor is what it tells an admin after a write. On
 * this project an RLS denial comes back as a success with no rows, so "no
 * error" is not "saved" — and an admin told their offer is live when it is not
 * finds out from a customer.
 */
const state = vi.hoisted(() => ({
  rows: [] as any[],
  tiers: [] as string[],
  inserts: [] as any[],
  updates: [] as any[],
  deletes: [] as string[],
  insertReturns: null as any[] | null,
  toasts: { success: [] as string[], error: [] as string[] },
}));

vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => state.toasts.success.push(m),
    error: (m: string) => state.toasts.error.push(m),
  },
}));

vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => {
    if (table === 'showings') {
      const c: any = { select: () => c, eq: () => c, filter: () => c, then: (r: (v: unknown) => unknown) => r({ data: [{ id: 's-1' }], error: null }) };
      return c;
    }
    if (table === 'showing_price_tiers') {
      const c: any = { select: () => c, in: () => c, eq: () => c, then: (r: (v: unknown) => unknown) => r({ data: state.tiers.map((tier_name) => ({ tier_name })), error: null }) };
      return c;
    }
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any; let id = '';
    const chain: any = {
      select: () => chain,
      order: () => chain,
      not: () => chain,
      eq: (col: string, val: string) => { if (col === 'id') id = val; return chain; },
      filter: () => chain,
      insert: (p: any) => { op = 'insert'; payload = p; return chain; },
      update: (p: any) => { op = 'update'; payload = p; return chain; },
      delete: () => { op = 'delete'; return chain; },
      then: (resolve: (v: unknown) => unknown) => {
        if (op === 'insert') {
          state.inserts.push(table === 'ticket_discount_limits' ? { limits: payload } : payload);
          if (table === 'ticket_discount_limits') {
            return resolve({ data: (payload as any[]).map((_, i) => ({ id: `lim-${i}` })), error: null });
          }
          const returned = state.insertReturns ?? [{ id: 'new', created_at: '2026-09-21T00:00:00Z', ...payload }];
          if (returned.length) state.rows.push(...returned);
          return resolve({ data: returned, error: null });
        }
        if (op === 'update') { state.updates.push({ id, ...payload }); return resolve({ data: [{ id }], error: null }); }
        if (op === 'delete') { state.deletes.push(id); return resolve({ data: [{ id }], error: null }); }
        return resolve({ data: state.rows, error: null });
      },
    };
    return chain;
  };
  const canon: Record<string, string> = { Students: 'Student', student: 'Student' };
  const rpc = (fn: string, args: { raw: string }) =>
    Promise.resolve(fn === 'ticket_discount_usage' ? { data: [], error: null } : { data: canon[args.raw] ?? args.raw, error: null });
  return { supabase: { from, rpc } };
});

import DiscountRulesEditor, { suggestLabel } from './DiscountRulesEditor';

const existing = {
  id: 'rule-1', type: 'percent', value: 25, min_quantity: 4, label: '25% off when you buy 4+',
  is_active: true, starts_at: null, ends_at: null, created_at: '2026-09-01T00:00:00Z', eligible_tiers: null,
};

beforeEach(() => {
  state.rows = []; state.tiers = []; state.inserts = []; state.updates = []; state.deletes = [];
  state.insertReturns = null; state.toasts.success = []; state.toasts.error = [];
});

describe('DiscountRulesEditor', () => {
  it('lists existing rules with their offer in words', async () => {
    state.rows = [existing];
    render(<DiscountRulesEditor scope={{ event_id: 'evt-1' }} audience="every showing of this event" />);
    expect(await screen.findByText('25% off when you buy 4+')).toBeInTheDocument();
    expect(screen.getByText(/Buy 4 or more and save 25%/)).toBeInTheDocument();
  });

  it('adds the Oct 3 rule: 25% off 4+, scoped to the event, named for the buyer', async () => {
    render(<DiscountRulesEditor scope={{ event_id: 'evt-1' }} audience="every showing of this event" />);
    await screen.findByText('No discounts yet.');

    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add discount' }));

    await waitFor(() => expect(state.inserts).toHaveLength(1));
    expect(state.inserts[0]).toMatchObject({
      event_id: 'evt-1', type: 'percent', value: 25, min_quantity: 4,
      label: '25% off when you buy 4+', is_active: true, starts_at: null, ends_at: null,
    });
    expect(state.toasts.success[0]).toMatch(/Discount added/);
  });

  it('says NOT SAVED when the write comes back empty, as an RLS denial does', async () => {
    state.insertReturns = [];
    render(<DiscountRulesEditor scope={{ showing_id: 's-1' }} audience="this showing" />);
    await screen.findByText('No discounts yet.');

    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add discount' }));

    await waitFor(() => expect(state.toasts.error).toHaveLength(1));
    expect(state.toasts.error[0]).toMatch(/was not saved/);
    expect(state.toasts.success).toHaveLength(0);
  });

  it('refuses nonsense before it reaches the database', async () => {
    render(<DiscountRulesEditor scope={{ showing_id: 's-1' }} audience="this showing" />);
    await screen.findByText('No discounts yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Add discount' }));
    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '140' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add discount' }));

    await waitFor(() => expect(state.toasts.error).toHaveLength(2));
    expect(state.inserts).toHaveLength(0);
    expect(state.toasts.error).toEqual([
      'Enter an amount greater than zero.',
      'A percent discount cannot be more than 100.',
    ]);
  });

  it('switches a rule off without deleting it', async () => {
    state.rows = [existing];
    render(<DiscountRulesEditor scope={{ event_id: 'evt-1' }} audience="every showing of this event" />);
    fireEvent.click(await screen.findByRole('switch'));
    await waitFor(() => expect(state.updates).toEqual([{ id: 'rule-1', is_active: false }]));
    expect(state.deletes).toHaveLength(0);
  });
});

describe('eligible ticket types', () => {
  it('shows one box per type, all ticked, and stores NULL when none is unticked', async () => {
    state.tiers = ['Adult', 'Students', 'student', 'Senior'];
    render(<DiscountRulesEditor scope={{ event_id: 'evt-1' }} audience="every showing of this event" />);
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes.map((b) => b.parentElement?.textContent?.trim())).toEqual(['Adult', 'Senior', 'Student']);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);

    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add discount' }));
    await waitFor(() => expect(state.inserts).toHaveLength(1));
    expect(state.inserts[0].eligible_tiers).toBeNull();
  });

  it('stores only the ticked types once one is unticked', async () => {
    state.tiers = ['Adult', 'Student', 'Senior'];
    render(<DiscountRulesEditor scope={{ showing_id: 's-1' }} audience="this showing" />);
    await screen.findAllByRole('checkbox');
    fireEvent.click(screen.getByLabelText('Student'));
    fireEvent.click(screen.getByLabelText('Senior'));
    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add discount' }));
    await waitFor(() => expect(state.inserts).toHaveLength(1));
    expect(state.inserts[0].eligible_tiers).toEqual(['Adult']);
  });

  it('refuses a rule that applies to no type at all', async () => {
    state.tiers = ['Adult'];
    render(<DiscountRulesEditor scope={{ showing_id: 's-1' }} audience="this showing" />);
    await screen.findAllByRole('checkbox');
    fireEvent.click(screen.getByLabelText('Adult'));
    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add discount' }));
    await waitFor(() => expect(state.toasts.error).toHaveLength(1));
    expect(state.toasts.error[0]).toMatch(/at least one ticket type/);
    expect(state.inserts).toHaveLength(0);
  });

  it('says which types an existing rule covers', async () => {
    state.rows = [{ ...existing, eligible_tiers: ['Adult', 'Child'] }];
    render(<DiscountRulesEditor scope={{ event_id: 'evt-1' }} audience="every showing of this event" />);
    expect(await screen.findByText(/Adult and Child tickets only/)).toBeInTheDocument();
  });
});

describe('the add form does not look filled in when it is empty', () => {
  it('has no placeholder text in any box, and the labels say what they are', async () => {
    render(<DiscountRulesEditor scope={{ showing_id: 's-1' }} audience="this showing" />);
    await screen.findByText('No discounts yet.');

    expect(screen.getByLabelText('Percent')).not.toHaveAttribute('placeholder');
    expect(screen.getByLabelText('Displayed text')).not.toHaveAttribute('placeholder');
    expect(screen.getByLabelText('Displayed text')).toHaveValue('');
    // The one real default, shown as a value because it IS one.
    expect(screen.getByLabelText('Ticket minimum')).toHaveValue(4);
  });
});

describe('suggestLabel', () => {
  it('names each kind of rule the way a buyer would say it', () => {
    expect(suggestLabel('percent', '25', '4')).toBe('25% off when you buy 4+');
    expect(suggestLabel('fixed_per_ticket', '2', '4')).toBe('$2 off each ticket when you buy 4+');
    expect(suggestLabel('fixed_per_order', '10.5', '1')).toBe('$10.50 off');
    expect(suggestLabel('percent', '', '4')).toBe('');
  });
});

describe('promo codes (BRIEF-promo-codes)', () => {
  it('stores a code the way the table requires: upper-case, no spaces', async () => {
    render(<DiscountRulesEditor scope={{ movie_id: 'm-1' }} audience="every showing of this film" />);
    await screen.findByText('No discounts yet.');
    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Promo code (optional)'), { target: { value: 'fall 25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add discount' }));
    await waitFor(() => expect(state.inserts).toHaveLength(1));
    expect(state.inserts[0]).toMatchObject({ movie_id: 'm-1', code: 'FALL25', channels: null, is_active: true });
    expect(state.toasts.success[0]).toMatch(/Code FALL25 added/);
  });

  it('refuses a code the table would refuse, before writing', async () => {
    render(<DiscountRulesEditor scope={{ movie_id: 'm-1' }} audience="every showing of this film" />);
    await screen.findByText('No discounts yet.');
    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Promo code (optional)'), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add discount' }));
    await waitFor(() => expect(state.toasts.error).toHaveLength(1));
    expect(state.toasts.error[0]).toMatch(/3 to 32 letters/);
    expect(state.inserts).toHaveLength(0);
  });

  it('a site-wide discount must have a code, or it would discount every ticket', async () => {
    render(<DiscountRulesEditor scope={{ sitewide: true }} audience="every film, event and live performance" />);
    await screen.findByText('No promo codes yet.');
    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add promo code' }));
    await waitFor(() => expect(state.toasts.error).toHaveLength(1));
    expect(state.toasts.error[0]).toMatch(/needs a promo code/);
    expect(state.inserts).toHaveLength(0);
  });

  it('a site-wide code is written with no scope at all', async () => {
    render(<DiscountRulesEditor scope={{ sitewide: true }} audience="every film, event and live performance" />);
    await screen.findByText('No promo codes yet.');
    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'MEMBERS10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add promo code' }));
    await waitFor(() => expect(state.inserts).toHaveLength(1));
    const written = state.inserts[0];
    expect(written.code).toBe('MEMBERS10');
    for (const col of ['showing_id', 'movie_id', 'event_id', 'live_performance_id']) expect(written).not.toHaveProperty(col);
  });

  it('a limited code is written OFF, gets its limits, and only then goes on', async () => {
    render(<DiscountRulesEditor scope={{ event_id: 'evt-1' }} audience="every showing of this event" />);
    await screen.findByText('No discounts yet.');
    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Promo code (optional)'), { target: { value: 'ONCEONLY' } });
    fireEvent.click(screen.getByRole('button', { name: /Add a limit/ }));
    fireEvent.change(screen.getByLabelText('Up to'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add discount' }));
    await waitFor(() => expect(state.updates).toHaveLength(1));
    expect(state.inserts[0]).toMatchObject({ code: 'ONCEONLY', is_active: false });
    expect(state.inserts[1]).toEqual({ limits: [{ counts: 'orders', per: 'total', max_uses: 100, discount_id: 'new' }] });
    expect(state.updates[0]).toEqual({ id: 'new', is_active: true });
  });
});
