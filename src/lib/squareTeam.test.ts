import { describe, expect, it } from 'vitest';
import { splitName, squareStatusBadge } from './squareTeam';

describe('squareStatusBadge', () => {
  it('names the record, not onboarding, for ACTIVE', () => {
    // An ACTIVE record can belong to someone whose Square invitation expired
    // years ago — the badge must not read as "set up in Square".
    expect(squareStatusBadge('ACTIVE')).toEqual({ label: 'Active record in Square', variant: 'default' });
    expect(squareStatusBadge('ACTIVE').label).not.toBe('Active in Square');
  });

  it('keeps a distinct inactive badge', () => {
    expect(squareStatusBadge('INACTIVE')).toEqual({ label: 'Inactive in Square', variant: 'secondary' });
  });

  it('shows an unexpected status as-is rather than guessing', () => {
    expect(squareStatusBadge('SUSPENDED').label).toBe('suspended in Square');
    expect(squareStatusBadge(undefined).label).toBe('unknown in Square');
  });
});

describe('splitName', () => {
  it('splits first word from the rest', () => {
    expect(splitName('Ben Ramalingam')).toEqual({ given: 'Ben', family: 'Ramalingam' });
    expect(splitName('  Mary  Ann Evans ')).toEqual({ given: 'Mary', family: 'Ann Evans' });
  });

  it('leaves the family name blank for one word or nothing', () => {
    expect(splitName('Cher')).toEqual({ given: 'Cher', family: '' });
    expect(splitName(null)).toEqual({ given: '', family: '' });
  });
});
