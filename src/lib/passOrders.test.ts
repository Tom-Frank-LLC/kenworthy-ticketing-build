import { describe, it, expect } from 'vitest';
import { formatMailingAddress, passOrderBuyerLabel } from './passOrders';

describe('formatMailingAddress', () => {
  it('renders a complete address on one line', () => {
    expect(
      formatMailingAddress({
        line1: '508 S Main St',
        line2: null,
        city: 'Moscow',
        state: 'ID',
        postal_code: '83843',
      }),
    ).toBe('508 S Main St, Moscow, ID 83843');
  });

  it('includes line2 when present', () => {
    expect(
      formatMailingAddress({
        line1: '508 S Main St',
        line2: 'Apt 4',
        city: 'Moscow',
        state: 'ID',
        postal_code: '83843',
      }),
    ).toBe('508 S Main St, Apt 4, Moscow, ID 83843');
  });

  it('returns empty string for a null address', () => {
    expect(formatMailingAddress(null)).toBe('');
    expect(formatMailingAddress(undefined)).toBe('');
  });

  it('leaves no stray punctuation when the city line is missing', () => {
    // The inline template this replaces produced "508 S Main St, ,  " here.
    expect(formatMailingAddress({ line1: '508 S Main St' })).toBe('508 S Main St');
  });

  it('leaves no stray punctuation when only the ZIP is missing', () => {
    expect(
      formatMailingAddress({ line1: '508 S Main St', city: 'Moscow', state: 'ID' }),
    ).toBe('508 S Main St, Moscow, ID');
  });

  it('renders a city line with no street line', () => {
    expect(formatMailingAddress({ city: 'Moscow', state: 'ID', postal_code: '83843' }))
      .toBe('Moscow, ID 83843');
  });

  it('trims whitespace-only fields away', () => {
    expect(
      formatMailingAddress({
        line1: '  508 S Main St  ',
        line2: '   ',
        city: 'Moscow',
        state: 'ID',
        postal_code: '83843',
      }),
    ).toBe('508 S Main St, Moscow, ID 83843');
  });

  it('returns empty string when every field is blank', () => {
    expect(formatMailingAddress({ line1: '', line2: null, city: '', state: '', postal_code: '' }))
      .toBe('');
  });
});

describe('passOrderBuyerLabel', () => {
  it('prefers the name', () => {
    expect(passOrderBuyerLabel({ buyer_name: 'Tom Frank', buyer_email: 't@example.com' }))
      .toBe('Tom Frank');
  });

  it('falls back to the email', () => {
    expect(passOrderBuyerLabel({ buyer_name: null, buyer_email: 't@example.com' }))
      .toBe('t@example.com');
  });

  it('falls back again when the name is only whitespace', () => {
    expect(passOrderBuyerLabel({ buyer_name: '   ', buyer_email: 't@example.com' }))
      .toBe('t@example.com');
  });

  it('never renders an empty label', () => {
    expect(passOrderBuyerLabel({ buyer_name: null, buyer_email: null })).toBe('Unnamed buyer');
  });
});
