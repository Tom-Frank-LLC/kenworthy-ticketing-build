// Is this Square payment one the counter may book a walk-in pass sale against?
//
// Pure, so it can be tested: index.ts reads the payment and the "already used"
// lookups, and this decides. A pass activated as a card sale used to accept any
// square_payment_id string, so a cash sale could be booked as card against
// another sale's payment and the till would expect nothing (security audit
// 2026-10-06, L1).

export interface CounterPaymentInput {
  /** Square answered the GET /payments/{id}. */
  found: boolean;
  payment?: {
    status?: string;
    location_id?: string;
    amount_money?: { amount?: number };
    total_money?: { amount?: number };
    refunded_money?: { amount?: number };
  } | null;
  locationId: string;
  /** What this pass costs at the counter, tax included. */
  dueCents: number;
  /** The id is already on a ticket, a pass or a pass order. */
  alreadyUsed: boolean;
}

/** The reason to refuse, in words for the counter, or null if it is good. */
export function counterPaymentProblem(input: CounterPaymentInput): string | null {
  const p = input.payment;
  if (!input.found || !p) return 'Square has no record of that card payment. Take the card again.';
  if (input.alreadyUsed) return 'That card payment already paid for a different sale. Take the card again.';
  if (p.status !== 'COMPLETED') return `That card payment is ${String(p.status ?? 'not complete').toLowerCase()}, not completed.`;
  if (p.location_id && p.location_id !== input.locationId) return 'That card payment was taken at a different Square location.';
  if ((p.refunded_money?.amount ?? 0) > 0) return 'That card payment has been refunded.';
  const paid = p.total_money?.amount ?? p.amount_money?.amount ?? 0;
  if (paid < input.dueCents) {
    return `That card payment was $${(paid / 100).toFixed(2)}; this pass is $${(input.dueCents / 100).toFixed(2)}.`;
  }
  return null;
}
