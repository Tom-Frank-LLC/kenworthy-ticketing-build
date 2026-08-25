import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { callerIp, checkRateLimit, hashIdentifier, LIMITS } from './rate_limit.ts';

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/', { headers });
}

/** A stub `admin` whose rpc returns whatever the test wants, and records the call. */
function stubAdmin(result: unknown, error: unknown = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve({ data: result, error });
    },
  };
}

Deno.test('cf-connecting-ip is preferred — it is the one the edge runtime actually sets', () => {
  assertEquals(callerIp(req({ 'cf-connecting-ip': '1.2.3.4' })), '1.2.3.4');
});

Deno.test('x-forwarded-for is a fallback, and only its first entry', () => {
  // Observed shape on Supabase: the address repeated, then a proxy hop.
  assertEquals(
    callerIp(req({ 'x-forwarded-for': '1.2.3.4,1.2.3.4, 99.82.172.149' })),
    '1.2.3.4',
  );
});

Deno.test('no identifying header at all yields null rather than a shared bucket', () => {
  // The alternative — a constant fallback like "unknown" — would put every
  // header-less caller in one bucket and let them exhaust each other's
  // allowance. Null means "do not limit", which is the safer failure.
  assertEquals(callerIp(req()), null);
});

Deno.test('the identifier is a SHA-256 digest, never the address', async () => {
  const digest = await hashIdentifier('203.0.113.9');
  assertEquals(digest.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(digest), true);
  assertNotEquals(digest.includes('203.0.113.9'), true);
});

Deno.test('the same address always hashes the same, different ones differ', async () => {
  assertEquals(await hashIdentifier('198.51.100.1'), await hashIdentifier('198.51.100.1'));
  assertNotEquals(await hashIdentifier('198.51.100.1'), await hashIdentifier('198.51.100.2'));
});

Deno.test('an allowed verdict passes through', async () => {
  const admin = stubAdmin({ allowed: true, count: 3, limit: 15, retry_after: 42 });
  const v = await checkRateLimit(admin, req({ 'cf-connecting-ip': '1.2.3.4' }), 'donation', 15, 600);
  assertEquals(v.allowed, true);
  assertEquals(v.retryAfter, 42);
});

Deno.test('a refusal carries retry_after so the caller can say how long', async () => {
  const admin = stubAdmin({ allowed: false, count: 16, limit: 15, retry_after: 300 });
  const v = await checkRateLimit(admin, req({ 'cf-connecting-ip': '1.2.3.4' }), 'donation', 15, 600);
  assertEquals(v.allowed, false);
  assertEquals(v.retryAfter, 300);
});

Deno.test('the raw address is never sent to the database', async () => {
  const admin = stubAdmin({ allowed: true, count: 1, limit: 15, retry_after: 600 });
  await checkRateLimit(admin, req({ 'cf-connecting-ip': '203.0.113.9' }), 'donation', 15, 600);
  const sent = JSON.stringify(admin.calls[0].args);
  assertEquals(sent.includes('203.0.113.9'), false);
  assertEquals(admin.calls[0].args.p_identifier, await hashIdentifier('203.0.113.9'));
});

Deno.test('a database error allows the request — this fails OPEN, deliberately', async () => {
  // The whole posture: a counter that takes checkout down when the database
  // hiccups has cost more than the abuse it was preventing.
  const admin = stubAdmin(null, { message: 'connection refused' });
  const v = await checkRateLimit(admin, req({ 'cf-connecting-ip': '1.2.3.4' }), 'donation', 15, 600);
  assertEquals(v.allowed, true);
});

Deno.test('an rpc that throws also allows', async () => {
  const admin = { rpc: () => { throw new Error('boom'); } };
  const v = await checkRateLimit(admin, req({ 'cf-connecting-ip': '1.2.3.4' }), 'donation', 15, 600);
  assertEquals(v.allowed, true);
});

Deno.test('a caller we cannot identify is allowed without touching the database', async () => {
  const admin = stubAdmin({ allowed: false, count: 99, limit: 1, retry_after: 60 });
  const v = await checkRateLimit(admin, req(), 'donation', 15, 600);
  assertEquals(v.allowed, true);
  assertEquals(admin.calls.length, 0);
});

Deno.test('every bucket is distinct, so one endpoint cannot exhaust another', () => {
  const buckets = Object.values(LIMITS).map((l) => l.bucket);
  assertEquals(new Set(buckets).size, buckets.length);
});

Deno.test('the thresholds are above any plausible human, and bounded', () => {
  for (const [name, l] of Object.entries(LIMITS)) {
    // High enough that a real visitor never meets it...
    assertEquals(l.limit >= 10, true, `${name} is too tight for a real visitor`);
    // ...and a window short enough that a refusal clears within the visit.
    assertEquals(l.windowSeconds <= 900, true, `${name} locks a caller out for too long`);
  }
});
