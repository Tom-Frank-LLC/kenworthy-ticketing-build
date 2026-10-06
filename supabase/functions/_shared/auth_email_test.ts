// Tests for the auth-email hook's security boundary and rendering.
//
// Run: deno test --node-modules-dir=none --allow-net --allow-env \
//        supabase/functions/_shared/auth_email_test.ts
//
// The signature check is the only thing standing between this endpoint and an
// open password-reset relay, so it gets the bulk of the coverage.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { verifyStandardWebhook, normalizeSecret, WEBHOOK_TOLERANCE_SECONDS } from './webhook.ts';
import {
  buildVerifyUrl,
  buildAuthEmailHtml,
  buildAuthEmailText,
  copyFor,
  deliverableWithoutRole,
  esc,
  holdsSignInRole,
} from './auth-email.ts';

// A real-looking secret: 24 random bytes, base64. Not a live credential.
const SECRET_B64 = 'c3VwZXJzZWNyZXR2YWx1ZWZvcnRlc3Rpbmcxc2VjcmV0';
const SECRET = `v1,whsec_${SECRET_B64}`;

async function sign(body: string, id: string, ts: string, secretB64 = SECRET_B64) {
  const key = await crypto.subtle.importKey(
    'raw',
    normalizeSecret(secretB64) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)),
  );
  let bin = '';
  for (const b of mac) bin += String.fromCharCode(b);
  return `v1,${btoa(bin)}`;
}

const NOW = 1_760_000_000;
const BODY = JSON.stringify({ user: { email: 'a@b.com' }, email_data: { email_action_type: 'recovery' } });

Deno.test('accepts a correctly signed request', async () => {
  const id = 'msg_1', ts = String(NOW);
  const signature = await sign(BODY, id, ts);
  const r = await verifyStandardWebhook(BODY, { id, timestamp: ts, signature }, SECRET, NOW);
  assertEquals(r.ok, true);
});

Deno.test('accepts the secret however the dashboard presents it', async () => {
  const id = 'msg_1', ts = String(NOW);
  const signature = await sign(BODY, id, ts);
  for (const form of [SECRET, `whsec_${SECRET_B64}`, SECRET_B64]) {
    const r = await verifyStandardWebhook(BODY, { id, timestamp: ts, signature }, form, NOW);
    assertEquals(r.ok, true, `failed for secret form: ${form.slice(0, 12)}…`);
  }
});

Deno.test('rejects a tampered body — the forgery case that matters', async () => {
  const id = 'msg_1', ts = String(NOW);
  const signature = await sign(BODY, id, ts);
  const tampered = JSON.stringify({
    user: { email: 'attacker@evil.com' },
    email_data: { email_action_type: 'recovery' },
  });
  const r = await verifyStandardWebhook(tampered, { id, timestamp: ts, signature }, SECRET, NOW);
  assertEquals(r.ok, false);
});

Deno.test('rejects a signature made with the wrong secret', async () => {
  const id = 'msg_1', ts = String(NOW);
  const signature = await sign(BODY, id, ts, 'b3RoZXJzZWNyZXR2YWx1ZWZvcnRlc3RpbmcxMjM0');
  const r = await verifyStandardWebhook(BODY, { id, timestamp: ts, signature }, SECRET, NOW);
  assertEquals(r.ok, false);
});

Deno.test('rejects replays outside the timestamp window', async () => {
  const id = 'msg_1', ts = String(NOW - WEBHOOK_TOLERANCE_SECONDS - 1);
  const signature = await sign(BODY, id, ts);
  const r = await verifyStandardWebhook(BODY, { id, timestamp: ts, signature }, SECRET, NOW);
  assertEquals(r.ok, false);
  // ...but a request inside the window is fine.
  const ts2 = String(NOW - 30);
  const sig2 = await sign(BODY, id, ts2);
  assertEquals((await verifyStandardWebhook(BODY, { id, timestamp: ts2, signature: sig2 }, SECRET, NOW)).ok, true);
});

Deno.test('rejects missing or malformed headers rather than passing them through', async () => {
  const id = 'msg_1', ts = String(NOW);
  const signature = await sign(BODY, id, ts);
  const cases: Array<[string, any]> = [
    ['no id', { id: null, timestamp: ts, signature }],
    ['no timestamp', { id, timestamp: null, signature }],
    ['no signature', { id, timestamp: ts, signature: null }],
    ['non-numeric timestamp', { id, timestamp: 'yesterday', signature }],
    ['unversioned signature', { id, timestamp: ts, signature: 'deadbeef' }],
  ];
  for (const [label, headers] of cases) {
    const r = await verifyStandardWebhook(BODY, headers, SECRET, NOW);
    assertEquals(r.ok, false, `should have rejected: ${label}`);
  }
});

