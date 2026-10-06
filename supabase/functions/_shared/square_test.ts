import { assert, assertEquals, assertFalse, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  createCashPayment,
  createPayment,
  isChargeableSource,
  type SquareConfig,
} from './square.ts';

/**
 * "CASH" in a public checkout's body used to become a completed cash tender —
 * confirmed tickets with no card behind them. These pin the two places that
 * now refuse it: the check each public function runs first, and createPayment
 * itself, so a caller that forgets the first still cannot charge with it.
 */

const config: SquareConfig = {
  environment: 'sandbox',
  applicationId: 'sandbox-app',
  accessToken: 'test-token',
  locationId: 'LOC',
  apiBase: 'https://connect.squareupsandbox.com/v2',
};

/** Capture the bodies sent to Square without reaching it. */
function stubFetch(): { bodies: any[]; restore: () => void } {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')));
    return Promise.resolve(
      new Response(JSON.stringify({ payment: { id: 'P', status: 'COMPLETED' } }), { status: 200 }),
    );
  }) as typeof fetch;
  return { bodies, restore: () => { globalThis.fetch = original; } };
}

Deno.test('isChargeableSource: an SDK card token is chargeable', () => {
  assert(isChargeableSource('cnon:card-nonce-ok'));
});

Deno.test('isChargeableSource: Square money-less sources are refused, in any case or padding', () => {
  for (const s of ['CASH', 'cash', ' Cash ', 'EXTERNAL', 'external']) {
    assertFalse(isChargeableSource(s), s);
  }
});

Deno.test('isChargeableSource: empty and non-string sources are refused', () => {
  for (const s of ['', '   ', undefined, null, 42, {}]) {
    assertFalse(isChargeableSource(s), String(s));
  }
});

Deno.test('createPayment refuses CASH before contacting Square', async () => {
  const { bodies, restore } = stubFetch();
  try {
    await assertRejects(() =>
      createPayment(config, { sourceId: 'CASH', amountCents: 848, idempotencyKey: 'k' })
    );
    await assertRejects(() =>
      createPayment(config, { sourceId: 'EXTERNAL', amountCents: 848, idempotencyKey: 'k' })
    );
    assertEquals(bodies.length, 0);
  } finally {
    restore();
  }
});

Deno.test('createPayment sends a card token with no cash tender', async () => {
  const { bodies, restore } = stubFetch();
  try {
    await createPayment(config, { sourceId: 'cnon:card-nonce-ok', amountCents: 848, idempotencyKey: 'k' });
    assertEquals(bodies[0].source_id, 'cnon:card-nonce-ok');
    assertEquals(bodies[0].cash_details, undefined);
  } finally {
    restore();
  }
});

Deno.test('createCashPayment records the counter cash tender for the full amount', async () => {
  const { bodies, restore } = stubFetch();
  try {
    await createCashPayment(config, { amountCents: 1696, idempotencyKey: 'cash-pay-t', orderId: 'O', referenceId: 't' });
    assertEquals(bodies[0].source_id, 'CASH');
    assertEquals(bodies[0].amount_money, { amount: 1696, currency: 'USD' });
    assertEquals(bodies[0].cash_details.buyer_supplied_money, { amount: 1696, currency: 'USD' });
    assertEquals(bodies[0].order_id, 'O');
  } finally {
    restore();
  }
});
