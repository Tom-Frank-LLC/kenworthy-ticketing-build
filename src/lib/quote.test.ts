import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));
import { EMPTY_QUOTE, quoteFromRows } from './quote';

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