Deno.test('matches one signature among several during a secret rotation', async () => {
  const id = 'msg_1', ts = String(NOW);
  const good = await sign(BODY, id, ts);
  const stale = await sign(BODY, id, ts, 'b3RoZXJzZWNyZXR2YWx1ZWZvcnRlc3RpbmcxMjM0');
  const r = await verifyStandardWebhook(BODY, { id, timestamp: ts, signature: `${stale} ${good}` }, SECRET, NOW);
  assertEquals(r.ok, true);
});

// --- link + copy ------------------------------------------------------------

Deno.test('verify URL points at the auth server and carries the token', () => {
  const url = buildVerifyUrl('https://proj.supabase.co/', 'HASH123', 'recovery', 'https://site.test/reset-password');
  assertEquals(url.startsWith('https://proj.supabase.co/auth/v1/verify?'), true);
  assertEquals(url.includes('token=HASH123'), true);
  assertEquals(url.includes('type=recovery'), true);
  assertEquals(url.includes('redirect_to=https%3A%2F%2Fsite.test%2Freset-password'), true);
});

Deno.test('verify URL omits redirect_to when there is none', () => {
  const url = buildVerifyUrl('https://proj.supabase.co', 'H', 'signup', '');
  assertEquals(url.includes('redirect_to'), false);
});

Deno.test('each action type gets its own subject', () => {
  assertEquals(copyFor('recovery').subject, 'Reset your Kenworthy password');
  assertEquals(copyFor('signup').subject, 'Confirm your email address');
  // Unknown types fall back rather than throwing — a new Supabase action type
  // should degrade to a sane email, not a 500.
  assertEquals(copyFor('something_new').subject, copyFor('magiclink').subject);
});

Deno.test('recovery email carries the link, not a bare code', () => {
  const html = buildAuthEmailHtml({ action: 'recovery', verifyUrl: 'https://x.test/verify?token=abc', token: '123456' });
  assertEquals(html.includes('https://x.test/verify?token=abc'), true);
  assertEquals(html.includes('Reset password'), true);
});

Deno.test('reauthentication shows the code and no link', () => {
  const html = buildAuthEmailHtml({ action: 'reauthentication', verifyUrl: 'https://x.test/verify', token: '654321' });
  assertEquals(html.includes('654321'), true);
  assertEquals(html.includes('https://x.test/verify'), false);
});

Deno.test('text part stands alone and stays free of markup', () => {
  const text = buildAuthEmailText({ action: 'recovery', verifyUrl: 'https://x.test/v?t=1', token: '' });
  assertEquals(text.includes('https://x.test/v?t=1'), true);
  assertEquals(text.includes('<'), false);
});

Deno.test('escaping neutralises markup in interpolated values', () => {
  assertEquals(esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
  const html = buildAuthEmailHtml({ action: 'recovery', verifyUrl: 'https://x.test/"><script>alert(1)</script>' });
  assertEquals(html.includes('<script>alert(1)</script>'), false);
});

// ---------------------------------------------------------------------------
// H1: no way in for an account without a sign-in role.
// ---------------------------------------------------------------------------

Deno.test('H1: a role-less account is sent nothing that signs in', () => {
  for (const action of [
    'recovery', 'magiclink', 'signup', 'email_change', 'email_change_current',
    'email_change_new', 'reauthentication', 'email', 'some_future_type',
  ]) {
    assertEquals(deliverableWithoutRole(action), false, action);
  }
});

Deno.test('H1: invites and token-less notices still go to a role-less account', () => {
  // invite-staff grants the role only after inviteUserByEmail returns.
  assertEquals(deliverableWithoutRole('invite'), true);
  assertEquals(deliverableWithoutRole('password_changed_notification'), true);
});

function rolesStub(status: number, rows: unknown) {
  const urls: string[] = [];
  const impl = ((url: string) => {
    urls.push(url);
    return Promise.resolve(new Response(JSON.stringify(rows), { status }));
  }) as unknown as typeof fetch;
  return { urls, impl };
}

const ENV = { url: 'https://p.example/', serviceKey: 'svc' };

Deno.test('holdsSignInRole asks only for the sign-in roles', async () => {
  const s = rolesStub(200, [{ role: 'staff' }]);
  assertEquals(await holdsSignInRole('u1', ENV, s.impl), true);
  const u = new URL(s.urls[0]);
  assertEquals(u.pathname, '/rest/v1/user_roles');
  assertEquals(u.searchParams.get('user_id'), 'eq.u1');
  assertEquals(u.searchParams.get('role'), 'in.(staff,host,admin,superadmin)');
});

Deno.test('a buyer (regular_user only) holds no sign-in role', async () => {
  assertEquals(await holdsSignInRole('u1', ENV, rolesStub(200, []).impl), false);
});

Deno.test('a failed lookup is null — the hook fails closed, not open', async () => {
  assertEquals(await holdsSignInRole('u1', ENV, rolesStub(500, { message: 'x' }).impl), null);
  const throwing = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
  assertEquals(await holdsSignInRole('u1', ENV, throwing), null);
  assertEquals(await holdsSignInRole('', ENV, rolesStub(200, []).impl), null);
});
