import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * The running order total, from the database's own pricing function.
 *
 * `quote_ticket_order` is the same function `create_ticket_order` prices with,
 * so what this shows is what will be charged — by construction, not by keeping
 * a browser copy of the arithmetic in step (which is what this replaced; see
 * BRIEF-pricing-rpc). The cost is a round trip after each change of selection;
 * the last quote stays on screen while the next one loads, and identical
 * selections are not re-asked.
 *
 * A refusal (sold out, passed, tier gone) arrives as `error` in the database's
 * own words — the same sentence the buy button would have met.
 */

export type TicketDescriptor = { seat_id?: string | null; tier_id?: string | null };
export type QuoteChannel = 'online' | 'in_person' | 'none';

export interface OrderQuote {
  ticketCount: number;
  /** Before any discount. */
  subtotal: number;
  discount: { label: string; amount: number } | null;
  tax: number;
  /** Tickets + tax, after the discount. */
  total: number;
  processingFee: number;
  /** total + processingFee: the ticket side of the charge. */
  grandTotal: number;
}

export const EMPTY_QUOTE: OrderQuote = {
  ticketCount: 0, subtotal: 0, discount: null, tax: 0, total: 0, processingFee: 0, grandTotal: 0,
};

/** Turn the function's rows into one quote. Exported for tests. */
export function quoteFromRows(rows: any[]): OrderQuote {
  if (!rows || rows.length === 0) return EMPTY_QUOTE;
  const first = rows[0];
  const n = (v: unknown) => Number(v ?? 0);
  const labelled = rows.find((r) => r.discount_label);
  return {
    ticketCount: rows.length,
    subtotal: n(first.order_list_subtotal),
    discount: n(first.order_discount) > 0 ? { label: labelled?.discount_label ?? 'Discount', amount: n(first.order_discount) } : null,
    tax: n(first.order_tax),
    total: n(first.order_total),
    processingFee: n(first.order_processing_fee),
    grandTotal: n(first.order_grand_total),
  };
}

export async function fetchQuote(showingId: string, tickets: TicketDescriptor[], channel: QuoteChannel): Promise<{ quote: OrderQuote } | { error: string }> {
  const { data, error } = await (supabase as any).rpc('quote_ticket_order', {
    p_showing_id: showingId,
    p_tickets: tickets.map((t) => ({ seat_id: t.seat_id ?? null, tier_id: t.tier_id ?? null })),
    p_channel: channel,
  });
  if (error) return { error: error.message || 'Could not price this order' };
  return { quote: quoteFromRows(data ?? []) };
}

export function useOrderQuote(showingId: string | null | undefined, tickets: TicketDescriptor[], channel: QuoteChannel, debounceMs = 150) {
  const [quote, setQuote] = useState<OrderQuote>(EMPTY_QUOTE);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  // The selection as a string, so an equal selection is the same dependency.
  const key = `${showingId ?? ''}|${channel}|${JSON.stringify(tickets.map((t) => [t.seat_id ?? null, t.tier_id ?? null]))}`;

  useEffect(() => {
    const mine = ++seq.current;
    if (!showingId || tickets.length === 0) {
      setQuote(EMPTY_QUOTE); setError(null); setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const res = await fetchQuote(showingId, tickets, channel);
      if (mine !== seq.current) return; // a newer selection has been asked about
      if ('error' in res) setError(res.error);
      else { setQuote(res.quote); setError(null); }
      setLoading(false);
    }, debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { quote, error, loading };
}
