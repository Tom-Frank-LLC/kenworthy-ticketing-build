import { describe, it, expect } from 'vitest';
import { formatMailingAddress, passOrderBuyerLabel, describeAge, daysSince } from './passOrders';

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

describe('describeAge', () => {
  const now = new Date('2026-08-13T12:00:00Z');

  it('calls the same day today', () => {
    expect(describeAge('2026-08-13T01:00:00Z', now)).toBe('today');
  });

  it('calls one day yesterday', () => {
    expect(describeAge('2026-08-12T06:00:00Z', now)).toBe('yesterday');
  });

  it('counts whole days beyond that', () => {
    expect(describeAge('2026-08-10T12:00:00Z', now)).toBe('3 days ago');
  });

  it('does not go negative on a clock skew', () => {
    // A row activated "in the future" is a clock problem, not a negative age.
    expect(describeAge('2026-08-14T12:00:00Z', now)).toBe('today');
  });

  it('says so rather than rendering a broken date', () => {
    expect(describeAge(null, now)).toBe('at an unknown time');
    expect(describeAge('not a date', now)).toBe('at an unknown time');
  });
});

describe('daysSince', () => {
  const now = new Date('2026-08-13T12:00:00Z');

  it('returns null for a missing or unparseable timestamp', () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince('nonsense', now)).toBeNull();
  });

  it('floors to whole days', () => {
    expect(daysSince('2026-08-11T23:00:00Z', now)).toBe(1);
  });
});
