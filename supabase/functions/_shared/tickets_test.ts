// Tests for the pure parts of ticket delivery.
//
// Run: deno test --node-modules-dir=none supabase/functions/_shared/tickets_test.ts
//
// These cover the logic that fails *silently* in production: a phone number
// Twilio rejects, a showtime rendered in the wrong zone, or a QR that encodes
// something the door scanner will not match. Each of those produces a customer
// standing at the door with nothing, which is the failure this whole change
// exists to prevent.

import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { formatShowtime, describeSeat, formatMoney, renderQrPng, ticketPageUrl, ticketQrUrl, type OrderTicket } from './tickets.ts';
import { toE164, buildSmsBody, esc, buildSubject, buildEmailHtml, buildEmailText } from './notify.ts';

const ticket = (over: Partial<OrderTicket> = {}): OrderTicket => ({
  id: 'ticket-1',
  qr_code: 'abc-123',
  status: 'confirmed',
  scanned_at: null,
  total_price: 12.72,
  seat: null,
  tier_name: null,
  ...over,
});

// --- phone normalization ---------------------------------------------------
// Checkout collects phone numbers as typed. Twilio only accepts E.164, and a
// rejected send is invisible to the customer.

Deno.test('toE164 accepts the formats customers actually type', () => {
  assertEquals(toE164('(208) 892-9752'), '+12088929752');
  assertEquals(toE164('208-892-9752'), '+12088929752');
  assertEquals(toE164('208.892.9752'), '+12088929752');
  assertEquals(toE164('2088929752'), '+12088929752');
  assertEquals(toE164('1 208 892 9752'), '+12088929752');
  assertEquals(toE164('+1 (208) 892-9752'), '+12088929752');
  assertEquals(toE164('  208 892 9752  '), '+12088929752');
});

Deno.test('toE164 preserves explicitly international numbers', () => {
  assertEquals(toE164('+44 20 7946 0958'), '+442079460958');
});

Deno.test('toE164 rejects what cannot be dialled rather than guessing', () => {
  assertEquals(toE164(''), null);
  assertEquals(toE164('   '), null);
  assertEquals(toE164('not a phone'), null);
  assertEquals(toE164('12345'), null);
  // 11 digits that do not start with the country code are not a US number.
  assertEquals(toE164('92088929752'), null);
});

// --- showtime rendering ----------------------------------------------------

Deno.test('formatShowtime renders in the venue zone, not UTC', () => {
  // 2026-08-15T02:30:00Z is 7:30 PM on Aug 14 in Pacific time. A ticket that
  // says "Aug 15, 2:30 AM" sends the customer on the wrong night.
  const out = formatShowtime('2026-08-15T02:30:00Z', 'America/Los_Angeles');
  assertEquals(out, 'Fri, Aug 14, 2026 at 7:30 PM');
});

Deno.test('formatShowtime returns empty string for an unusable timestamp', () => {
  assertEquals(formatShowtime('not-a-date'), '');
  assertEquals(formatShowtime(''), '');
});

// --- ticket description ----------------------------------------------------

Deno.test('describeSeat covers assigned, GA, and tiered tickets', () => {
  assertEquals(describeSeat(ticket()), 'General Admission');
  assertEquals(describeSeat(ticket({ seat: { row: 'C', number: 12 } })), 'Row C, Seat 12');
  assertEquals(describeSeat(ticket({ tier_name: 'Student' })), 'General Admission · Student');
  assertEquals(
    describeSeat(ticket({ seat: { row: 'A', number: 3 }, tier_name: 'Balcony' })),
    'Row A, Seat 3 · Balcony',
  );
});

Deno.test('formatMoney always shows cents', () => {
  assertEquals(formatMoney(12.7), '$12.70');
  assertEquals(formatMoney(0), '$0.00');
  assertEquals(formatMoney(NaN), '$0.00');
});

// --- QR encoding -----------------------------------------------------------

