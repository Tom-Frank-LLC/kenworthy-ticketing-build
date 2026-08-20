import { describe, it, expect } from 'vitest';
import { toUndeliveredOrders, type UndeliveredRow, type BuyerProfile } from './undelivered';

/**
 * The judgement this card makes, without the query around it.
 *
 * Three failures look similar in the data and mean different things, and the
 * resend behaves differently for one of them. Getting the partial case wrong is
 * the expensive mistake: without `force` the retry guard skips it silently, so
 * staff would press a button, see success, and the buyer would still be
 * waiting — which is the same class of invisible failure the whole card exists
 * to end.
 */

const showing = {
  start_time: '2026-08-21T02:00:00.000Z',
  movies: { title: 'Cat Video Fest 2026' },
  events: null,
  live_performances: null,
};

function row(over: Partial<UndeliveredRow> = {}): UndeliveredRow {
  return {
    order_token: 'order-1',
    purchased_at: '2026-08-20T02:00:00.000Z',
    status: 'confirmed',
    confirmation_sent_at: null,
    confirmation_channel: null,
    confirmation_error: null,
    user_id: 'user-1',
    showings: showing,
    ...over,
  };
}

const profiles = new Map<string, BuyerProfile>([
  ['user-1', { email: 'buyer@example.com', phone: '2088929752', display_name: 'Test Buyer' }],
]);

describe('toUndeliveredOrders', () => {
  it('collapses a multi-ticket order into one entry', () => {
    const orders = toUndeliveredOrders(
      [row(), row(), row()],
      profiles,
    );

    expect(orders).toHaveLength(1);
    expect(orders[0].ticketCount).toBe(3);
    expect(orders[0].title).toBe('Cat Video Fest 2026');
  });

  it('reports a recorded failure as itself, not as a partial', () => {
    const orders = toUndeliveredOrders(
      [row({ confirmation_error: 'Resend 500: down' })],
      profiles,
    );

    expect(orders[0].error).toBe('Resend 500: down');
    expect(orders[0].partial).toBe(false);
  });

  it('marks an order that got one channel through as partial', () => {
    // confirmation_sent_at AND an error: the buyer has their tickets and
    // something still failed. This is the one whose resend needs force.
    const orders = toUndeliveredOrders(
      [row({
        confirmation_sent_at: '2026-08-20T02:01:00.000Z',
        confirmation_channel: 'email',
        confirmation_error: 'Twilio 400: unreachable',
      })],
      profiles,
    );

    expect(orders[0].partial).toBe(true);
    expect(orders[0].channel).toBe('email');
  });

  it('keeps the silent case distinct — nothing sent and nothing said', () => {
    // No error and no send. The dispatch never ran, or died before it could
    // record why. It has no message of its own, so the UI supplies one.
    const orders = toUndeliveredOrders([row()], profiles);

    expect(orders[0].error).toBeNull();
    expect(orders[0].partial).toBe(false);
  });

  it('prefers the email as the contact, and admits when there is none', () => {
    const phoneOnly = new Map<string, BuyerProfile>([
      ['user-2', { email: null, phone: '2088929752', display_name: null }],
    ]);

    expect(toUndeliveredOrders([row()], profiles)[0].contact).toBe('buyer@example.com');
    expect(
      toUndeliveredOrders([row({ order_token: 'o2', user_id: 'user-2' })], phoneOnly)[0].contact,
    ).toBe('2088929752');
    // A buyer with no profile row at all: the resend button has nothing to
    // send to, and the card says so rather than offering a dead button.
    expect(
      toUndeliveredOrders([row({ order_token: 'o3', user_id: 'nobody' })], profiles)[0].contact,
    ).toBeNull();
  });

  it('puts the newest order first', () => {
    const orders = toUndeliveredOrders(
      [
        row({ order_token: 'older', purchased_at: '2026-08-19T02:00:00.000Z' }),
        row({ order_token: 'newer', purchased_at: '2026-08-20T02:00:00.000Z' }),
      ],
      profiles,
    );

    expect(orders.map(o => o.orderToken)).toEqual(['newer', 'older']);
  });

  it('falls back through the showing kinds for a title', () => {
    const asEvent = row({
      showings: { start_time: null, movies: null, events: { title: 'Gala' }, live_performances: null },
    });
    const untitled = row({ order_token: 'o4', showings: null });

    expect(toUndeliveredOrders([asEvent], profiles)[0].title).toBe('Gala');
    expect(toUndeliveredOrders([untitled], profiles)[0].title).toBe('Kenworthy showing');
  });
});
