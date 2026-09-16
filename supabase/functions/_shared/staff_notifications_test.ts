// Staff notifications: who gets mailed, and that the form can never decide.
//
// The property worth a test here is negative: a rental submission must not be
// able to choose a recipient. `notifyStaff` has no address parameter, but a
// test pins that the submitter's address shows up only as Reply-To and that
// the To list is exactly what app_config says (or the default when it says
// nothing usable). The rest covers the fallbacks — a malformed entry must
// degrade to "email events@", never to silence — and that a failed send is
// reported rather than thrown, because the caller has already answered the
// patron by the time this runs.

import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';

// deliver.ts reads its providers from the environment at module load.
Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');
Deno.env.set('SITE_URL', 'https://stub.kenworthy.org');
Deno.env.set('RESEND_API_KEY', 'stub-resend-key');

const {
  buildRentalRequestNotification,
  describeDateRange,
  notifyStaff,
  notifyStaffOfRentalRequest,
  resolveStaffNotificationSetting,
  rentalQueueUrl,
} = await import('./staff_notifications.ts');

// ---------------------------------------------------------------------------
// Resolving a setting
// ---------------------------------------------------------------------------

Deno.test('no config at all means enabled, to the default address', () => {
  assertEquals(resolveStaffNotificationSetting(null, 'rental_request'), {
    enabled: true,
    recipients: ['events@kenworthy.org'],
  });
  assertEquals(resolveStaffNotificationSetting({}, 'rental_request').recipients, ['events@kenworthy.org']);
  assertEquals(resolveStaffNotificationSetting('garbage', 'rental_request').recipients, ['events@kenworthy.org']);
});

Deno.test('configured recipients replace the default, deduplicated, junk dropped', () => {
  const setting = resolveStaffNotificationSetting(
    {
      rental_request: {
        enabled: true,
        recipients: ['  boxoffice@kenworthy.org ', 'not an address', 42, 'BoxOffice@kenworthy.org', 'gm@kenworthy.org'],
      },
    },
    'rental_request',
  );
  assertEquals(setting.recipients, ['boxoffice@kenworthy.org', 'gm@kenworthy.org']);
});

Deno.test('an empty or all-invalid list falls back to the default rather than to nobody', () => {
  assertEquals(
    resolveStaffNotificationSetting({ rental_request: { recipients: [] } }, 'rental_request').recipients,
    ['events@kenworthy.org'],
  );
  assertEquals(
    resolveStaffNotificationSetting({ rental_request: { recipients: ['nope'] } }, 'rental_request').recipients,
    ['events@kenworthy.org'],
  );
});

Deno.test('only a literal enabled:false switches it off', () => {
  assertEquals(resolveStaffNotificationSetting({ rental_request: { enabled: false } }, 'rental_request').enabled, false);
  assertEquals(resolveStaffNotificationSetting({ rental_request: { enabled: 'no' } }, 'rental_request').enabled, true);
  assertEquals(resolveStaffNotificationSetting({ rental_request: {} }, 'rental_request').enabled, true);
});

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------

const marquee = {
  id: 'req-1',
  applicant_name: 'Pat Example',
  email: 'pat@example.com',
  phone: '(208) 555-0100',
  event_title: 'Marquee: Happy Birthday Sam',
  venue_area: 'marquee',
  marquee_text: 'HAPPY 40TH SAM <3',
  proposed_date: '2026-10-03',
  end_date: '2026-10-03',
};

const theatre = {
  id: 'req-2',
  applicant_name: 'Chris Renter',
  email: 'chris@example.org',
  organization_name: 'Palouse Choral',
  event_title: 'Spring Concert',
  venue_area: 'main_stage',
  proposed_date: '2026-11-14',
  end_date: '2026-11-15',
  expected_guests: 250,
  event_description: 'Two nights, <b>no</b> projection needed.',
};

Deno.test('a marquee request says so in the subject and leads with the marquee text', () => {
  const m = buildRentalRequestNotification(marquee, { queueUrl: 'https://x.test/admin?section=rentals' });
  assertEquals(m.isMarquee, true);
  assertEquals(m.subject, 'New marquee request — Pat Example');
  assertStringIncludes(m.text, 'Marquee text: HAPPY 40TH SAM <3');
  assertStringIncludes(m.html, 'HAPPY 40TH SAM &lt;3');
  assertStringIncludes(m.text, 'Email: pat@example.com');
  assertStringIncludes(m.text, 'Phone: (208) 555-0100');
  assertStringIncludes(m.text, 'Dates: Sat, October 3, 2026');
  assertStringIncludes(m.text, 'https://x.test/admin?section=rentals');
  assertStringIncludes(m.html, 'href="https://x.test/admin?section=rentals"');
});

