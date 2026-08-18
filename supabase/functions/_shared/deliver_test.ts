// Delivery routing: which channels fire, and what gets written back.
//
// `deliverConfirmation` had no test at all, which was survivable while it was
// a two-branch if/else — email won, SMS was the fallback, and each branch
// returned before the other could run. Sending on both channels turns that
// into four outcomes (both sent, one sent, neither sent, already sent) and the
// interesting ones are the mixed cases, because they are where a bug is
// silent: delivery is fire-and-forget, so nothing here can fail a purchase and
// nothing here surfaces to the buyer. The only evidence is what lands in
// `confirmation_sent_at` / `confirmation_channel` / `confirmation_error`, so
// that is what these assert.
//
// The one that matters most is the retry guard. `confirmation_sent_at` is what
// stops a re-invoke from texting someone a second time, and a partial delivery
// still has to stamp it — an emailed ticket plus a bounced text is delivered,
// not pending.

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';

// deliver.ts reads its providers from the environment at module load, so these
// have to be set before the import below, not inside a test body.
Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');
Deno.env.set('SITE_URL', 'https://stub.kenworthy.org');
Deno.env.set('RESEND_API_KEY', 'stub-resend-key');
Deno.env.set('TWILIO_ACCOUNT_SID', 'ACstub');
Deno.env.set('TWILIO_API_KEY_SID', 'SKstub');
Deno.env.set('TWILIO_API_KEY_SECRET', 'stub-secret');
Deno.env.set('TWILIO_MESSAGING_SERVICE_SID', 'MGstub');

const { deliverConfirmation } = await import('./deliver.ts');

const ORDER_TOKEN = 'order-token-under-test';

/** One paid ticket, in the shape `loadOrder` selects it. */
function ticketRows(overrides: Record<string, unknown> = {}) {
  return [
    {
      id: 'ticket-1',
      qr_code: 'KW-TICKET-1',
      status: 'confirmed',
      scanned_at: null,
      total_price: 8.48,
      purchased_at: '2026-08-18T02:00:00.000Z',
      order_token: ORDER_TOKEN,
      user_id: 'user-1',
      confirmation_sent_at: null,
      seats: null,
      showing_price_tiers: null,
      showings: {
        start_time: '2026-08-20T02:00:00.000Z',
        venues: { name: 'The Kenworthy' },
        movies: { title: 'A Test Picture', duration_minutes: 96 },
        events: null,
        live_performances: null,
      },
      ...overrides,
    },
  ];
}

/**
 * The narrowest service-role client that gets `deliverConfirmation` through:
 * a ticket select, a ticket update, and an auth lookup that finds nobody, so
 * contact details come from the caller's options and no recovery link is
 * minted.
 */
function stubAdmin(rows: unknown[]) {
  const updates: Record<string, unknown>[] = [];

  const resolving = (value: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'not', 'order', 'limit', 'maybeSingle']) {
      chain[method] = () => chain;
    }
    chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(value).then(onFulfilled, onRejected);
    return chain;
  };

  return {
    updates,
    from(table: string) {
      return {
        select: () => resolving({ data: table === 'tickets' ? rows : null, error: null }),
        update: (fields: Record<string, unknown>) => {
          updates.push(fields);
          return resolving({ error: null });
        },
      };
    },
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: null } }) } },
  };
}

type Outbound = { resend: number; twilio: number };

/**
 * Swap in a fetch that answers Resend and Twilio however the test wants, and
 * count what was actually attempted. Audit-log writes go to the stub Supabase
 * host and are ignored — `logAudit` swallows its own failures by design.
 */
function withStubFetch(
  respond: (host: 'resend' | 'twilio' | 'other') => Response,
  run: (sent: Outbound) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  const sent: Outbound = { resend: 0, twilio: 0 };
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://api.resend.com')) {
      sent.resend++;
      return Promise.resolve(respond('resend'));
    }
    if (url.startsWith('https://api.twilio.com')) {
      sent.twilio++;
      return Promise.resolve(respond('twilio'));
    }
    return Promise.resolve(respond('other'));
  }) as typeof fetch;

  return run(sent).finally(() => {
    globalThis.fetch = original;
  });
}

const ok = () => new Response('{}', { status: 200 });
const contact = { email: 'buyer@example.com', phone: '(208) 892-9752', name: 'Test Buyer' };

Deno.test('a buyer who gives both gets both, not whichever matched first', async () => {
  const admin = stubAdmin(ticketRows());
  await withStubFetch(() => ok(), async (sent) => {
    const result = await deliverConfirmation(admin, ORDER_TOKEN, contact);

    assertEquals(result.status, 'delivered');
    assertEquals((result as { channel: string }).channel, 'email+sms');
    assertEquals(sent.resend, 1);
    assertEquals(sent.twilio, 1);

    const recorded = admin.updates.at(-1)!;
    assertEquals(recorded.confirmation_channel, 'email+sms');
    assertEquals(recorded.confirmation_error, null);
    assert(recorded.confirmation_sent_at, 'a delivery must stamp confirmation_sent_at');
  });
});

