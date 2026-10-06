import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { checkoutMatchesOrder, logToken } from './binding.ts';

const token = '3f1c2b8e-9a7d-4e21-b6c3-0d5e8f7a1b2c';

Deno.test('a checkout started for this order confirms it', () => {
  assert(checkoutMatchesOrder({ reference_id: token }, token));
});

Deno.test('a checkout for another order does not (one swipe, one sale)', () => {
  assert(!checkoutMatchesOrder({ reference_id: 'aaaaaaaa-0000-0000-0000-000000000000' }, token));
});

Deno.test('a checkout with no reference is not trusted', () => {
  assert(!checkoutMatchesOrder({}, token));
  assert(!checkoutMatchesOrder(null, token));
  assert(!checkoutMatchesOrder({ reference_id: '' }, ''));
});

Deno.test('a long token is compared as start_sale wrote it, cut to 40', () => {
  const long = 'x'.repeat(50);
  assert(checkoutMatchesOrder({ reference_id: 'x'.repeat(40) }, long));
});

Deno.test('logs carry 8 characters of a token, never all of it', () => {
  assertEquals(logToken(token), '3f1c2b8e…');
  assert(!logToken(token).includes(token.slice(8)));
  assertEquals(logToken(''), '(none)');
});
