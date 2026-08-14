// Cross-template branding guarantees.
//
// Run: deno test --no-check --allow-env supabase/functions/_shared/email_brand_test.ts
//
// The other email tests each check one template's copy. This one checks the
// things that are only true *across* templates, which is exactly what drifted
// before email-layout.ts existed: six hand-maintained copies of the same header
// and footer, gradually disagreeing about the theatre's name and colours.
//
// Two failures this guards:
//
//   1. "The Kenworthy". The theatre is the Kenworthy Performing Arts Centre —
//      no leading "The". It was wrong in every template, and a fix applied one
//      file at a time is a fix that comes back.
//   2. A template quietly going its own way on colour. Every message a patron
//      receives should be the same piece of stationery, so each one has to be
//      drawing from brand.ts rather than carrying its own hex.

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { brand, emailLockup, VENUE_NAME } from './brand.ts';
import { buildEmailHtml, buildEmailText, buildSmsBody, buildSubject } from './notify.ts';
import { buildAuthEmailHtml, buildAuthEmailText, AUTH_EMAIL_COPY } from './auth-email.ts';
import {
  buildReceiptHtml,
  buildReceiptText,
  buildReceiptSubject,
  buildTributeHtml,
  buildTributeText,
  buildTributeSubject,
  type DonationSummary,
} from './donations.ts';
import {
  buildPassOrderEmailHtml,
  buildPassOrderEmailText,
  buildPassPostedEmailHtml,
  buildPassPostedEmailText,
  type PassOrderSummary,
  type PassPostedSummary,
} from './pass_orders.ts';
import type { Order } from './tickets.ts';

// --- fixtures ---------------------------------------------------------------

const order: Order = {
  order_token: 'tok-1',
  user_id: 'user-1',
  title: 'The Third Man',
  start_time_display: 'Fri, Aug 14, 2026 at 7:30 PM',
  venue: null,
  total: 25.44,
  confirmation_sent_at: null,
  tickets: [
    {
      id: 'ticket-1',
      qr_code: 'abc-123',
      status: 'confirmed',
      scanned_at: null,
      total_price: 12.72,
      seat: null,
      tier_name: null,
    },
  ],
} as unknown as Order;

const gift: DonationSummary = {
  amountCents: 5000,
  donorName: 'Ada Lovelace',
  dedicationType: 'in_memory',
  dedicateTo: 'Alan Turing',
  notifyName: 'Grace Hopper',
  message: 'Thinking of you.',
  receiptUrl: 'https://squareup.com/receipt/preview/abc123',
  createdAt: '2026-08-13T19:30:00.000Z',
  bundled: false,
};

const passOrder: PassOrderSummary = {
  passTypeName: '$60 Film Pass',
  quantity: 1,
  amountPaid: 60,
  initialBalance: 60,
  redemptionPrice: 6,
  fulfillment: 'pickup',
  mailingAddress: null,
  buyerName: 'Ada Lovelace',
};

const passPosted: PassPostedSummary = {
  passTypeName: '$60 Film Pass',
  quantity: 1,
  mailingAddress: null,
  buyerName: 'Ada Lovelace',
  initialBalance: 60,
  redemptionPrice: 6,
};

const ticketOpts = {
  ticketUrl: 'https://kenworthy.test/t/tok-1',
  qrUrlFor: (id: string) => `https://kenworthy.test/qr/${id}`,
  calendarUrl: 'https://kenworthy.test/ics/tok-1',
  googleCalendarUrl: 'https://calendar.google.com/x',
  passwordUrl: 'https://kenworthy.test/reset',
  accountJustCreated: true,
  name: 'Ada Lovelace',
};

/** Every HTML email a patron can receive, by name. */
const HTML_EMAILS: Record<string, string> = {
  ticket: buildEmailHtml(order, ticketOpts),
  'auth: recovery': buildAuthEmailHtml({
    action: 'recovery',
    verifyUrl: 'https://kenworthy.test/verify?token=abc',
  }),
  'auth: invite': buildAuthEmailHtml({
    action: 'invite',
    verifyUrl: 'https://kenworthy.test/verify?token=abc',
  }),
  'auth: reauthentication': buildAuthEmailHtml({
    action: 'reauthentication',
    verifyUrl: 'https://kenworthy.test/verify',
    token: '123456',
  }),
  'donation receipt': buildReceiptHtml(gift),
  'donation tribute': buildTributeHtml(gift),
  'pass order': buildPassOrderEmailHtml(passOrder),
  'pass posted': buildPassPostedEmailHtml(passPosted),
};

/** Every plain-text alternative and the SMS, which has no HTML at all. */
const TEXT_MESSAGES: Record<string, string> = {
  ticket: buildEmailText(order, ticketOpts),
  'auth: recovery': buildAuthEmailText({
    action: 'recovery',
    verifyUrl: 'https://kenworthy.test/verify?token=abc',
  }),
  'auth: invite': buildAuthEmailText({
    action: 'invite',
    verifyUrl: 'https://kenworthy.test/verify?token=abc',
  }),
  'donation receipt': buildReceiptText(gift),
  'donation tribute': buildTributeText(gift),
  'pass order': buildPassOrderEmailText(passOrder),
  'pass posted': buildPassPostedEmailText(passPosted),
  sms: buildSmsBody(order, ticketOpts.ticketUrl, ticketOpts.calendarUrl),
};

