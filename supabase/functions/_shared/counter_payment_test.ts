import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { counterPaymentProblem } from './counter_payment.ts';

const good = {
  found: true,
  payment: { status: 'COMPLETED', location_id: 'LOC', total_money: { amount: 6360 } },
  locationId: 'LOC',
  dueCents: 6360,
  alreadyUsed: false,
};

Deno.test('a completed payment for the pass, at this location, unused: accepted', () => {
  assertEquals(counterPaymentProblem(good), null);
});

Deno.test('an id Square does not know is refused', () => {
  assert(counterPaymentProblem({ ...good, found: false, payment: null }));
});

Deno.test('a payment that already paid for something else is refused (L1)', () => {
  assert(counterPaymentProblem({ ...good, alreadyUsed: true })?.startsWith('That card payment already'));
});

Deno.test('an incomplete, foreign, refunded or short payment is refused', () => {
  assert(counterPaymentProblem({ ...good, payment: { ...good.payment, status: 'APPROVED' } }));
  assert(counterPaymentProblem({ ...good, payment: { ...good.payment, location_id: 'OTHER' } }));
  assert(counterPaymentProblem({ ...good, payment: { ...good.payment, refunded_money: { amount: 100 } } }));
  assert(counterPaymentProblem({ ...good, payment: { ...good.payment, total_money: { amount: 6359 } } }));
});
