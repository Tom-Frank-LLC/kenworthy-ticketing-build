import { invokeFunction } from '@/lib/functions';
import {
  describeStand, ensureStandAuthorized, standAvailable, standFailureMessage, standOf,
  takeStandPayment, type StandPaymentResult, type StandStatus,
} from '@/lib/standReader';
import type { ChargeRequest, StandResult, StandStatusMessage } from '@/lib/patronDisplay';

/**
 * The patron-facing display's half of a card sale on its Square Stand
 * (docs/briefs/BRIEF-stand-at-patron-display.md).
 *
 * The till starts the sale and names its Square Order over the pairing
 * channel. Everything else comes from the server: the amount and the order
 * token (`stand_charge`, read from Square's order and held to the pending
 * rows), and whether the payment counts (`confirm_sale`, read from Square's
 * payment). The display is signed in as staff for exactly this; a display on
 * the website (a phone, no Stand) never gets here.
 */

export interface StandChargeDetails {
  order_token: string;
  amount_cents: number;
  reference_id: string;
  square_order_id: string;
  ticket_count: number;
}

interface ConfirmAnswer {
  confirmed?: boolean;
  already_confirmed?: boolean;
  status?: string;
  payment_id?: string | null;
}

/** The pieces a charge needs, injectable so the tests can run it without an iPad. */
export interface ChargeDeps {
  details: (squareOrderId: string) => Promise<StandChargeDetails>;
  authorize: () => Promise<unknown>;
  take: (sale: Parameters<typeof takeStandPayment>[0]) => Promise<StandPaymentResult>;
  confirm: (orderToken: string, paymentId: string) => Promise<ConfirmAnswer>;
  wait: (ms: number) => Promise<void>;
  newAttemptId: () => string;
}

export const liveChargeDeps: ChargeDeps = {
  details: (squareOrderId) => invokeFunction<StandChargeDetails>('square-terminal', { action: 'stand_charge', square_order_id: squareOrderId }),
  authorize: () => ensureStandAuthorized(),
  take: (sale) => takeStandPayment(sale),
  confirm: (orderToken, paymentId) => invokeFunction<ConfirmAnswer>('square-terminal', { action: 'confirm_sale', order_token: orderToken, payment_id: paymentId }),
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  newAttemptId: () => crypto.randomUUID(),
};

/**
 * The charge this display is running, if any. Module state, not React state:
 * whether a card can still be taken is a fact about the plugin call, and a
 * cancel must be answered from that fact. Answered from screen state, a
 * cancel once arrived after an earlier run had cleared the screen's "working"
 * flag while Square's payment screen was up for the next sale, so the display
 * said "no card taken" and the till released the seats of a live payment
 * (simulator, 28 Oct 2026).
 */
let running: { saleId: string; cancelled: boolean } | null = null;

/** True while a charge runs here: from the till's request to its final answer. */
export function displayChargeRunning(): string | null {
  return running?.saleId ?? null;
}

/**
 * The till cancelled this sale. 'running': the charge is under way, and its
 * own result will say whether a card was taken (stop Square's screen with
 * StandReader.cancelPayment). 'idle': nothing is running for that sale here,
 * so no card was taken here.
 */
export function cancelDisplayCharge(saleId: string): 'running' | 'idle' {
  if (running?.saleId !== saleId) return 'idle';
  running.cancelled = true;
  return 'running';
}

/** How long to keep asking Square about a payment that is not final yet. */
const CONFIRM_TRIES = 8;
const CONFIRM_EVERY_MS = 1500;

/**
 * Take the card for one charge request and say how it went. Never throws: a
 * failure is a result the patron and the till both need to hear.
 *
 * Each call is a new attempt (Square's idempotency is per attempt), so "Try
 * again" after a decline is simply another call for the same order.
 */
export async function runDisplayCharge(request: ChargeRequest, deps: ChargeDeps = liveChargeDeps): Promise<StandResult> {
  if (running) {
    return { saleId: request.saleId, outcome: 'error', message: 'The card reader is busy with another sale.' };
  }
  const me = { saleId: request.saleId, cancelled: false };
  running = me;
  try {
    return await charge(request, deps, me);
  } finally {
    running = null;
  }
}

async function charge(request: ChargeRequest, deps: ChargeDeps, me: { cancelled: boolean }): Promise<StandResult> {
  const base = { saleId: request.saleId };
  const cancelled: StandResult = { ...base, outcome: 'canceled', message: 'Cancelled by the box office.' };
  let details: StandChargeDetails;
  try {
    await deps.authorize();
    details = await deps.details(request.squareOrderId);
  } catch (err) {
    return { ...base, outcome: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  // A cancel that came while the server was asked stops the charge here,
  // before Square's screen ever opens.
  if (me.cancelled) return cancelled;

  let result: StandPaymentResult;
  try {
    result = await deps.take({
      amountCents: details.amount_cents,
      referenceId: details.reference_id,
      orderId: details.square_order_id,
      paymentAttemptId: deps.newAttemptId(),
      note: `${details.ticket_count} ticket(s)`,
    });
  } catch (err) {
    return { ...base, outcome: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  const paymentId = result.payment?.id ?? null;
  if (!paymentId) {
    // Square created no payment, so no money moved.
    return result.status === 'canceled'
      ? { ...base, outcome: 'canceled', message: 'The payment was cancelled.' }
      : { ...base, outcome: 'declined', message: standFailureMessage(result) };
  }

  // A payment exists, even if the SDK called it a failure: only Square knows,
  // so the server asks it. Until it answers, the till holds the payment id too.
  for (let i = 0; i < CONFIRM_TRIES; i++) {
    try {
      const answer = await deps.confirm(details.order_token, paymentId);
      if (answer.confirmed || answer.already_confirmed) return { ...base, outcome: 'paid', paymentId };
      if (answer.status === 'FAILED' || answer.status === 'CANCELED') {
        return { ...base, outcome: 'declined', paymentId, message: 'The card was declined.' };
      }
    } catch (err) {
      // A refusal (wrong order, wrong amount) is final; say it as it is.
      return { ...base, outcome: 'error', paymentId, message: err instanceof Error ? err.message : String(err) };
    }
    await deps.wait(CONFIRM_EVERY_MS);
  }
  return { ...base, outcome: 'error', paymentId, message: 'Square has not finished the payment yet. Staff: check the sale before charging again.' };
}

/** The display app is signed out, so the server will not let its Stand charge. */
export const DISPLAY_NOT_SIGNED_IN = 'the display is not signed in as staff (tap the logo on the display to sign in)';

/** The display's Stand, as the till's reader picker should describe it. */
export function displayStandStatus(status: StandStatus | null, problem: string | null): StandStatusMessage {
  if (!standAvailable()) return { ready: false, line: 'the display is not the Kenworthy app' };
  // The server's word for a missing or expired session.
  if (problem) return { ready: false, line: /not authenticated/i.test(problem) ? DISPLAY_NOT_SIGNED_IN : problem };
  const stand = standOf(status);
  const ready = !!status?.authorized && status.location !== 'denied'
    && (stand?.status === 'ready' || (status.environment === 'sandbox' && (status.readers?.length ?? 0) > 0));
  return { ready, line: describeStand(status) };
}