Deno.test('a theatre request names the venue area, the range and the organisation, escaped', () => {
  const m = buildRentalRequestNotification(theatre, { queueUrl: 'https://x.test/admin?section=rentals' });
  assertEquals(m.isMarquee, false);
  assertEquals(m.subject, 'New rental request — Chris Renter');
  assertStringIncludes(m.text, 'Who: Chris Renter (Palouse Choral)');
  assertStringIncludes(m.text, 'Venue area: Main Stage');
  assertStringIncludes(m.text, 'Dates: Sat, November 14, 2026 to Sun, November 15, 2026');
  assertStringIncludes(m.text, 'Expected guests: 250');
  assertStringIncludes(m.text, 'Two nights, <b>no</b> projection needed.');
  assertStringIncludes(m.html, 'Two nights, &lt;b&gt;no&lt;/b&gt; projection needed.');
  assert(!m.html.includes('<b>no</b>'), 'description must be escaped in HTML');
});

Deno.test('date helpers do not shift the calendar day', () => {
  assertEquals(describeDateRange('2026-01-01', null), 'Thu, January 1, 2026');
  assertEquals(describeDateRange('2026-01-01', '2026-01-01'), 'Thu, January 1, 2026');
  assertEquals(describeDateRange(null, null), 'No date given');
});

Deno.test('the queue link points at the admin Rentals section on the site origin', () => {
  assertEquals(rentalQueueUrl('https://stub.kenworthy.org/'), 'https://stub.kenworthy.org/admin?section=rentals');
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** An admin client whose only job is to answer the one app_config read. */
function stubAdmin(value: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) chain[m] = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: value === undefined ? null : { value }, error });
  return { from: () => chain };
}

type ResendCall = { to: string[]; reply_to?: string; subject: string; from: string };

/** Capture every Resend request; audit-log posts to the stub host are ignored. */
function withStubResend(
  status: (call: ResendCall) => number,
  run: (calls: ResendCall[]) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  const calls: ResendCall[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://api.resend.com')) {
      const call = JSON.parse(String(init?.body)) as ResendCall;
      calls.push(call);
      return Promise.resolve(new Response('{}', { status: status(call) }));
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof fetch;
  return run(calls).finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test('recipients come from config; the submitter is Reply-To and never To', async () => {
  const admin = stubAdmin({
    rental_request: { enabled: true, recipients: ['events@kenworthy.org', 'gm@kenworthy.org'] },
  });
  await withStubResend(() => 200, async (calls) => {
    const outcome = await notifyStaffOfRentalRequest(admin, marquee);
    assertEquals(outcome.enabled, true);
    assertEquals(outcome.sent, ['events@kenworthy.org', 'gm@kenworthy.org']);
    assertEquals(outcome.failed, []);
    assertEquals(calls.length, 2);
    for (const c of calls) {
      assertEquals(c.reply_to, 'pat@example.com');
      assert(!c.to.includes('pat@example.com'), 'submitter must not be a recipient');
      assertStringIncludes(c.from, '@kenworthy.org');
    }
    assertEquals(calls.map((c) => c.to).flat(), ['events@kenworthy.org', 'gm@kenworthy.org']);
  });
});

Deno.test('with no config row it still emails events@', async () => {
  await withStubResend(() => 200, async (calls) => {
    const outcome = await notifyStaffOfRentalRequest(stubAdmin(undefined), theatre);
    assertEquals(outcome.sent, ['events@kenworthy.org']);
    assertEquals(calls[0].to, ['events@kenworthy.org']);
    assertEquals(calls[0].subject, 'New rental request — Chris Renter');
  });
});

Deno.test('a config read error degrades to the default, not to silence', async () => {
  await withStubResend(() => 200, async (calls) => {
    const outcome = await notifyStaffOfRentalRequest(stubAdmin(undefined, { message: 'boom' }), theatre);
    assertEquals(outcome.sent, ['events@kenworthy.org']);
    assertEquals(calls.length, 1);
  });
});

Deno.test('switched off means nothing is sent', async () => {
  const admin = stubAdmin({ rental_request: { enabled: false, recipients: ['events@kenworthy.org'] } });
  await withStubResend(() => 200, async (calls) => {
    const outcome = await notifyStaffOfRentalRequest(admin, marquee);
    assertEquals(outcome.enabled, false);
    assertEquals(outcome.sent, []);
    assertEquals(calls.length, 0);
  });
});

Deno.test('one bounce is reported, does not throw, and does not stop the others', async () => {
  const admin = stubAdmin({
    rental_request: { enabled: true, recipients: ['bad@kenworthy.org', 'good@kenworthy.org'] },
  });
  await withStubResend((c) => (c.to[0] === 'bad@kenworthy.org' ? 422 : 200), async (calls) => {
    const outcome = await notifyStaff(admin, 'rental_request', { subject: 's', html: '<p>h</p>', text: 't' });
    assertEquals(calls.length, 2);
    assertEquals(outcome.sent, ['good@kenworthy.org']);
    assertEquals(outcome.failed.length, 1);
    assertEquals(outcome.failed[0].to, 'bad@kenworthy.org');
    assertStringIncludes(outcome.failed[0].error, 'Resend 422');
  });
});

Deno.test('a reply-to that is not an address is dropped rather than sent', async () => {
  await withStubResend(() => 200, async (calls) => {
    await notifyStaff(stubAdmin(undefined), 'rental_request', { subject: 's', html: 'h', text: 't' }, {
      replyTo: 'not an email',
    });
    // deliver.ts substitutes its own default reply-to when none is given.
    assertEquals(calls[0].reply_to, 'events@kenworthy.org');
  });
});