/** Subject lines are the one part of a message everyone reads. */
const SUBJECTS: Record<string, string> = {
  ticket: buildSubject(order),
  'donation receipt': buildReceiptSubject(gift),
  'donation tribute': buildTributeSubject(gift),
  ...Object.fromEntries(
    Object.entries(AUTH_EMAIL_COPY).map(([action, copy]) => [`auth: ${action}`, copy.subject]),
  ),
};

// --- the name ---------------------------------------------------------------

Deno.test('no message calls the theatre "The Kenworthy"', () => {
  const offenders: string[] = [];
  for (const [name, body] of [
    ...Object.entries(HTML_EMAILS),
    ...Object.entries(TEXT_MESSAGES),
    ...Object.entries(SUBJECTS),
  ]) {
    // Case-sensitive on purpose: "a gift to the Kenworthy" mid-sentence is
    // correct English, "The Kenworthy" as a name is not.
    if (body.includes('The Kenworthy')) offenders.push(name);
  }
  assertEquals(offenders, [], `these still say "The Kenworthy": ${offenders.join(', ')}`);
});

Deno.test('every email signs off with the full venue name', () => {
  for (const [name, html] of Object.entries(HTML_EMAILS)) {
    assert(html.includes(VENUE_NAME), `${name} does not name the venue`);
  }
  for (const [name, text] of Object.entries(TEXT_MESSAGES)) {
    if (name === 'sms') continue; // 160 characters; the short form is the point.
    assert(text.includes(VENUE_NAME), `${name} text does not name the venue`);
  }
});

Deno.test('the SMS uses the short form, since every character is billed', () => {
  const sms = TEXT_MESSAGES.sms;
  assert(sms.startsWith('Kenworthy:'), `SMS opens with: ${sms.slice(0, 24)}`);
});

// --- the shared shell -------------------------------------------------------

Deno.test('every email carries the logo from a stable absolute URL', () => {
  for (const [name, html] of Object.entries(HTML_EMAILS)) {
    assert(html.includes(emailLockup().url), `${name} is missing the wordmark`);
    // Gmail drops SVG and strips data: URIs — both render as a broken image.
    assert(!html.includes('<img src="data:'), `${name} embeds a data: URI`);
    assert(!html.includes('.svg"'), `${name} references an SVG`);
  }
});

// --- the centenary lockup ---------------------------------------------------

Deno.test('the centenary lockup runs through the end of 2026, then retires itself', () => {
  const at = (iso: string) => emailLockup('https://x.test', new Date(iso));

  // Mid-centenary.
  assertEquals(at('2026-08-14T12:00:00Z').url, 'https://x.test/email-logo-centenary.png');
  // 11:59pm on New Year's Eve, Pacific — still the hundredth year.
  assertEquals(at('2027-01-01T07:59:00Z').url, 'https://x.test/email-logo-centenary.png');
  // Midnight, Pacific. Over.
  assertEquals(at('2027-01-01T08:00:00Z').url, 'https://x.test/email-logo.png');
  assertEquals(at('2027-06-01T12:00:00Z').url, 'https://x.test/email-logo.png');
});

Deno.test('the two lockups live at separate URLs, so a sent email never changes', () => {
  // An email sent during the centenary must keep rendering the centenary
  // artwork forever. That only holds if the switchover changes the URL rather
  // than the bytes behind one URL.
  const during = emailLockup('https://x.test', new Date('2026-08-14T12:00:00Z'));
  const after = emailLockup('https://x.test', new Date('2027-02-01T12:00:00Z'));
  assert(during.url !== after.url, 'both lockups resolve to the same URL');
  // The centenary lockup carries a third line and is shown larger.
  assert(during.width > after.width, 'centenary lockup is not given more room');
});

Deno.test('every email draws its colours from brand.ts', () => {
  for (const [name, html] of Object.entries(HTML_EMAILS)) {
    assert(html.includes(brand.bg), `${name} does not use the brand background`);
    assert(html.includes(brand.paper), `${name} does not use the paper surface`);
  }
});

Deno.test('no email carries a colour from the retired palette', () => {
  // The warm brown header and magenta button predate the current tokens. If one
  // reappears, a template has stopped going through brand.ts.
  const retired = ['#26211d', '#b82a6b', '#f0ece7', '#55504b', '#8b847d', '#6b6560'];
  for (const [name, html] of Object.entries(HTML_EMAILS)) {
    for (const hex of retired) {
      assert(!html.toLowerCase().includes(hex), `${name} still uses the retired ${hex}`);
    }
  }
});

Deno.test('editing brand.ts moves every email together', () => {
  // The acceptance criterion from the brief, stated as a test: the palette is
  // reachable from one module, so nothing can be branded in isolation. If a
  // template inlined its own hex, its HTML would not contain these.
  for (const [name, html] of Object.entries(HTML_EMAILS)) {
    const usesSharedPalette =
      html.includes(brand.bg) && html.includes(brand.cream) && html.includes(brand.primary);
    assert(usesSharedPalette, `${name} is not fully driven by brand.ts`);
  }
});
