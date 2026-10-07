// The OAuth state and return-path rules for qbo-sync (security audit
// 2026-10-06, L4).
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/qbo-sync/oauth_state_test.ts

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  DEFAULT_RETURN_TO,
  makeState,
  returnUrl,
  safeReturnPath,
  STATE_TTL_MS,
  stateSecret,
  verifyState,
  type StateBody,
} from './oauth_state.ts';

const SECRET = 'qbo-state-secret-for-tests';
const body = (over: Partial<StateBody> = {}): StateBody => ({
  u: '00000000-0000-0000-0000-0000000000d1',
  e: 'sandbox',
  r: '/admin?tab=accounting',
  n: '11111111-1111-1111-1111-111111111111',
  t: 1_000_000,
  ...over,
});

Deno.test('a state round-trips under its own secret', async () => {
  const s = await makeState(body(), SECRET);
  assertEquals(await verifyState(s, SECRET, 1_000_000 + 1000), body());
});

Deno.test('a state signed with any other key is refused (no service-role key reuse)', async () => {
  const s = await makeState(body(), 'the-service-role-key');
  await assertRejects(() => verifyState(s, SECRET, 1_000_000), Error, 'signature');
});

Deno.test('a tampered payload is refused', async () => {
  const s = await makeState(body(), SECRET);
  const [, sig] = s.split('.');
  const forged = btoa(JSON.stringify(body({ u: 'attacker' }))).replace(/=+$/, '');
  await assertRejects(() => verifyState(`${forged}.${sig}`, SECRET, 1_000_000), Error, 'signature');
});

Deno.test('malformed states are refused', async () => {
  for (const s of ['', 'abc', 'a.b.c', '.sig', 'payload.']) {
    await assertRejects(() => verifyState(s, SECRET, 1_000_000), Error);
  }
});

Deno.test('a state older than the TTL is refused', async () => {
  const s = await makeState(body(), SECRET);
  await assertRejects(() => verifyState(s, SECRET, 1_000_000 + STATE_TTL_MS + 1), Error, 'expired');
});

Deno.test('a signed state carrying an off-site return path is still refused', async () => {
  const s = await makeState(body({ r: '//evil.example' }), SECRET);
  await assertRejects(() => verifyState(s, SECRET, 1_000_000), Error, 'Malformed');
});

Deno.test('safeReturnPath keeps paths on this site', () => {
  assertEquals(safeReturnPath('/admin?tab=accounting'), '/admin?tab=accounting');
  assertEquals(safeReturnPath('/admin?tab=accounting#qbo'), '/admin?tab=accounting#qbo');
  assertEquals(safeReturnPath('/a/../admin'), '/admin');
});

Deno.test('safeReturnPath refuses everything else (same rule as src/lib/safeUrl.ts)', () => {
  for (const bad of [
    '@evil.tld', '//evil.example', '/\\evil.example', '\\\\evil.example', 'https://evil.example',
    'javascript:alert(1)', '/\t/evil.example', '/..//evil.example', 'admin', '', null, undefined, 42, {},
  ]) {
    assertEquals(safeReturnPath(bad), DEFAULT_RETURN_TO, `refused: ${JSON.stringify(bad)}`);
  }
});

Deno.test('returnUrl adds its query to the configured origin, with ? or & as needed', () => {
  assertEquals(
    returnUrl('https://kenworthy.org', '/admin?tab=accounting', { qbo: 'connected', realm: '123' }),
    'https://kenworthy.org/admin?tab=accounting&qbo=connected&realm=123',
  );
  assertEquals(returnUrl('https://kenworthy.org/', '/admin', { qbo: 'error', message: 'a b&c' }),
    'https://kenworthy.org/admin?qbo=error&message=a+b%26c');
  assertEquals(returnUrl('https://kenworthy.org', '//evil.example', { qbo: 'error' }),
    'https://kenworthy.org/admin?tab=accounting&qbo=error');
});

Deno.test('stateSecret never falls back to another key', () => {
  const saved = Deno.env.get('QBO_STATE_SECRET');
  try {
    Deno.env.delete('QBO_STATE_SECRET');
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'srk');
    assertEquals(stateSecret(), null);
    Deno.env.set('QBO_STATE_SECRET', '   ');
    assertEquals(stateSecret(), null);
    Deno.env.set('QBO_STATE_SECRET', ' s3cret ');
    assertEquals(stateSecret(), 's3cret');
  } finally {
    if (saved === undefined) Deno.env.delete('QBO_STATE_SECRET'); else Deno.env.set('QBO_STATE_SECRET', saved);
  }
});