Deno.test('a text that fails does not undo the emailed ticket', async () => {
  const admin = stubAdmin(ticketRows());
  await withStubFetch(
    (host) => (host === 'twilio' ? new Response('unreachable carrier', { status: 400 }) : ok()),
    async (sent) => {
      const result = await deliverConfirmation(admin, ORDER_TOKEN, contact);

      assertEquals(result.status, 'delivered');
      assertEquals((result as { channel: string }).channel, 'email');
      assert((result as { partialError?: string }).partialError?.includes('Twilio 400'));
      assertEquals(sent.resend, 1);

      // Both columns set at once: the customer has their tickets, and someone
      // should still look at why the text did not go.
      const recorded = admin.updates.at(-1)!;
      assert(recorded.confirmation_sent_at, 'a partial delivery is still a delivery');
      assert(String(recorded.confirmation_error).includes('Twilio 400'));
    },
  );
});

Deno.test('an email that fails still lets the text through', async () => {
  const admin = stubAdmin(ticketRows());
  await withStubFetch(
    (host) => (host === 'resend' ? new Response('rejected', { status: 422 }) : ok()),
    async (sent) => {
      const result = await deliverConfirmation(admin, ORDER_TOKEN, contact);

      assertEquals(result.status, 'delivered');
      assertEquals((result as { channel: string }).channel, 'sms');
      assertEquals(sent.twilio, 1);
      assert(String(admin.updates.at(-1)!.confirmation_error).includes('Resend 422'));
    },
  );
});

Deno.test('nothing is marked sent when every channel fails', async () => {
  const admin = stubAdmin(ticketRows());
  await withStubFetch(
    (host) => (host === 'other' ? ok() : new Response('down', { status: 500 })),
    async () => {
      const result = await deliverConfirmation(admin, ORDER_TOKEN, contact);

      assertEquals(result.status, 'failed');
      const failed = result as { channel: string; error: string; httpStatus: number };
      assertEquals(failed.channel, 'email+sms');
      assertEquals(failed.httpStatus, 502);
      assert(failed.error.includes('Resend 500'));
      assert(failed.error.includes('Twilio 500'));

      const recorded = admin.updates.at(-1)!;
      assertEquals(recorded.confirmation_sent_at, undefined);
    },
  );
});

Deno.test('a phone-only buyer is still delivered to by SMS alone', async () => {
  const admin = stubAdmin(ticketRows());
  await withStubFetch(() => ok(), async (sent) => {
    const result = await deliverConfirmation(admin, ORDER_TOKEN, {
      phone: contact.phone,
      name: contact.name,
    });

    assertEquals(result.status, 'delivered');
    assertEquals((result as { channel: string }).channel, 'sms');
    assertEquals(sent.resend, 0);
    assertEquals(sent.twilio, 1);
  });
});

Deno.test('an unsendable number is the customer typo it is, not a 502', async () => {
  const admin = stubAdmin(ticketRows());
  await withStubFetch(() => ok(), async (sent) => {
    const result = await deliverConfirmation(admin, ORDER_TOKEN, {
      phone: '555-CALL-NOW',
      name: contact.name,
    });

    assertEquals(result.status, 'failed');
    assertEquals((result as { httpStatus: number }).httpStatus, 400);
    assertEquals(sent.twilio, 0, 'a number toE164 rejects is never handed to Twilio');
  });
});

Deno.test('an already-confirmed order is not texted a second time', async () => {
  const admin = stubAdmin(ticketRows({ confirmation_sent_at: '2026-08-18T02:05:00.000Z' }));
  await withStubFetch(() => ok(), async (sent) => {
    const result = await deliverConfirmation(admin, ORDER_TOKEN, contact);

    assertEquals(result.status, 'skipped');
    assertEquals(sent.resend, 0);
    assertEquals(sent.twilio, 0);
    assertEquals(admin.updates.length, 0);
  });
});

Deno.test('force resends a confirmed order on every channel', async () => {
  const admin = stubAdmin(ticketRows({ confirmation_sent_at: '2026-08-18T02:05:00.000Z' }));
  await withStubFetch(() => ok(), async (sent) => {
    const result = await deliverConfirmation(admin, ORDER_TOKEN, { ...contact, force: true });

    assertEquals(result.status, 'delivered');
    assertEquals((result as { channel: string }).channel, 'email+sms');
    assertEquals(sent.resend, 1);
    assertEquals(sent.twilio, 1);
  });
});