Deno.test('renderQrPng emits a real PNG', async () => {
  const png = await renderQrPng('kw-ticket-abc-123');
  // PNG magic number.
  assertEquals(Array.from(png.slice(0, 4)), [0x89, 0x50, 0x4e, 0x47]);
  assertNotEquals(png.length, 0);
});

Deno.test('renderQrPng distinguishes different ticket codes', async () => {
  const a = await renderQrPng('ticket-a');
  const b = await renderQrPng('ticket-b');
  assertNotEquals(a.length + ':' + a[40], b.length + ':' + b[40]);
});

// The load-bearing assertion for this whole feature: decode the PNG we would
// actually email and confirm it yields the exact `qr_code` string that
// TicketScanner matches against. "It looks like a QR" is not the bar — the
// previous My Tickets view rendered a hash-derived grid that looked like one
// and could never be scanned.
Deno.test('the emailed QR decodes back to the door scanner value', async () => {
  const { PNG } = await import('npm:pngjs@7.0.0');
  // jsqr ships CJS; its types surface as a namespace under Deno's ESM interop.
  const jsqrModule: any = await import('npm:jsqr@1.4.0');
  const jsQR = jsqrModule.default ?? jsqrModule;

  const qrCode = 'a3f1c9e2-4b8d-4f7a-9c31-77ee1b0d5a62';
  const png = await renderQrPng(qrCode);

  const decodedImage = PNG.sync.read(Buffer.from(png));
  const result = jsQR(
    new Uint8ClampedArray(decodedImage.data),
    decodedImage.width,
    decodedImage.height,
  );

  assertNotEquals(result, null, 'QR image failed to decode at all');
  assertEquals(result!.data, qrCode);
});

// --- URLs ------------------------------------------------------------------

Deno.test('ticket URLs are built without double slashes and are encoded', () => {
  assertEquals(ticketPageUrl('https://example.com/', 'tok en'), 'https://example.com/t/tok%20en');
  assertEquals(
    ticketQrUrl('https://proj.supabase.co/', 'tok', 'tid'),
    'https://proj.supabase.co/functions/v1/ticket-access?token=tok&qr=tid',
  );
});

// --- SMS body --------------------------------------------------------------

Deno.test('buildSmsBody carries title, time and link', () => {
  const body = buildSmsBody(
    {
      order_token: 'tok',
      user_id: 'u',
      purchased_at: '',
      confirmation_sent_at: null,
      title: 'Casablanca',
      start_time: '',
      start_time_display: 'Fri, Aug 14, 2026 at 7:30 PM',
      venue: 'Main Theatre',
      tickets: [ticket(), ticket({ id: 'ticket-2' })],
      total: 25.44,
    },
    'https://example.com/t/tok',
  );
  assertEquals(body.includes('2 tickets for Casablanca'), true);
  assertEquals(body.includes('Fri, Aug 14, 2026 at 7:30 PM'), true);
  assertEquals(body.includes('https://example.com/t/tok'), true);
});

Deno.test('buildSmsBody lists seats when the order has them', () => {
  const body = buildSmsBody(
    {
      order_token: 'tok',
      user_id: 'u',
      purchased_at: '',
      confirmation_sent_at: null,
      title: 'Hamlet',
      start_time: '',
      start_time_display: 'Sat, Sep 5, 2026 at 8:00 PM',
      venue: null,
      tickets: [ticket({ seat: { row: 'B', number: 4 } })],
      total: 12.72,
    },
    'https://example.com/t/tok',
  );
  assertEquals(body.includes('B4'), true);
  assertEquals(body.includes('1 ticket for Hamlet'), true);
});

// --- email escaping --------------------------------------------------------

