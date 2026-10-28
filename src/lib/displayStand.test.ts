import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}));

import { cancelDisplayCharge, displayChargeRunning, runDisplayCharge, type ChargeDeps } from './displayStand';

const request = { saleId: 'sale-1', squareOrderId: 'ORDER_1' };
const details = { order_token: 'tok-1', amount_cents: 2620, reference_id: 'tok-1', square_order_id: 'ORDER_1', ticket_count: 2 };

function deps(over: Partial<ChargeDeps> = {}): ChargeDeps & { taken: unknown[]; confirms: unknown[] } {
  const taken: unknown[] = [];
  const confirms: unknown[] = [];
  return {
    taken, confirms,
    details: async () => details,
    authorize: async () => ({}),
    take: async (sale) => { taken.push(sale); return { status: 'finished', payment: { id: 'PAY_1', amountCents: 2620, totalCents: 2620, referenceId: 'tok-1', orderId: 'ORDER_1', locationId: 'L', online: true } }; },
    confirm: async (token, id) => { confirms.push([token, id]); return { confirmed: true, payment_id: id }; },
    wait: async () => {},
    newAttemptId: () => 'attempt-1',
    ...over,
  };
}

describe('runDisplayCharge', () => {
  it('charges what the server says for the order, then has the server confirm it', async () => {
    const d = deps();
    const r = await runDisplayCharge(request, d);
    expect(r).toEqual({ saleId: 'sale-1', outcome: 'paid', paymentId: 'PAY_1' });
    expect(d.taken).toEqual([{ amountCents: 2620, referenceId: 'tok-1', orderId: 'ORDER_1', paymentAttemptId: 'attempt-1', note: '2 ticket(s)' }]);
    expect(d.confirms).toEqual([['tok-1', 'PAY_1']]);
  });

  it('a payment Square has not finished is asked about again', async () => {
    let n = 0;
    const r = await runDisplayCharge(request, deps({ confirm: async () => (++n < 3 ? { confirmed: false, status: 'APPROVED' } : { already_confirmed: true }) }));
    expect(r.outcome).toBe('paid');
    expect(n).toBe(3);
  });

  it('cancelled on the Stand, with no payment: canceled, nothing confirmed', async () => {
    const d = deps({ take: async () => ({ status: 'canceled' }) });
    expect((await runDisplayCharge(request, d)).outcome).toBe('canceled');
    expect(d.confirms).toEqual([]);
  });

  it('a failure with no payment is a decline, in words', async () => {
    const r = await runDisplayCharge(request, deps({ take: async () => ({ status: 'failed', errorMessage: 'error code: payment_timed_out' }) }));
    expect(r.outcome).toBe('declined');
    expect(r.message).toMatch(/timed out/);
  });

  it('a payment Square calls FAILED is a decline, keeping its id', async () => {
    const r = await runDisplayCharge(request, deps({ confirm: async () => ({ confirmed: false, status: 'FAILED' }) }));
    expect(r).toMatchObject({ outcome: 'declined', paymentId: 'PAY_1' });
  });

  it('a server refusal of the payment is an error, keeping its id for staff', async () => {
    const r = await runDisplayCharge(request, deps({ confirm: async () => { throw new Error('That card payment belongs to a different sale.'); } }));
    expect(r).toMatchObject({ outcome: 'error', paymentId: 'PAY_1', message: 'That card payment belongs to a different sale.' });
  });

  it('no Stand charge starts when the server will not say what to charge', async () => {
    const d = deps({ details: async () => { throw new Error('That sale is no longer waiting for a card'); } });
    const r = await runDisplayCharge(request, d);
    expect(r).toMatchObject({ outcome: 'error', message: 'That sale is no longer waiting for a card' });
    expect(d.taken).toEqual([]);
  });

  it('no Stand charge starts when the Stand cannot be signed in', async () => {
    const d = deps({ authorize: async () => { throw new Error('Square is not connected for the Stand yet.'); } });
    expect((await runDisplayCharge(request, d)).outcome).toBe('error');
    expect(d.taken).toEqual([]);
  });
});

describe('cancelling a charge on the display', () => {
  it('with nothing running, the answer is idle: no card was taken here', () => {
    expect(cancelDisplayCharge('sale-1')).toBe('idle');
  });

  it('a cancel while the server is asked stops the charge before Square’s screen opens', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const d = deps({ details: async () => { await gate; return details; } });
    const run = runDisplayCharge(request, d);
    expect(displayChargeRunning()).toBe('sale-1');
    expect(cancelDisplayCharge('sale-1')).toBe('running');
    release();
    expect((await run).outcome).toBe('canceled');
    expect(d.taken).toEqual([]);
    expect(displayChargeRunning()).toBeNull();
  });

  it('a cancel during the payment is left to Square: a card already in still reports paid', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const base = deps();
    const d = deps({ take: async (sale) => { await gate; return base.take(sale); } });
    const run = runDisplayCharge(request, d);
    await new Promise((r) => setTimeout(r, 0));
    expect(cancelDisplayCharge('sale-1')).toBe('running');
    release();
    expect((await run).outcome).toBe('paid');
  });

  it('a cancel for another sale does not touch the running one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const run = runDisplayCharge(request, deps({ details: async () => { await gate; return details; } }));
    expect(cancelDisplayCharge('other-sale')).toBe('idle');
    release();
    expect((await run).outcome).toBe('paid');
  });

  it('one charge at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = runDisplayCharge(request, deps({ details: async () => { await gate; return details; } }));
    const second = await runDisplayCharge({ saleId: 'sale-2', squareOrderId: 'O2' }, deps());
    expect(second.outcome).toBe('error');
    release();
    expect((await first).outcome).toBe('paid');
  });
});
