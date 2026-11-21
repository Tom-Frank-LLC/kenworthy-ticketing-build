import { describe, expect, it, vi } from 'vitest';

const sb = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: sb.rpc, functions: { invoke: sb.invoke } } }));
import { EMPTY_QUOTE, fetchQuote, promoFromRows, promoNotice, quoteFromRows } from './quote';

const row = (over: Record<string, unknown> = {}) => ({
  seq: 0, discount_label: null, order_list_subtotal: '36.00', order_discount: '9.00', order_subtotal: '27.00',
  order_tax: '1.62', order_total: '28.62', order_processing_fee: '0.00', order_grand_total: '28.62', ...over,
});

describe('quoteFromRows', () => {
  it('reads the order off the first row and counts the tickets', () => {
    const q = quoteFromRows([row({ discount_label: '25% off 4+' }), row({ seq: 1 }), row({ seq: 2 }), row({ seq: 3 })]);
    expect(q).toEqual({ ticketCount: 4, subtotal: 36, discount: { label: '25% off 4+', amount: 9 }, tax: 1.62, total: 28.62, processingFee: 0, grandTotal: 28.62 });
  });
  it('finds the label on whichever row carries it (an ineligible first ticket has none)', () => {
    expect(quoteFromRows([row(), row({ seq: 1, discount_label: 'Family rate' })]).discount?.label).toBe('Family rate');
  });
  it('is empty for no rows, and has no discount when nothing was taken off', () => {
    expect(quoteFromRows([])).toEqual(EMPTY_QUOTE);
    expect(quoteFromRows([row({ order_discount: '0.00' })]).discount).toBeNull();
  });
});

describe('promo codes (BRIEF-promo-codes)', () => {
  it('reads the code outcome off the rows, or null when no code was asked about', () => {
    expect(promoFromRows([row({ promo_code: 'FALL25', promo_status: 'applied', promo_min_quantity: 1 })]))
      .toEqual({ code: 'FALL25', status: 'applied', minQuantity: 1 });
    expect(promoFromRows([row()])).toBeNull();
    expect(promoFromRows([])).toBeNull();
  });

  it('says why a valid code did nothing, and nothing when it applied', () => {
    expect(promoNotice({ code: 'HALF4', status: 'below_minimum', minQuantity: 4 })).toBe('HALF4 needs at least 4 tickets in the order.');
    expect(promoNotice({ code: 'ADULT', status: 'not_eligible', minQuantity: 1 })).toMatch(/doesn't apply to the ticket types/);
    expect(promoNotice({ code: 'TEN', status: 'better_discount', minQuantity: 1 })).toMatch(/better discount already applies/);
    expect(promoNotice({ code: 'FALL25', status: 'applied', minQuantity: 1 })).toBeNull();
    expect(promoNotice(null)).toBeNull();
  });

  it('without a code, asks the public quote; never with a code argument', async () => {
    sb.rpc.mockResolvedValueOnce({ data: [row()], error: null });
    await fetchQuote('s', [{}], 'online');
    expect(sb.rpc).toHaveBeenLastCalledWith('quote_ticket_order', { p_showing_id: 's', p_tickets: [{ seat_id: null, tier_id: null }], p_channel: 'online' });
  });

  it('the showing page asks the rate-limited edge function, not the database', async () => {
    sb.invoke.mockResolvedValueOnce({ data: { quote: { ...EMPTY_QUOTE, ticketCount: 1 }, promo: { code: 'FALL25', status: 'applied', minQuantity: 1 } }, error: null });
    const res = await fetchQuote('s', [{}], 'online', { code: 'fall25', via: 'public' });
    expect(sb.invoke).toHaveBeenLastCalledWith('promo-quote', { body: { showing_id: 's', tickets: [{ seat_id: null, tier_id: null }], code: 'fall25' } });
    expect(res).toMatchObject({ promo: { code: 'FALL25' } });
  });

  it("reads a refused code's sentence out of the edge function's error body", async () => {
    const context = { json: () => Promise.resolve({ error: 'That promo code has expired.', promo_refused: true }) };
    sb.invoke.mockResolvedValueOnce({ data: null, error: Object.assign(new Error('non-2xx'), { context }) });
    expect(await fetchQuote('s', [{}], 'online', { code: 'GONE', via: 'public' }))
      .toEqual({ error: 'That promo code has expired.', promoRefused: true });
  });

  it('the box office asks the staff-only coded quote, and knows PT422 is about the code', async () => {
    sb.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT422', message: 'This promo code has been used up.' } });
    const res = await fetchQuote('s', [{}], 'none', { code: 'ONCE', via: 'staff' });
    expect(sb.rpc).toHaveBeenLastCalledWith('quote_ticket_order_coded', expect.objectContaining({ p_code: 'ONCE', p_channel: 'none' }));
    expect(res).toEqual({ error: 'This promo code has been used up.', promoRefused: true });
    sb.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'This showing is sold out.' } });
    expect(await fetchQuote('s', [{}], 'none', { code: 'ONCE', via: 'staff' })).toEqual({ error: 'This showing is sold out.', promoRefused: false });
  });
});
