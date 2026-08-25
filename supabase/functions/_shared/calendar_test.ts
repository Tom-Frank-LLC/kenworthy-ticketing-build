// Tests for the "add to calendar" builders.
//
// Run: deno test --node-modules-dir=none --allow-env supabase/functions/_shared/calendar_test.ts
//
// A calendar event is written once and then lives in the customer's phone,
// unreachable. If DTSTART is wrong they arrive an hour late; if the file is
// malformed the import silently does nothing and they never notice there is no
// reminder. Neither failure produces an error anyone on our side can see, so
// the guarantees have to be checked here.

import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildIcs, googleCalendarUrl, ticketCalendarUrl } from './calendar.ts';
import { type Order, type OrderTicket } from './tickets.ts';

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

// 2026-09-04T02:30:00Z is 7:30 PM on Sep 3 in Moscow, Idaho — the same style of
// fixture instant tickets_test.ts uses, for the same reason.
const order = (over: Partial<Order> = {}): Order => ({
  order_token: '11111111-2222-3333-4444-555555555555',
  user_id: 'u',
  purchased_at: '',
  confirmation_sent_at: null,
  sms_consent: null,
  title: 'Casablanca',
  start_time: '2026-09-04T02:30:00.000Z',
  start_time_display: 'Thu, Sep 3, 2026 at 7:30 PM',
  venue: 'Main Theatre',
  duration_minutes: 102,
  tickets: [ticket(), ticket({ id: 'ticket-2', qr_code: 'def-456' })],
  total: 25.44,
  ...over,
});

const URL_ = 'https://kenworthy.org/t/11111111-2222-3333-4444-555555555555';
const STAMP = '2026-08-13T00:00:00.000Z';

/** Undo RFC 5545 folding, the way any calendar client does before parsing. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '');
const prop = (ics: string, key: string) =>
  unfold(ics).split('\r\n').find((l) => l.startsWith(key + ':'))?.slice(key.length + 1) ?? null;
const asMs = (s: string) =>
  Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
           +s.slice(9, 11), +s.slice(11, 13), +s.slice(13, 15));

// --- times -----------------------------------------------------------------
// The event carries the UTC instant, never a venue-local wall time. A calendar
// client renders that instant in whatever zone the viewer is in, which is what
// makes the entry correct for someone travelling — and independent of how the
// showtime happens to be *displayed* elsewhere in the app.

Deno.test('DTSTART is the stored instant, in UTC', () => {
  assertEquals(prop(buildIcs(order(), URL_, STAMP), 'DTSTART'), '20260904T023000Z');
});

Deno.test('DTSTART/DTEND/DTSTAMP use the compact UTC form', () => {
  const ics = buildIcs(order(), URL_, STAMP);
  for (const key of ['DTSTART', 'DTEND', 'DTSTAMP']) {
    assertMatch(prop(ics, key)!, /^\d{8}T\d{6}Z$/);
  }
});

Deno.test('the event runs for the movie runtime', () => {
  const ics = buildIcs(order({ duration_minutes: 102 }), URL_, STAMP);
  const mins = (asMs(prop(ics, 'DTEND')!) - asMs(prop(ics, 'DTSTART')!)) / 60000;
  assertEquals(mins, 102);
});

Deno.test('a production with no runtime gets a 2 hour block, not a zero-length event', () => {
  // Events and live performances carry no duration_minutes. A zero-length event
  // renders as a bare timestamp in most clients rather than a booked block.
  for (const d of [null, 0]) {
    const ics = buildIcs(order({ duration_minutes: d }), URL_, STAMP);
    const mins = (asMs(prop(ics, 'DTEND')!) - asMs(prop(ics, 'DTSTART')!)) / 60000;
    assertEquals(mins, 120);
  }
});

// --- RFC 5545 shape --------------------------------------------------------

Deno.test('every line ends CRLF — a bare LF makes strict parsers reject the file', () => {
  const ics = buildIcs(order(), URL_, STAMP);
  assertEquals(/[^\r]\n/.test(ics), false);
  assertEquals(ics.endsWith('\r\n'), true);
});

Deno.test('the VCALENDAR wrapper is complete', () => {
  const ics = buildIcs(order(), URL_, STAMP);
  assertEquals(ics.startsWith('BEGIN:VCALENDAR\r\n'), true);
  assertEquals(ics.includes('BEGIN:VEVENT\r\n'), true);
  assertEquals(ics.trimEnd().endsWith('END:VCALENDAR'), true);
});

Deno.test('UID is stable per order, so a re-import updates rather than duplicates', () => {
  assertEquals(prop(buildIcs(order(), URL_, STAMP), 'UID'),
    '11111111-2222-3333-4444-555555555555@kenworthy.org');
});

Deno.test('TEXT fields escape the characters that would otherwise end the property', () => {
  const ics = buildIcs(order({ title: 'Everything, Everywhere; All at Once' }), URL_, STAMP);
  assertEquals(prop(ics, 'SUMMARY'), 'Everything\\, Everywhere\\; All at Once');
});

// --- line folding ----------------------------------------------------------
// §3.1 caps a content line at 75 OCTETS. Counting characters instead passes
// every ASCII test and then emits an over-long line the first time a title has
// an accent or an em dash in it.

const tooLong = (ics: string) =>
  ics.split('\r\n').filter((l) => new TextEncoder().encode(l).length > 75);

Deno.test('no line exceeds 75 octets, ASCII title', () => {
  assertEquals(tooLong(buildIcs(order(), URL_, STAMP)), []);
});

Deno.test('no line exceeds 75 octets when the title is not ASCII', () => {
  const title = 'Amélie — Les Misérables — Café Society — Übermensch Doppelgänger';
  assertEquals(tooLong(buildIcs(order({ title }), URL_, STAMP)), []);
});

Deno.test('folding never splits a surrogate pair into invalid UTF-8', () => {
  // Walk an emoji across every byte offset a fold boundary can land on.
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  for (let pad = 55; pad <= 95; pad++) {
    const ics = buildIcs(order({ title: 'A'.repeat(pad) + '🎬 Festival Night' }), URL_, STAMP);
    assertEquals(lone.test(ics), false, `lone surrogate at pad=${pad}`);
    assertEquals(tooLong(ics), [], `over-long line at pad=${pad}`);
  }
});

Deno.test('a folded line unfolds back to the original value', () => {
  const title = ('A ' + 'very long title '.repeat(8)).trim();
  assertEquals(prop(buildIcs(order({ title }), URL_, STAMP), 'SUMMARY'), title);
});

// --- link builders ---------------------------------------------------------

Deno.test('the Google link carries the same window as the ICS', () => {
  const params = new URL(googleCalendarUrl(order(), URL_)).searchParams;
  assertEquals(params.get('dates'), '20260904T023000Z/20260904T041200Z');
  // Google takes the raw value; ICS escaping here would show up as literal
  // backslashes in the event title.
  assertEquals(params.get('text'), 'Casablanca');
});

Deno.test('ticketCalendarUrl points at ticket-access with the token encoded', () => {
  assertEquals(
    ticketCalendarUrl('https://abc.supabase.co/', 'tok en'),
    'https://abc.supabase.co/functions/v1/ticket-access?token=tok%20en&ics=1',
  );
});
