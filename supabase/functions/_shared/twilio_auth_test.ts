// Which credential Twilio gets, and in which position.
//
// The trap this guards: an API key is username = key SID, password = key
// secret, while the account SID stays in the URL path. Putting the account SID
// in the username position with an API key secret fails with a 401 that reads
// like a bad credential rather than a misplaced one.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { twilioAuth } from './deliver.ts';

const decode = (header: string) => atob(header.replace(/^Basic\s+/, ''));

Deno.test('an API key authenticates as key SID : key secret', () => {
  const r = twilioAuth({
    accountSid: 'ACaaaa',
    authToken: 'ignored-when-a-key-is-present',
    apiKeySid: 'SKbbbb',
    apiKeySecret: 'seekrit',
  });
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.mode, 'api_key');
  // The key SID is the username — NOT the account SID.
  assertEquals(decode(r.header), 'SKbbbb:seekrit');
});

Deno.test('the auth token still works when no API key is configured', () => {
  const r = twilioAuth({ accountSid: 'ACaaaa', authToken: 'tok', apiKeySid: '', apiKeySecret: '' });
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.mode, 'auth_token');
  assertEquals(decode(r.header), 'ACaaaa:tok');
});

Deno.test('the account SID is required in both modes — it identifies the account in the URL', () => {
  assertEquals(
    twilioAuth({ accountSid: '', authToken: 't', apiKeySid: 'SK', apiKeySecret: 's' }).ok,
    false,
  );
  assertEquals(
    twilioAuth({ accountSid: '', authToken: 't', apiKeySid: '', apiKeySecret: '' }).ok,
    false,
  );
});

Deno.test('a half-configured API key is refused rather than silently falling back', () => {
  // Falling back to the auth token here would mask the misconfiguration and
  // quietly keep using the credential the operator was trying to stop using.
  const r = twilioAuth({ accountSid: 'ACaaaa', authToken: 'tok', apiKeySid: 'SKbbbb', apiKeySecret: '' });
  assertEquals(r.ok, false);
  if (r.ok) return;
  assertEquals(r.error.includes('TWILIO_API_KEY_SECRET'), true);
});

Deno.test('no credentials at all names both options', () => {
  const r = twilioAuth({ accountSid: 'ACaaaa', authToken: '', apiKeySid: '', apiKeySecret: '' });
  assertEquals(r.ok, false);
  if (r.ok) return;
  assertEquals(r.error.includes('TWILIO_API_KEY_SID'), true);
  assertEquals(r.error.includes('TWILIO_AUTH_TOKEN'), true);
});
