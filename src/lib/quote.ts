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

/**
 * What a valid promo code did to this order (price_ticket_order,
 * 20261120190412). A code that cannot be used at all is not one of these: it
 * comes back as a refusal in words.
 */
export type PromoStatus = 'applied' | 'below_minimum' | 'not_eligible' | 'better_discount';
export interface PromoOutcome {
  code: string;
  status: PromoStatus;
  minQuantity: number | null;
}

/**
 * How a coded quote is asked for.
 *   'public'  the showing page: the rate-limited promo-quote edge function.
 *             quote_ticket_order (anon, unthrottled) takes no code on purpose.
 *   'staff'   the box office: quote_ticket_order_coded, which refuses anyone
 *             but staff.
 */
export type PromoVia = 'public' | 'staff';
export interface PromoRequest { code: string; via: PromoVia }

/** The promo outcome off the function's rows, or null. Exported for tests. */
export function promoFromRows(rows: any[]): PromoOutcome | null {
  const first = rows?.[0];
  if (!first?.promo_code || !first?.promo_status) return null;
  return {
    code: first.promo_code,
    status: first.promo_status,
    minQuantity: first.promo_min_quantity == null ? null : Number(first.promo_min_quantity),
  };
}

/** The sentence for a valid code that is not this order's discount, or null when it is. */
export function promoNotice(promo: PromoOutcome | null): string | null {
  if (!promo) return null;
  switch (promo.status) {
    case 'applied': return null;
    case 'below_minimum':
      return `${promo.code} needs at least ${promo.minQuantity ?? 2} tickets in the order.`;
    case 'not_eligible': return `${promo.code} doesn't apply to the ticket types in this order.`;
    case 'better_discount': return `A better discount already applies to this order, so ${promo.code} isn't needed.`;
    default: return null;
  }
}

type QuoteResult =
  | { quote: OrderQuote; promo: PromoOutcome | null }
  | { error: string; promoRefused?: boolean };

const descriptorsOf = (tickets: TicketDescriptor[]) =>
  tickets.map((t) => ({ seat_id: t.seat_id ?? null, tier_id: t.tier_id ?? null }));

export async function fetchQuote(
  showingId: string,
  tickets: TicketDescriptor[],
  channel: QuoteChannel,
  promo?: PromoRequest | null,
): Promise<QuoteResult> {
  if (promo?.code && promo.via === 'public') {
    const { data, error } = await supabase.functions.invoke('promo-quote', {
      body: { showing_id: showingId, tickets: descriptorsOf(tickets), code: promo.code },
    });
    if (error) {
      // A non-2xx leaves the body unread on error.context (see lib/functions.ts).
      const response = (error as { context?: unknown }).context as Response | undefined;
      const body = response && typeof response.json === 'function'
        ? ((await response.json().catch(() => null)) as { error?: string; promo_refused?: boolean } | null)
        : null;
      return { error: body?.error || 'Could not check that promo code', promoRefused: !!body?.promo_refused };
    }
    return { quote: data.quote as OrderQuote, promo: (data.promo ?? null) as PromoOutcome | null };
  }

  const { data, error } = promo?.code
    ? await supabase.rpc('quote_ticket_order_coded', {
      p_showing_id: showingId, p_tickets: descriptorsOf(tickets), p_channel: channel, p_code: promo.code,
    })
    : await supabase.rpc('quote_ticket_order', {
      p_showing_id: showingId, p_tickets: descriptorsOf(tickets), p_channel: channel,
    });
  // PT422 is a promo code that cannot be used; every other refusal is the order's.
  if (error) return { error: error.message || 'Could not price this order', promoRefused: error.code === 'PT422' };
  return { quote: quoteFromRows(data ?? []), promo: promoFromRows(data ?? []) };
}

/**
 * The running total for a selection, optionally with a promo code.
 *
 * A code that is refused does not take the total with it: the hook prices the
 * order again without the code, so the screen keeps showing what the buyer
 * would actually pay, and the refusal arrives separately as `promoError` for
 * the code box. `promo` is non-null only for a code the database accepted, so
 * callers send a code at checkout exactly when `promo` is set.
 */
export function useOrderQuote(
  showingId: string | null | undefined,
  tickets: TicketDescriptor[],
  channel: QuoteChannel,
  debounceMs = 150,
  promoRequest: PromoRequest | null = null,
) {
  const [quote, setQuote] = useState<OrderQuote>(EMPTY_QUOTE);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [promo, setPromo] = useState<PromoOutcome | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const seq = useRef(0);
  // The selection as a string, so an equal selection is the same dependency.
  const key = `${showingId ?? ''}|${channel}|${promoRequest?.via ?? ''}:${promoRequest?.code ?? ''}|${JSON.stringify(tickets.map((t) => [t.seat_id ?? null, t.tier_id ?? null]))}`;

  useEffect(() => {
    const mine = ++seq.current;
    if (!showingId || tickets.length === 0) {
      setQuote(EMPTY_QUOTE); setError(null); setLoading(false); setPromo(null); setPromoError(null);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      let res = await fetchQuote(showingId, tickets, channel, promoRequest);
      let refusedCode: string | null = null;
      if ('error' in res && res.promoRefused) {
        refusedCode = res.error;
        res = await fetchQuote(showingId, tickets, channel, null);
      }
      if (mine !== seq.current) return; // a newer selection has been asked about
      setPromoError(refusedCode);
      if ('error' in res) { setError(res.error); setPromo(null); }
      else { setQuote(res.quote); setError(null); setPromo(res.promo); }
      setLoading(false);
    }, debounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { quote, error, loading, promo, promoError };
}
