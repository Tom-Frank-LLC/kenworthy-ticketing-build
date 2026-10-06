// The preheader is escaped once, in the shell, and nowhere else.
//
// It used to be the caller's job. Every template remembered except the staff
// rental notification, which put the public form's name field into the
// preheader raw: a rental request named
// `Eve</div><a href="https://evil.example/login">…` arrived in staff inboxes,
// from our own DKIM-signed domain, with the attacker's link at the top
// (audit 2026-10-06, M8). The shell escapes it now, so the callers must pass
// plain text — escaping there as well would show `&amp;` in the inbox list.
//
// So two properties, pinned for every template that sets a preheader: markup
// in a value comes out inert, and an ordinary `&` or `'` comes out escaped
// exactly once.

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// deliver.ts (behind staff_notifications.ts) reads its providers at module load.
Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');
Deno.env.set('SITE_URL', 'https://stub.kenworthy.org');
Deno.env.set('RESEND_API_KEY', 'stub-resend-key');

const { emailLayout } = await import('./email-layout.ts');
const { buildRentalRequestNotification } = await import('./staff_notifications.ts');
const { buildEmailHtml } = await import('./notify.ts');
const { buildAuthEmailHtml, AUTH_EMAIL_COPY } = await import('./auth-email.ts');
const { buildReceiptHtml, buildTributeHtml } = await import('./donations.ts');
const { buildPassOrderEmailHtml, buildPassPostedEmailHtml } = await import('./pass_orders.ts');

/** The hidden preview div's contents, as the HTML source carries them. */
function preheaderOf(html: string): string {
  const m = html.match(/<div style="display:none;max-height:0;overflow:hidden;opacity:0;">([\s\S]*?)<\/div>/);
  assert(m, 'no preheader div in this email');
  return m[1];
}

const DOUBLE_ESCAPED = /&amp;(?:amp|lt|gt|quot|#39);/;

Deno.test('emailLayout escapes the preheader itself', () => {
  const html = emailLayout({ title: 't', preheader: 'Eve</div><a href="https://evil.example">x</a>', contentHtml: '' });
  assertEquals(
    preheaderOf(html),
    'Eve&lt;/div&gt;&lt;a href=&quot;https://evil.example&quot;&gt;x&lt;/a&gt;',
  );
  assert(!html.includes('<a href="https://evil.example"'), 'the link must not survive as markup');
});

Deno.test('the rental notification: a hostile name and organisation are inert in the preheader', () => {
  const m = buildRentalRequestNotification({
    id: 'req-x',
    applicant_name: 'Eve</div><a href="https://evil.example/login">Square session expired — sign in</a><div style="display:none">',
    organization_name: 'Ada & Co',
    email: 'eve@example.com',
    event_title: 'x',
    venue_area: 'main_stage',
    proposed_date: '2026-11-14',
    end_date: '2026-11-14',
  }, { queueUrl: 'https://x.test/admin?section=rentals' });

  assert(!m.html.includes('href="https://evil.example/login"'), 'the planted link must not be live anywhere in the email');
  const pre = preheaderOf(m.html);
  assert(!pre.includes('<'), `preheader carries raw markup: ${pre}`);
  assert(pre.includes('Ada &amp; Co'), `organisation not escaped once: ${pre}`);
  assert(!DOUBLE_ESCAPED.test(pre), `preheader double-escaped: ${pre}`);
});

// Every other template that sets a preheader, fed values with an ampersand, an
// apostrophe and an angle bracket. Before the move each of these escaped at the
// call site; a leftover esc() there would now show up as `&amp;amp;`.
const tricky = `O'Brien & <Sons>`;
const once = 'O&#39;Brien &amp; &lt;Sons&gt;';

const order = {
  order_token: 'tok-1',
  user_id: 'user-1',
  title: tricky,
  start_time_display: 'Fri, Aug 14, 2026 at 7:30 PM',
  venue: null,
  total: 12.72,
  confirmation_sent_at: null,
  tickets: [{ id: 't1', qr_code: 'q', status: 'confirmed', scanned_at: null, total_price: 12.72, seat: null, tier_name: null }],
  // deno-lint-ignore no-explicit-any
} as any;

const gift = {
  amountCents: 5000,
  donorName: tricky,
  dedicationType: 'in_memory' as const,
  dedicateTo: tricky,
  notifyName: 'Grace',
  message: null,
  receiptUrl: null,
  createdAt: '2026-08-13T19:30:00.000Z',
  bundled: false,
};

const cases: Record<string, string> = {
  ticket: buildEmailHtml(order, {
    ticketUrl: 'https://kenworthy.test/t/tok-1',
    qrUrlFor: (id: string) => `https://kenworthy.test/qr/${id}`,
    calendarUrl: 'https://kenworthy.test/ics/tok-1',
    googleCalendarUrl: 'https://calendar.google.com/x',
    name: 'Ada',
  }),
  'donation tribute': buildTributeHtml(gift),
  'pass order': buildPassOrderEmailHtml({
    passTypeName: tricky, quantity: 1, amountPaid: 60, initialBalance: 60, redemptionPrice: 6,
    fulfillment: 'pickup', mailingAddress: null, buyerName: 'Ada',
  }),
  'pass posted': buildPassPostedEmailHtml({ passTypeName: tricky, quantity: 1, mailingAddress: null, buyerName: 'Ada' }),
};

for (const [name, html] of Object.entries(cases)) {
  Deno.test(`${name}: the preheader value is escaped exactly once`, () => {
    const pre = preheaderOf(html);
    assert(pre.includes(once), `${name} preheader lost or mangled the value: ${pre}`);
    assert(!DOUBLE_ESCAPED.test(pre), `${name} preheader double-escaped: ${pre}`);
  });
}

Deno.test('donation receipt and auth emails: preheaders are escaped once', () => {
  const receipt = preheaderOf(buildReceiptHtml(gift));
  assert(receipt.includes('$50'), receipt);
  assert(!DOUBLE_ESCAPED.test(receipt), receipt);

  for (const action of Object.keys(AUTH_EMAIL_COPY) as Array<keyof typeof AUTH_EMAIL_COPY>) {
    const html = buildAuthEmailHtml({ action, verifyUrl: 'https://kenworthy.test/verify', token: '123456' });
    const pre = preheaderOf(html);
    assert(!DOUBLE_ESCAPED.test(pre), `auth ${action} preheader double-escaped: ${pre}`);
    assert(!pre.includes('<'), `auth ${action} preheader carries markup: ${pre}`);
  }
});
