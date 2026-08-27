import { describe, expect, it } from 'vitest';
import {
  passAdmissions,
  passOrderTotals,
  passWorthClause,
  passWorthLine,
  type PassType,
} from './filmPass';

function pass(overrides: Partial<PassType> = {}): PassType {
  return {
    id: 'p1',
    name: '10-Film Pass',
    price: 60,
    initial_balance: 60,
    redemption_price: 6,
    ticket_face_value: null,
    expiration_days: null,
    image_path: null,
    fine_print: null,
    festival_slug: null,
    ...overrides,
  };
}

describe('passOrderTotals', () => {
  it('rounds tax per pass, so two cost exactly twice one', () => {
    // The server rounds per pass. A total-then-round would drift from what
    // Square charges on prices whose 6% lands on a half cent.
    const one = passOrderTotals(pass({ price: 12.75 }), 1);
    const two = passOrderTotals(pass({ price: 12.75 }), 2);
    expect(two.total).toBeCloseTo(one.total * 2, 10);
    expect(two.taxDue).toBeCloseTo(one.taxDue * 2, 10);
  });

  it('adds 6% on top of the listed price', () => {
    const { subtotal, taxDue, total } = passOrderTotals(pass({ price: 50 }), 1);
    expect(subtotal).toBe(50);
    expect(taxDue).toBe(3);
    expect(total).toBe(53);
  });

  it('scales with quantity', () => {
    const { subtotal, total } = passOrderTotals(pass({ price: 60 }), 3);
    expect(subtotal).toBe(180);
    expect(total).toBeCloseTo(190.8, 10);
  });

  it('never leaves a fraction of a cent in the total', () => {
    for (const price of [9.99, 12.75, 13.33, 47.5]) {
      for (const qty of [1, 2, 3, 7, 10]) {
        const { total } = passOrderTotals(pass({ price }), qty);
        expect(Math.round(total * 100)).toBeCloseTo(total * 100, 6);
      }
    }
  });
});

describe('passAdmissions', () => {
  it('divides the balance by the redemption price', () => {
    expect(passAdmissions(pass({ initial_balance: 60, redemption_price: 6 }))).toBe(10);
  });

  it('rounds down rather than promising an admission the balance cannot cover', () => {
    expect(passAdmissions(pass({ initial_balance: 50, redemption_price: 6 }))).toBe(8);
  });

  it('survives a zero redemption price instead of returning Infinity', () => {
    expect(passAdmissions(pass({ initial_balance: 50, redemption_price: 0 }))).toBe(50);
  });
});

describe('passWorthLine', () => {
  it('leads with the door price, not the redemption price', () => {
    // The reason to buy is the $8 seat, not the $6 of balance it spends.
    const line = passWorthLine(pass({ ticket_face_value: 8 }));
    expect(line).toBe('Good for 10 films — tickets that cost $8.00 each at the door.');
    expect(line).not.toContain('$6.00');
  });

  it('states only the count when no face value is set', () => {
    expect(passWorthLine(pass())).toBe('Good for 10 films.');
  });
});

describe('passWorthClause', () => {
  it('lowercases only the first letter, leaving the money intact', () => {
    expect(passWorthClause(pass({ ticket_face_value: 8 })))
      .toBe('good for 10 films — tickets that cost $8.00 each at the door.');
  });
});
