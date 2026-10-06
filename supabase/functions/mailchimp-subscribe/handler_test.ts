// mailchimp-subscribe against a stubbed Mailchimp. The real audience is shared
// with production, so nothing here may reach it: `fetch` is always the stub.
//
// Pins security audit 2026-10-06 M1 (a JWT is not staff) and M7 (anonymous
// callers create, never update), plus the redaction of provider errors.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { type CallerKind, createHandler } from './handler.ts';

interface Call { url: string; method: string; body: any }

function mailchimp(responses: Array<[number, unknown]>) {
  const calls: Call[] = [];
  let i = 0;
  const impl = ((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    const [status, body] = responses[Math.min(i++, responses.length - 1)];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function handler(kind: CallerKind, mc: ReturnType<typeof mailchimp>, logs: unknown[][] = [], allowed = true) {
  return createHandler({
    fetch: mc.impl,
    classify: () => Promise.resolve(kind),
    allow: () => Promise.resolve(allowed),
    config: { apiKey: 'k-us1', server: 'us1', audienceId: 'aud' },
    log: (...a: unknown[]) => { logs.push(a); },
  });
}

function post(body: unknown) {
  return new Request('https://fn.example/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const HOSTILE = {
  email: 'patron@example.com',
  first_name: 'Click',
  last_name: 'evil.example',
  tags: ['donor', 'vip-free-tickets'],
  source: 'anything I like',
  status: 'subscribed',
  merge_fields: { LTV_TICKETS: 9999 },
  interests: { abc: true },
  unsubscribe: true,
};

Deno.test('M7: an anonymous caller can only create — POST, pending, names, allowlisted tags', async () => {
  const mc = mailchimp([[200, { id: 'x' }]]);
  const res = await handler('anonymous', mc)(post(HOSTILE));
  assertEquals(res.status, 200);
  assertEquals(mc.calls.length, 1);
  const c = mc.calls[0];
  assertEquals(c.method, 'POST');
  assertEquals(c.url, 'https://us1.api.mailchimp.com/3.0/lists/aud/members');
  assertEquals(c.body.status, 'pending');
  assertEquals(c.body.merge_fields, { FNAME: 'Click', LNAME: 'evil.example' });
  assertEquals(c.body.tags, ['donor']); // free-form tag and free-form source both dropped
  assertEquals('interests' in c.body, false);
});

Deno.test('M7: an existing member is left untouched, and the answer is the same as success', async () => {
  const mc = mailchimp([[400, { title: 'Member Exists', detail: 'patron@example.com is already a list member.' }]]);
  const res = await handler('anonymous', mc)(post({ email: 'patron@example.com', first_name: 'Rewritten' }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
  // One call, a create. No PUT, no PATCH, no tag write followed it.
  assertEquals(mc.calls.map((c) => c.method), ['POST']);
});

Deno.test('M1: an anonymous caller cannot unsubscribe anyone', async () => {
  const mc = mailchimp([[200, {}]]);
  await handler('anonymous', mc)(post({ email: 'someone@example.com', unsubscribe: true }));
  assertEquals(mc.calls.some((c) => c.method === 'PATCH'), false);
});

Deno.test('anonymous callers are rate limited before Mailchimp is called', async () => {
  const mc = mailchimp([[200, {}]]);
  const res = await handler('anonymous', mc, [], false)(post({ email: 'a@example.com' }));
  assertEquals(res.status, 429);
  assertEquals(mc.calls.length, 0);
});

Deno.test('L10/L15: provider errors are summarised — no address in the log or the response', async () => {
  const logs: unknown[][] = [];
  const mc = mailchimp([[400, { title: 'Invalid Resource', detail: 'patron@example.com looks fake or invalid' }]]);
  const res = await handler('anonymous', mc, logs)(post({ email: 'patron@example.com' }));
  assertEquals(res.status, 502);
  const text = await res.text();
  assertEquals(text.includes('patron@example.com'), false);
  assertEquals(text.includes('Invalid Resource'), false);
  assertEquals(JSON.stringify(logs).includes('patron@example.com'), false);
  assertEquals(JSON.stringify(logs).includes('400 Invalid Resource'), true);
});

Deno.test('trusted callers keep the upsert, merge fields, interests and tags', async () => {
  const mc = mailchimp([[200, { id: 'm1' }], [200, {}]]);
  const res = await handler('trusted', mc)(post({
    email: 'patron@example.com',
    first_name: 'Pat',
    tags: ['ticket-buyer'],
    source: 'backfill',
    merge_fields: { LTV_TICKETS: 12 },
    interests: { abc: true },
  }));
  assertEquals(res.status, 200);
  assertEquals(mc.calls.map((c) => c.method), ['PUT', 'POST']);
  assertEquals(mc.calls[0].body.merge_fields, { FNAME: 'Pat', LTV_TICKETS: 12 });
  assertEquals(mc.calls[0].body.interests, { abc: true });
  assertEquals(mc.calls[1].body.tags.map((t: any) => t.name), ['ticket-buyer', 'source:backfill']);
});

Deno.test('even trusted callers cannot mint a free-form source tag', async () => {
  const mc = mailchimp([[200, { id: 'm1' }], [200, {}]]);
  await handler('trusted', mc)(post({ email: 'p@example.com', tags: ['newsletter'], source: 'Click here' }));
  assertEquals(mc.calls[1].body.tags.map((t: any) => t.name), ['newsletter']);
});

Deno.test('trusted unsubscribe still works', async () => {
  const mc = mailchimp([[200, {}]]);
  const res = await handler('trusted', mc)(post({ email: 'p@example.com', unsubscribe: true }));
  assertEquals((await res.json()).unsubscribed, true);
  assertEquals(mc.calls[0].method, 'PATCH');
});
