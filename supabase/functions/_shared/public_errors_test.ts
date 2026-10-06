// What a patron sees when Square refuses a payment (audit L10).
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/_shared/public_errors_test.ts

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { publicDeclineMessage } from './public_errors.ts';

const sq = (code: string, category = 'PAYMENT_METHOD_ERROR') => ({
  errors: [{ category, code, detail: `Authorization error: '${code}'` }],
});

Deno.test("Square's own detail never reaches the patron", () => {
  for (const code of ['GENERIC_DECLINE', 'CVV_FAILURE', 'INSUFFICIENT_FUNDS', 'CARD_DECLINED_VERIFICATION_REQUIRED']) {
    const msg = publicDeclineMessage(sq(code));
    assert(!msg.includes('Authorization error'), msg);
    assert(!msg.includes(code), msg);
  }
});

Deno.test('fixable declines say what to fix', () => {
  assertStringIncludes(publicDeclineMessage(sq('CVV_FAILURE')), 'security code');
  assertStringIncludes(publicDeclineMessage(sq('ADDRESS_VERIFICATION_FAILURE')), 'postal code');
  assertStringIncludes(publicDeclineMessage(sq('INVALID_EXPIRATION')), 'expiry');
});

Deno.test('every other decline gets one sentence — no live-card oracle for a tester', () => {
  const generic = publicDeclineMessage(sq('GENERIC_DECLINE'));
  assertEquals(publicDeclineMessage(sq('INSUFFICIENT_FUNDS')), generic);
  assertEquals(publicDeclineMessage(sq('CARD_NOT_SUPPORTED')), generic);
  assertEquals(publicDeclineMessage({}), generic);
  assertEquals(publicDeclineMessage(null), generic);
});

Deno.test('a refusal that is not about the card does not send the patron to their bank', () => {
  const msg = publicDeclineMessage(sq('UNAUTHORIZED', 'AUTHENTICATION_ERROR'));
  assert(!/declined/i.test(msg), msg);
  assertStringIncludes(msg, 'not charged');
});

Deno.test('a spent card token asks for the card again', () => {
  assertStringIncludes(publicDeclineMessage(sq('CARD_TOKEN_USED', 'INVALID_REQUEST_ERROR')), 're-enter your card');
});
