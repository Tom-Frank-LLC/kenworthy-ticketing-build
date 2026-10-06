// Server-side Turnstile: the posture when the secret is unset, and what counts
// as a pass. No network — `fetchImpl` stands in for Cloudflare.
//
// Run: deno test --allow-env --node-modules-dir=none supabase/functions/_shared/turnstile_test.ts

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { VERIFY_URL, verifyTurnstile } from './turnstile.ts';

function cloudflare(answer: unknown, status = 200) {
  const calls: Array<{ url: string; form: FormData }> = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, form: init.body as FormData });
    const body = typeof answer === 'string' ? answer : JSON.stringify(answer);
    return Promise.resolve(new Response(body, { status }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const quiet = <T>(fn: () => Promise<T>) => async () => {
  const [w, e] = [console.warn, console.error];
  console.warn = () => {};
  console.error = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; }
};

Deno.test('a money path with no secret REFUSES, and asks Cloudflare nothing', quiet(async () => {
  const cf = cloudflare({ success: true });
  const v = await verifyTurnstile('tok', '1.2.3.4', {
    whenUnset: 'refuse', label: 't', secret: '', fetchImpl: cf.fetchImpl,
  });
  assertEquals(v, { ok: false, reason: 'unconfigured' });
  assertEquals(cf.calls.length, 0);
}));

Deno.test('the rental form with no secret still accepts — its deliberate posture', quiet(async () => {
  const v = await verifyTurnstile('', null, { whenUnset: 'allow', label: 't', secret: '' });
  assertEquals(v, { ok: true, reason: 'unconfigured' });
}));

Deno.test('a missing, non-string or oversized token is refused without a round trip', quiet(async () => {
  const cf = cloudflare({ success: true });
  for (const token of [undefined, null, '', '   ', 42, 'x'.repeat(2049)]) {
    const v = await verifyTurnstile(token, null, {
      whenUnset: 'refuse', label: 't', secret: 's', fetchImpl: cf.fetchImpl,
    });
    assertEquals(v.ok, false, `token ${String(token).slice(0, 10)}`);
  }
  assertEquals(cf.calls.length, 0);
}));

Deno.test('Cloudflare saying yes passes, with the secret, token and caller sent', quiet(async () => {
  const cf = cloudflare({ success: true });
  const v = await verifyTurnstile('tok-abc', '203.0.113.9', {
    whenUnset: 'refuse', label: 't', secret: 'sek', fetchImpl: cf.fetchImpl,
  });
  assertEquals(v, { ok: true, reason: 'verified' });
  assertEquals(cf.calls[0].url, VERIFY_URL);
  assertEquals(cf.calls[0].form.get('secret'), 'sek');
  assertEquals(cf.calls[0].form.get('response'), 'tok-abc');
  assertEquals(cf.calls[0].form.get('remoteip'), '203.0.113.9');
}));

Deno.test('a spent token (timeout-or-duplicate) is refused — why the page fetches a fresh one', quiet(async () => {
  const cf = cloudflare({ success: false, 'error-codes': ['timeout-or-duplicate'] });
  const v = await verifyTurnstile('tok', null, {
    whenUnset: 'refuse', label: 't', secret: 's', fetchImpl: cf.fetchImpl,
  });
  assertEquals(v, { ok: false, reason: 'rejected', codes: ['timeout-or-duplicate'] });
}));

Deno.test('a check that could not be performed is a failure, in either posture', quiet(async () => {
  const garbage = cloudflare('<html>bad gateway</html>', 502);
  const thrower = (() => Promise.reject(new Error('dns'))) as unknown as typeof fetch;
  for (const whenUnset of ['allow', 'refuse'] as const) {
    assertEquals(
      (await verifyTurnstile('tok', null, { whenUnset, label: 't', secret: 's', fetchImpl: garbage.fetchImpl })).ok,
      false,
    );
    assertEquals(
      (await verifyTurnstile('tok', null, { whenUnset, label: 't', secret: 's', fetchImpl: thrower })).ok,
      false,
    );
  }
}));
