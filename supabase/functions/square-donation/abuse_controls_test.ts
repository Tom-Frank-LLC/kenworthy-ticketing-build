// The public donation path: rate limit, Turnstile (fail closed), and the
// tribute-text rules (audit M2, L10, L16), against the real handler with every
// outbound call stubbed. No charge is attempted in any of these: each stops
// before the pending row, and the test asserts that it did.
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/square-donation/abuse_controls_test.ts

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  BASE_ENV,
  SQUARE_TEST_ENV,
  calls,
  is,
  loadHandler,
  post,
  quietly,
  rateLimit,
  siteverify,
  useRoutes,
  verifiedBot,
  withEnv,
} from '../_shared/testing/handler_harness.ts';

const handler = await loadHandler(() => import('./index.ts'), BASE_ENV);

const gift = (over: Record<string, unknown> = {}) => ({
  action: 'create_payment',
  sourceId: 'cnon:card-nonce-ok',
  amountCents: 100,
  donorName: 'Ada Lovelace',
  donorEmail: 'ada@example.com',
  donorPhone: null,
  dedicationType: 'in_honor',
  dedicateTo: 'Charles Babbage',
  notifyName: 'Charles',
  notifyEmail: 'charles@example.com',
  message: 'For the projector.',
  turnstile_token: 'a-solved-token',
  ...over,
});

const wroteDonation = () => calls.filter((c) => is(c, 'POST', '/rest/v1/donations')).length;
const touchedSquare = () => calls.filter((c) => c.url.hostname.includes('squareup')).length;

function run(name: string, fn: () => Promise<void>) {
  Deno.test({
    name,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: () => quietly(() => withEnv(SQUARE_TEST_ENV, fn)),
  });
}

run('a link in the tribute message is refused before the bot check and before any row', async () => {
  useRoutes([rateLimit(true), siteverify(true)]);
  const res = await handler(post(gift({ message: 'Claim your refund at https://evil.example/r' })));
  assertEquals(res.status, 400);
  assertStringIncludes(await res.text(), 'evil.example');
  assertEquals(calls.filter(verifiedBot).length, 0, 'a fixable refusal does not spend the token');
  assertEquals(wroteDonation(), 0);
});

run('an over-long message or name is refused', async () => {
  useRoutes([rateLimit(true), siteverify(true)]);
  assertEquals((await handler(post(gift({ message: 'a'.repeat(1001) })))).status, 400);
  assertEquals((await handler(post(gift({ donorName: 'a'.repeat(201) })))).status, 400);
  assertEquals((await handler(post(gift({ notifyName: 'a'.repeat(201) })))).status, 400);
  assertEquals(wroteDonation(), 0);
});

run('the notify address must be an address', async () => {
  useRoutes([rateLimit(true), siteverify(true)]);
  const res = await handler(post(gift({ notifyEmail: 'not an email' })));
  assertEquals(res.status, 400);
  assertEquals(wroteDonation(), 0);
});

run('a failed bot check writes nothing and charges nothing', async () => {
  useRoutes([rateLimit(true), siteverify(false)]);
  const res = await handler(post(gift()));
  assertEquals(res.status, 403);
  assertEquals(wroteDonation(), 0);
  assertEquals(touchedSquare(), 0);
});

run('Turnstile fails CLOSED on donations when the secret is unset', async () => {
  await withEnv({ TURNSTILE_SECRET_KEY: null }, async () => {
    useRoutes([rateLimit(true), siteverify(true)]);
    const res = await handler(post(gift()));
    assertEquals(res.status, 403);
    assertEquals(wroteDonation(), 0);
  });
});

run('over the rate limit: 429 before the bot check', async () => {
  useRoutes([rateLimit(false), siteverify(true)]);
  const res = await handler(post(gift()));
  assertEquals(res.status, 429);
  assertEquals(calls.filter(verifiedBot).length, 0);
  assertEquals(wroteDonation(), 0);
});

run('the staff action is not behind Turnstile (it is behind a staff sign-in)', async () => {
  useRoutes([]);
  const res = await handler(post({ action: 'record_in_person', amountCents: 500, paymentChannel: 'cash' }));
  // Refused for want of a session — not for want of a token.
  assert(res.status === 401 || res.status === 403, String(res.status));
  assertEquals(calls.filter(verifiedBot).length, 0);
});

Deno.test({
  name: 'get_config with Square unconfigured names no environment variable (L10)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: () => quietly(async () => {
    useRoutes([]);
    const unset = Object.fromEntries(Object.keys(SQUARE_TEST_ENV).map((k) => [k, null]));
    await withEnv(unset, async () => {
      const res = await handler(post({ action: 'get_config' }));
      assertEquals(res.status, 500);
      assert(!/SQUARE_|ACCESS_TOKEN|credentials/i.test(await res.text()));
    });
  }),
});
