// The testable half of square-refund: how claimed tickets are split by the
// way they were paid, and the idempotency key for one Square refund.
//
// index.ts calls Deno.serve at import time, so nothing in it can be imported
// by a test.

export interface ClaimedTicket {
  id: string;
  total_price: number | string | null;
  processing_fee: number | string | null;
  payment_method: string | null;
  square_payment_id: string | null;
}

export interface RefundPlan {
  /** Card and online payments: money goes back to the card, through Square. */
  card: Map<string, ClaimedTicket[]>;
  /** Counter cash. The money comes out of the till; when square-cash-sale
   *  recorded the sale as a CASH tender, Square is told too, so its books
   *  match ours — but that is bookkeeping, not the refund. */
  cash: Map<string | null, ClaimedTicket[]>;
  /** Paid with a film pass: the balance goes back on the pass. */
  filmPass: ClaimedTicket[];
  /** Comps: nothing was paid, nothing to return. */
  comp: ClaimedTicket[];
  /** A paid method with no Square payment on file (older rows): nothing the
   *  server can refund, so staff are told to settle it by hand. */
  manual: ClaimedTicket[];
}

/**
 * Split tickets by tender.
 *
 * The tender is decided by payment_method, not by whether a payment id is
 * present. square-cash-sale stamps the CASH tender's id on counter-cash rows,
 * so "has a payment id" stopped meaning "a card was charged" — and those rows
 * went down the card branch, where the "refund the customer from the till"
 * warning is never shown (security audit 2026-10-06, L3).
 */
export function planRefund(tickets: ClaimedTicket[]): RefundPlan {
  const plan: RefundPlan = { card: new Map(), cash: new Map(), filmPass: [], comp: [], manual: [] };
  const push = <K>(m: Map<K, ClaimedTicket[]>, k: K, t: ClaimedTicket) => {
    const list = m.get(k) ?? [];
    list.push(t);
    m.set(k, list);
  };
  for (const t of tickets) {
    const method = t.payment_method ?? '';
    if (method === 'comp') plan.comp.push(t);
    else if (method === 'film_pass') plan.filmPass.push(t);
    else if (method === 'cash') push(plan.cash, t.square_payment_id ?? null, t);
    else if (t.square_payment_id && centsOf([t]) > 0) push(plan.card, t.square_payment_id, t);
    else if (centsOf([t]) > 0) plan.manual.push(t);
    else plan.comp.push(t); // paid nothing by any method: nothing to return
  }
  return plan;
}

/** What these tickets took, surcharge included, in cents. */
export function centsOf(rows: ClaimedTicket[]): number {
  return rows.reduce(
    (sum, t) => sum + Math.round(Number(t.total_price || 0) * 100) + Math.round(Number(t.processing_fee || 0) * 100),
    0,
  );
}

/** Stable 40-char key for "refund exactly these tickets of this payment". The
 *  tickets are the ones this request claimed, so two overlapping requests can
 *  never both hold a ticket and the keys can never describe the same money. */
export async function refundKey(paymentId: string, ticketIds: string[]): Promise<string> {
  const material = `${paymentId}:${[...ticketIds].sort().join(',')}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 40);
}
