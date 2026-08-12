import { describe, expect, it } from 'vitest';
import {
  computeLineItemTotals,
  computeOrderTotals,
  computeProcessingFee,
  computeSeatTotals,
} from './booking';

/**
 * These tests protect one invariant: the total shown to the customer is the
 * total the server charges.
 *
 * The server prices every order from the database and charges the sum of the
 * ticket rows it writes, where `enforce_ticket_pricing` stores
 * `tax_amount = ROUND(price * 0.06, 2)` **per row**. Computing tax once on the
 * subtotal instead — which is what this file used to do — disagrees by a cent
 * at certain prices, and the customer would see one number and be charged
 * another.
 */
describe('order totals', () => {
  it('rounds tax per ticket, matching the database trigger', () => {
    // $8.25 × 6% = $0.495 → $0.50 per ticket, so four tickets carry $2.00 of
    // tax. Rounding once on the $33.00 subtotal would give $1.98.
    const { subtotal, tax, total } = computeOrderTotals(4, 8.25);
    expect(subtotal).toBe(33);
    expect(tax).toBe(2);
    expect(total).toBe(35);
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
    expect(tax).toBe(1.94); // 0.72 + 0.72 + 0.50
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
    expect(computeOrderTotals(0, 12)).toEqual({ subtotal: 0, tax: 0, total: 0 });
    expect(computeSeatTotals([])).toEqual({ subtotal: 0, tax: 0, total: 0 });
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
