import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { buyerLimitNote, channelPhrase, describeLimit, describeOffer, type DiscountRule } from './discounts';

const rule = (over: Partial<DiscountRule> = {}): DiscountRule => ({
  id: 'r', type: 'percent', value: 25, min_quantity: 4, label: 'x', created_at: '', ...over,
});

describe('limit and channel wording (BRIEF-promo-codes)', () => {
  it('describes a limit the way the admin and the till read it', () => {
    expect(describeLimit({ counts: 'orders', per: 'total', max_uses: 100 })).toBe('100 orders in total');
    expect(describeLimit({ counts: 'tickets', per: 'buyer', max_uses: 1 })).toBe('1 ticket per person');
    expect(describeLimit({ counts: 'tickets', per: 'buyer_showing', max_uses: 2 })).toBe('2 tickets per person, per showing');
    expect(describeLimit({ counts: 'orders', per: 'day', max_uses: 20 })).toBe('20 orders per day of shows');
  });

  it('tells the till only about per-person limits, which it cannot check', () => {
    expect(buyerLimitNote([{ counts: 'orders', per: 'total', max_uses: 50 }])).toBeNull();
    expect(buyerLimitNote([
      { counts: 'orders', per: 'total', max_uses: 50 },
      { counts: 'tickets', per: 'buyer', max_uses: 2 },
    ])).toBe("Limit 2 tickets per person. The till can't check this, so please confirm with the patron.");
  });

  it('names where a channel-limited offer works', () => {
    expect(channelPhrase(null)).toBe('');
    expect(channelPhrase(['online', 'in_person'])).toBe('');
    expect(describeOffer(rule({ channels: ['online'] }))).toBe('Buy 4 or more and save 25% online only');
    expect(describeOffer(rule({ min_quantity: 1, channels: ['in_person'] }))).toBe('Save 25% at the box office');
  });
});
