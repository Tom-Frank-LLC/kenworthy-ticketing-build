// May the counter file this gift? (square-donation `record_in_person`.)
//
// Pure, so it can be tested: index.ts reads the order's ticket rows, the
// existing gift and the Square payment, and this decides.
//
// The action files a completed, receipted gift and posts it to Little Green
// Light. It used to take any amount on a staff member's word, with no payment
// evidence at all (security audit 2026-10-06, L1). Now the gift has to ride on
// a sale that our own server functions recorded, and Square has to hold money
// for it:
//
// - The sale is named by its order token, and the gift is checked against
//   that order's ticket rows: the channel matches how they were paid, they are
//   confirmed, and they are the caller's own sale (POS rows carry the staff
//   member as user_id) unless the caller is an admin.
// - The order's rows carry the Square payment that paid for it. Only server
//   code writes that column: square-terminal `confirm_sale` after binding the
//   checkout to this order, and square-cash-sale after posting the CASH tender.
//   A session cannot (create_ticket_order refuses it; staff have no UPDATE on
//   tickets). For a terminal gift, the payment id the POS sends must be that
//   one. For a cash gift the POS sends none, and the stamp is read.
// - That payment, read back from Square, must cover the rows plus the gift
//   (`counterPaymentProblem`, the same test a walk-in pass sale passes).
//   start_sale and square-cash-sale both put the gift into the amount Square
//   took, so an honest gift always fits and an invented one does not.
// - One gift per order. A retry of the same order answers "already recorded"
//   rather than filing and receipting a second gift.
// - At most MAX_BUNDLED_DONATION_CENTS, the ceiling the POS donation box and
//   both counter sale paths already enforce.

import { MAX_BUNDLED_DONATION_CENTS } from '../_shared/pricing.ts';

export type Channel = 'cash' | 'terminal';

export interface OrderTicket {
  user_id: string | null;
  payment_method: string | null;
  status: string | null;
  square_payment_id: string | null;
  total_price: number | string | null;
  processing_fee: number | string | null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the order's ticket rows came to, fees included, in cents. */
export function orderCents(tickets: OrderTicket[]): number {
  return tickets.reduce(
    (sum, t) => sum + Math.round(Number(t.total_price ?? 0) * 100) + Math.round(Number(t.processing_fee ?? 0) * 100),
    0,
  );
}

export interface Refusal {
  status: number;
  error: string;
}

/** Shape checks on the request itself, before anything is read. */
export function requestProblem(body: Record<string, unknown>): Refusal | null {
  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < 100) {
    return { status: 400, error: 'A counter gift must be at least $1.' };
  }
  if (amountCents > MAX_BUNDLED_DONATION_CENTS) {
    return {
      status: 400,
      error: `A counter gift is capped at $${MAX_BUNDLED_DONATION_CENTS / 100}. Take a larger gift through Donations.`,
    };
  }
  const channel = String(body.paymentChannel || '');
  if (channel !== 'cash' && channel !== 'terminal') {
    return { status: 400, error: 'paymentChannel must be cash or terminal' };
  }
  if (typeof body.orderToken !== 'string' || !UUID_RE.test(body.orderToken.trim())) {
    return { status: 400, error: 'A counter gift must be recorded with the sale it was taken on.' };
  }
  return null;
}

export interface OrderInput {
  channel: Channel;
  tickets: OrderTicket[];
  callerId: string;
  callerIsAdmin: boolean;
  /** What the POS sent. Only a terminal gift sends one. */
  claimedPaymentId: string | null;
  /** Square environment: a simulated reader exists only in the sandbox. */
  environment: 'sandbox' | 'production';
}

export type OrderVerdict =
  | { ok: false; refusal: Refusal }
  /** paymentId null: a sandbox simulated reader; there is no payment to read. */
  | { ok: true; paymentId: string | null };

/**
 * Does the order this gift names back it? Decides which Square payment, if
 * any, has to be read next.
 */
export function orderProblem(input: OrderInput): OrderVerdict {
  const refuse = (status: number, error: string): OrderVerdict => ({ ok: false, refusal: { status, error } });
  const live = input.tickets.filter((t) => t.status !== 'failed');
  if (live.length === 0) return refuse(404, 'No sale under that order. Record the gift with the sale it was taken on.');

  if (!input.callerIsAdmin && live.some((t) => t.user_id !== input.callerId)) {
    return refuse(403, 'That sale was rung by someone else.');
  }
  const method = input.channel === 'cash' ? 'cash' : 'card';
  if (live.some((t) => t.payment_method !== method)) {
    return refuse(400, `That sale was not a ${input.channel === 'cash' ? 'cash' : 'card'} sale.`);
  }
  if (live.some((t) => t.status !== 'confirmed')) {
    return refuse(409, 'That sale is not complete yet, so its gift cannot be recorded.');
  }

  const stamped = new Set(live.map((t) => t.square_payment_id ?? null));
  if (stamped.size !== 1) return refuse(409, 'That sale carries more than one payment. Tell a manager.');
  const paymentId = [...stamped][0];

  if (input.channel === 'cash') {
    if (!paymentId) {
      return refuse(
        409,
        'That cash sale was not recorded in Square, so its gift cannot be receipted here. Tell a manager.',
      );
    }
    return { ok: true, paymentId };
  }

  // Terminal.
  const claimed = input.claimedPaymentId?.trim() || null;
  if (!paymentId) {
    // confirm_sale stamps the payment on every real reader sale. Only the
    // sandbox's simulated reader confirms without one.
    if (input.environment === 'sandbox' && !claimed) return { ok: true, paymentId: null };
    return refuse(400, 'A card gift needs the payment from the reader.');
  }
  if (!claimed) return refuse(400, 'A card gift needs the payment from the reader.');
  if (claimed !== paymentId) return refuse(409, 'That card payment belongs to a different sale.');
  return { ok: true, paymentId };
}
