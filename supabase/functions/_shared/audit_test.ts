import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isSecretKey, redact } from './audit.ts';

/**
 * The redaction rule, pinned on both sides of the wire.
 *
 * The database trigger redacts row diffs through audit_is_secret_key(), and a
 * migration test covers that copy. This covers the Deno copy, which handles the
 * `details` an edge function hands to logAudit — a payload the trigger never
 * sees, because no row changed. The two rules have to agree; when they drift,
 * the side that drifts loose writes a credential into a table that every admin
 * can read, and nothing in the log looks wrong afterwards.
 *
 * The named cases below are the real fields in this schema, not hypotheticals:
 * rental_requests.invite_token opens a contract for signing, and app_config
 * holds integration settings as free-form jsonb.
 */

Deno.test('secret-shaped field names are recognised', () => {
  for (const key of [
    'invite_token',
    'access_token',
    'refresh_token',
    'checkout_idempotency_key',
    'api_key',
    'apiKey',
    'RESEND_API_KEY',
    'square_access_token',
    'webhook_secret',
    'password',
    'signature',
    'private_key',
  ]) {
    assertEquals(isSecretKey(key), true, `expected ${key} to be treated as secret`);
  }
});

Deno.test('ordinary field names are left alone', () => {
  for (const key of [
    'name',
    'price',
    'status',
    'square_catalog_id',
    'audience_id',
    'entity_key',
    'created_at',
    'email',
  ]) {
    assertEquals(isSecretKey(key), false, `expected ${key} to be kept`);
  }
});

Deno.test('app_config.key is the setting name, never redacted', () => {
  // Redacting this would leave "some setting changed" with no way to tell which.
  assertEquals(isSecretKey('key'), false);
  assertEquals(isSecretKey('KEY'), false);
});

Deno.test('redaction reaches nested objects and arrays', () => {
  const details = {
    source: 'square',
    config: {
      audience_id: 'abc123',
      api_key: 'mc-live-REAL-CREDENTIAL',
      nested: [{ access_token: 'tok-REAL-CREDENTIAL' }, { name: 'kept' }],
    },
  };
  const out = redact(details);
  assertEquals(out, {
    source: 'square',
    config: {
      audience_id: 'abc123',
      api_key: '[redacted]',
      nested: [{ access_token: '[redacted]' }, { name: 'kept' }],
    },
  });
  // The blunt check that actually matters.
  assertEquals(JSON.stringify(out).includes('REAL-CREDENTIAL'), false);
});

Deno.test('a null secret stays null so "unset -> set" is still readable', () => {
  assertEquals(redact({ invite_token: null }), { invite_token: null });
  assertEquals(redact({ invite_token: 'x' }), { invite_token: '[redacted]' });
});

Deno.test('non-objects pass through untouched', () => {
  assertEquals(redact('plain'), 'plain');
  assertEquals(redact(42), 42);
  assertEquals(redact(null), null);
  assertEquals(redact([1, 'two']), [1, 'two']);
});

// ---------------------------------------------------------------------------
// Staff actions through the service role (security audit 2026-10-06, M11)
// ---------------------------------------------------------------------------
import { ACTOR_HEADER, actorHeaders, summariseResponse } from './audit.ts';

Deno.test('the actor header is lower-case, as PostgREST exposes it', () => {
  assertEquals(ACTOR_HEADER, ACTOR_HEADER.toLowerCase());
  assertEquals(actorHeaders('u-1'), { [ACTOR_HEADER]: 'u-1' });
  assertEquals(actorHeaders(null), {});
});

Deno.test('a response summary keeps scalars and the shape of lists, not whole objects', () => {
  const s = summariseResponse({
    ok: true,
    dry_run: false,
    tally: { written: 2 },
    results: [
      { id: 'A', name: 'Film', action: 'written', object: { huge: 'x'.repeat(1000) } },
      { id: 'B', name: 'Show', action: 'refused' },
    ],
  });
  assertEquals(s.ok, true);
  assertEquals(s.tally, { written: 2 });
  assertEquals(s.results_count, 2);
  assertEquals(s.results, [
    { id: 'A', name: 'Film', action: 'written' },
    { id: 'B', name: 'Show', action: 'refused' },
  ]);
});

Deno.test('a long list is cut to 25 entries but counted whole', () => {
  const s = summariseResponse({ results: Array.from({ length: 40 }, (_, i) => ({ id: i })) });
  assertEquals(s.results_count, 40);
  assertEquals((s.results as unknown[]).length, 25);
});
