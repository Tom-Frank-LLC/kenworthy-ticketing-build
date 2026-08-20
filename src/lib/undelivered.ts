/**
 * Orders that were paid for and never reached the buyer.
 *
 * Delivery is dispatched fire-and-forget precisely so it can never fail a
 * purchase — which makes silence the failure mode. Every outcome is written
 * back to the ticket rows, and until now nothing read them: `confirmation_error`
 * was the only record of a failed send and no screen in the app showed it. The
 * advice "watch confirmation_error" required someone to write SQL and to think
 * to do so.
 *
 * Three failures that look alike in the data and mean different things:
 *
 *   reported  `confirmation_error` is set. Something tried and said why.
 *   silent    `confirmation_sent_at` is still null with no error at all. The
 *             dangerous one — the dispatch never ran, or died before it could
 *             record anything, which is exactly what happened when
 *             ticket-checkout POSTed to a sibling function and the gateway
 *             began refusing the credential pair. Purchases succeeded, no
 *             ticket went out, and nothing errored anywhere.
 *   partial   sent *and* errored. The buyer has their tickets and one channel
 *             still failed. The only one whose resend has to force past the
 *             double-send guard.
 *
 * Deliberately free of the query that feeds it — that lives in
 * `useUndeliveredOrders`, which constructs a Supabase client at import time and
 * so cannot be pulled into a unit test. The judgement is here; the fetching is
 * not.
 */
export interface UndeliveredOrder {
  orderToken: string;
  purchasedAt: string;
  ticketCount: number;
  title: string;
  startTime: string | null;
  /** Whatever we can address them by, best first. Null when we have neither. */
  contact: string | null;
  name: string | null;
  channel: string | null;
  error: string | null;
  /** Something reached them and one channel still failed. Needs `force` to resend. */
  partial: boolean;
}

export type UndeliveredRow = {
  order_token: string;
  purchased_at: string;
  status: string;
  confirmation_sent_at: string | null;
  confirmation_channel: string | null;
  confirmation_error: string | null;
  user_id: string | null;
  showings: {
    start_time: string | null;
    movies: { title: string } | null;
    events: { title: string } | null;
    live_performances: { title: string } | null;
  } | null;
};

export interface BuyerProfile {
  email: string | null;
  phone: string | null;
  display_name: string | null;
}

/**
 * Ticket rows to one entry per order. Pure, and separated from the query
 * because this is where the judgement lives: which of the three failures a row
 * represents, and which contact is worth putting on screen.
 */
export function toUndeliveredOrders(
  rows: UndeliveredRow[],
  profiles: Map<string, BuyerProfile>,
): UndeliveredOrder[] {
  // One row per ticket, one card per order.
  const byOrder = new Map<string, UndeliveredRow[]>();
  for (const row of rows) {
    const existing = byOrder.get(row.order_token);
    if (existing) existing.push(row);
    else byOrder.set(row.order_token, [row]);
  }

  const orders: UndeliveredOrder[] = [...byOrder.entries()].map(([orderToken, group]) => {
    const first = group[0];
    const showing = first.showings;
    const profile = first.user_id ? profiles.get(first.user_id) : undefined;
    return {
      orderToken,
      purchasedAt: first.purchased_at,
      ticketCount: group.length,
      title:
        showing?.movies?.title ||
        showing?.events?.title ||
        showing?.live_performances?.title ||
        'Kenworthy showing',
      startTime: showing?.start_time ?? null,
      // Email first: it is the channel that carries the QR, so it is the one
      // worth reading off a screen when working out what went wrong.
      contact: profile?.email || profile?.phone || null,
      name: profile?.display_name || null,
      channel: first.confirmation_channel,
      error: first.confirmation_error,
      // Reached them on one channel and failed on the other. Distinct from the
      // other two cases, and the only one whose resend has to force past the
      // double-send guard.
      partial: !!first.confirmation_sent_at && !!first.confirmation_error,
    };
  });

  orders.sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
  return orders;
}