Deno.test('esc neutralizes HTML in customer-supplied and catalog values', () => {
  assertEquals(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assertEquals(esc(`Tom's "film" & co`), 'Tom&#39;s &quot;film&quot; &amp; co');
  assertEquals(esc(null), '');
});

// --- email body ------------------------------------------------------------

const order = (over: Partial<import('./tickets.ts').Order> = {}) => ({
  order_token: 'tok',
  user_id: 'u',
  purchased_at: '',
  confirmation_sent_at: null,
  title: 'Casablanca',
  start_time: '',
  start_time_display: 'Fri, Aug 14, 2026 at 7:30 PM',
  venue: 'Main Theatre',
  tickets: [ticket(), ticket({ id: 'ticket-2', qr_code: 'def-456' })],
  total: 25.44,
  ...over,
});

Deno.test('buildEmailHtml embeds one QR image per ticket, by absolute URL', () => {
  const html = buildEmailHtml(order(), {
    ticketUrl: 'https://example.com/t/tok',
    qrUrlFor: (id) => `https://cdn.example.com/qr/${id}.png`,
    passwordUrl: null,
    name: 'Tom Frank',
  });
  assertEquals(html.includes('src="https://cdn.example.com/qr/ticket-1.png"'), true);
  assertEquals(html.includes('src="https://cdn.example.com/qr/ticket-2.png"'), true);
  // data: URIs are stripped by Gmail and Outlook — the QR must be a real URL.
  assertEquals(html.includes('src="data:'), false);
  // The raw code is printed too, so the ticket survives images being blocked.
  assertEquals(html.includes('def-456'), true);
  assertEquals(html.includes('Hi Tom,'), true);
});

Deno.test('buildEmailHtml escapes a title containing markup', () => {
  const html = buildEmailHtml(order({ title: '<img src=x onerror=alert(1)>' }), {
    ticketUrl: 'https://example.com/t/tok',
    qrUrlFor: (id) => `https://cdn.example.com/qr/${id}.png`,
  });
  assertEquals(html.includes('onerror=alert(1)>'), false);
  assertEquals(html.includes('&lt;img src=x'), true);
});

Deno.test('buildEmailHtml includes the set-password block only when there is a link', () => {
  const withLink = buildEmailHtml(order(), {
    ticketUrl: 'https://example.com/t/tok',
    qrUrlFor: (id) => id,
    passwordUrl: 'https://auth.example.com/recover?token=xyz',
  });
  assertEquals(withLink.includes('Set your password'), true);
  assertEquals(withLink.includes('https://auth.example.com/recover?token=xyz'), true);

  const withoutLink = buildEmailHtml(order(), {
    ticketUrl: 'https://example.com/t/tok',
    qrUrlFor: (id) => id,
    passwordUrl: null,
  });
  assertEquals(withoutLink.includes('Set your password'), false);
});

Deno.test('buildEmailText stands alone without the HTML part', () => {
  const text = buildEmailText(order(), {
    ticketUrl: 'https://example.com/t/tok',
    passwordUrl: 'https://auth.example.com/recover',
    name: 'Tom Frank',
  });
  assertEquals(text.includes('Casablanca'), true);
  assertEquals(text.includes('Fri, Aug 14, 2026 at 7:30 PM'), true);
  assertEquals(text.includes('Main Theatre'), true);
  assertEquals(text.includes('abc-123'), true);
  assertEquals(text.includes('https://example.com/t/tok'), true);
  assertEquals(text.includes('https://auth.example.com/recover'), true);
  assertEquals(text.includes('Total paid: $25.44'), true);
  assertEquals(text.includes('<'), false);
});

Deno.test('buildSubject pluralizes on ticket count', () => {
  const base = {
    order_token: 'tok',
    user_id: 'u',
    purchased_at: '',
    confirmation_sent_at: null,
    title: 'Casablanca',
    start_time: '',
    start_time_display: '',
    venue: null,
    total: 0,
  };
  assertEquals(buildSubject({ ...base, tickets: [ticket()] }), 'Your 1 ticket for Casablanca');
  assertEquals(
    buildSubject({ ...base, tickets: [ticket(), ticket()] }),
    'Your 2 tickets for Casablanca',
  );
});
