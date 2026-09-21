import { describe, expect, it } from 'vitest';
import {
  computeLineItemTotals,
  computeOrderTotals,
  computeProcessingFee,
  computeSeatTotals,
} from './booking';

/**
 * These tests protect one invariant: the total shown to the customer is the
 * total the server charges — and the total Square arrives at for the same order.
 *
 * The server prices every order from the database and charges the sum of the
 * ticket rows it writes. Tax is the ORDER's: 6% of the subtotal, once, rounded
 * half-to-even, because that is how Square totals an order and a Square order
 * that disagrees with the charge is thrown away. This file used to pin the
 * opposite rule (tax rounded per ticket), which matched an older database
 * trigger and not Square. `orderMath.test.ts` holds the Square-measured cases.
 */
describe('order totals', () => {
  it('taxes the order once, the way Square does', () => {
    // $8.25 × 4 is a $33.00 subtotal; 6% of that is $1.98. This used to assert
    // $2.00 — four tickets at $0.495 → $0.50 each — which is what the database
    // trigger stored then and is NOT what Square totals. See orderMath.ts.
    const { subtotal, tax, total } = computeOrderTotals(4, 8.25);
    expect(subtotal).toBe(33);
    expect(tax).toBe(1.98);
    expect(total).toBe(34.98);
  });

  it('rounds a half-cent up, in integer cents rather than floating point', () => {
    // 4.25 * 6% = 0.255. In doubles, 4.25 * 0.06 * 100 is 25.499999999999996,
    // which rounds *down* to $0.25 while Postgres computes 25.5 exactly and
    // stores $0.26. Quoting 0.25 and charging 0.26 is the bug this pins.
    const { subtotal, tax, total } = computeOrderTotals(1, 4.25);
    expect(subtotal).toBe(4.25);
    expect(tax).toBe(0.26);
    expect(total).toBe(4.51);
  });

  it('agrees across the three entry points for the same tickets', () => {
    const plain = computeOrderTotals(4, 8.25);
    const tiered = computeLineItemTotals([
      { tierId: 't', tierName: 'General', price: 8.25, quantity: 4 },
    ]);
    const seated = computeSeatTotals([8.25, 8.25, 8.25, 8.25]);

    expect(tiered.subtotal).toBe(plain.subtotal);
    expect(tiered.tax).toBe(plain.tax);
    expect(tiered.total).toBe(plain.total);
    expect(tiered.totalCount).toBe(4);
    expect(seated).toEqual(plain);
  });

  it('mixes tiers at their own prices', () => {
    const { subtotal, tax, total, totalCount } = computeLineItemTotals([
      { tierId: 'a', tierName: 'Adult', price: 12, quantity: 2 },
      { tierId: 'b', tierName: 'Student', price: 8.25, quantity: 1 },
    ]);
    expect(subtotal).toBe(32.25);
    expect(tax).toBe(1.94); // 6% of 32.25 is 1.935 — a tie, and 193 is odd, so up
    expect(total).toBe(34.19);
    expect(totalCount).toBe(3);
  });

  it('prices seats individually when each seat has its own tier', () => {
    const { subtotal, tax, total } = computeSeatTotals([20, 15, 10]);
    expect(subtotal).toBe(45);
    expect(tax).toBe(2.7);
    expect(total).toBe(47.7);
  });

  it('handles an empty selection', () => {
    expect(computeOrderTotals(0, 12)).toEqual({ subtotal: 0, discount: null, tax: 0, total: 0 });
    expect(computeSeatTotals([])).toEqual({ subtotal: 0, discount: null, tax: 0, total: 0 });
  });
});

describe('processing fee', () => {
  it('grosses up so the theatre nets the ticket total', () => {
    const { fee, total } = computeProcessingFee(100, 'online');
    // 2.9% + $0.30 taken from the larger charge still leaves $100.
    expect(total).toBeCloseTo(103.3, 2);
    expect(fee).toBeCloseTo(3.3, 2);
    expect(Math.round((total - (total * 0.029 + 0.3)) * 100) / 100).toBeCloseTo(100, 1);
  });

  it('charges the lower card-present rate in the room', () => {
    const online = computeProcessingFee(50, 'online').fee;
    const inPerson = computeProcessingFee(50, 'in_person').fee;
    expect(inPerson).toBeLessThan(online);
  });
});
