import { assert, assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { centsOf, planRefund, refundKey, type ClaimedTicket } from './plan.ts';

const t = (id: string, method: string, pid: string | null, total = 10.6, fee = 0): ClaimedTicket => ({
  id, payment_method: method, square_payment_id: pid, total_price: total, processing_fee: fee,
});

Deno.test('counter cash with a CASH tender id is cash, not card (L3)', () => {
  // square-cash-sale stamps the CASH tender's id on these rows; they used to
  // take the card branch and lose the "refund from the till" warning.
  const plan = planRefund([t('a', 'cash', 'CASH-PAY-1'), t('b', 'cash', 'CASH-PAY-1')]);
  assertEquals(plan.card.size, 0);
  assertEquals(plan.cash.get('CASH-PAY-1')?.map((r) => r.id), ['a', 'b']);
});

Deno.test('cash recorded before square-cash-sale existed is still cash', () => {
  const plan = planRefund([t('a', 'cash', null)]);
  assertEquals(plan.cash.get(null)?.length, 1);
});

Deno.test('card and online payments are grouped by the payment that paid them', () => {
  const plan = planRefund([t('a', 'card', 'P1'), t('b', 'online', 'P2'), t('c', 'card', 'P1')]);
  assertEquals(plan.card.get('P1')?.map((r) => r.id), ['a', 'c']);
  assertEquals(plan.card.get('P2')?.map((r) => r.id), ['b']);
});

Deno.test('passes, comps, and paid rows with no payment on file', () => {
  const plan = planRefund([t('p', 'film_pass', null, 0), t('c', 'comp', null, 0), t('m', 'card', null)]);
  assertEquals(plan.filmPass.map((r) => r.id), ['p']);
  assertEquals(plan.comp.map((r) => r.id), ['c']);
  assertEquals(plan.manual.map((r) => r.id), ['m']);
});

Deno.test('a $0 card row is not sent to Square', () => {
  const plan = planRefund([t('z', 'card', 'P1', 0)]);
  assertEquals(plan.card.size, 0);
  assertEquals(plan.comp.map((r) => r.id), ['z']);
});

Deno.test('cents include the surcharge and round per field', () => {
  assertEquals(centsOf([t('a', 'card', 'P', 10.6, 0.45), t('b', 'card', 'P', 10.6, 0)]), 2165);
});

Deno.test('refund key: order-independent, and different subsets differ', async () => {
  assertEquals(await refundKey('P', ['b', 'a']), await refundKey('P', ['a', 'b']));
  assertNotEquals(await refundKey('P', ['a']), await refundKey('P', ['a', 'b']));
  assert((await refundKey('P', ['a'])).length === 40);
});
