// promo-quote: the showing page's running total with a promo code applied.
// BRIEF-promo-codes, migration 20261120190412.
//
// Why this exists rather than a code argument on quote_ticket_order: the page
// quotes through quote_ticket_order directly, as anon, with no rate limit and
// no bot check. A code argument there would let anyone try codes as fast as
// PostgREST answers. So coded quotes come here, and this calls
// quote_ticket_order_coded (service role only, or staff) on the caller's
// behalf, behind two limits:
//
//   promo-code-miss  counts FAILED lookups only, and is checked before every
//                    answer. A patron re-pricing their basket with a working
//                    code is never limited; a guesser is stopped after 20
//                    misses in 10 minutes, and from then on gets no answer at
//                    all, right or wrong (see rateLimitReached).
//   promo-quote      counts every call, generously, to bound cost.
//
// The quote is a preview. ticket-checkout prices again from the database and
// create_ticket_order checks the code a third time as it writes, so nothing
// this returns is trusted for money. Per-buyer limits are not checked here
// (a guest has no account yet); checkout checks them.
//
// POST { showing_id, tickets: [{seat_id?, tier_id?}], code }
//   200 { quote, promo }             the code is valid (promo.status says
//                                    whether it changes this order)
//   400 { error, promo_refused }     the code cannot be used, in words
//   400 { error }                    the order cannot be priced (sold out, …)
//   429 { error }                    too many attempts
//
// verify_jwt stays on (the default): the browser calls this with the anon key,
// like ticket-checkout.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { json, preflight } from '../_shared/http.ts';
import { PricingError, isPromoRefusal, priceTicketOrder, readPromoCode, type TicketDescriptor } from '../_shared/pricing.ts';
import { MAX_TICKETS_PER_REQUEST } from '../_shared/ticket_limit.ts';
import { LIMITS, RATE_LIMIT_REFUSAL, checkRateLimit, rateLimitReached } from '../_shared/rate_limit.ts';


const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** What a refused guesser is told. No hint about whether the last code was right. */
export const PROMO_LIMIT_REFUSAL =
  'Too many promo codes tried in a short time. Please wait ten minutes, or call the box office on 208-882-4127.';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const showingId = String(body.showing_id ?? '').trim();
  const descriptors: TicketDescriptor[] = Array.isArray(body.tickets) ? body.tickets : [];
  const code = readPromoCode(body.code);
  if (!showingId) return json({ error: 'Showing is required' }, 400);
  if (descriptors.length === 0) return json({ error: 'Select at least one ticket' }, 400);
  if (descriptors.length > MAX_TICKETS_PER_REQUEST) {
    return json({ error: 'That is more tickets than one order can carry. Please call the box office.' }, 400);
  }
  if (!code) return json({ error: 'Enter a promo code.', promo_refused: true }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Before any answer, so the answer itself cannot leak past the limit.
  if (await rateLimitReached(admin, req, LIMITS.promoCodeMiss.bucket, LIMITS.promoCodeMiss.limit)) {
    return json({ error: PROMO_LIMIT_REFUSAL, promo_refused: true }, 429);
  }
  const rl = await checkRateLimit(
    admin, req, LIMITS.promoQuote.bucket, LIMITS.promoQuote.limit, LIMITS.promoQuote.windowSeconds,
  );
  if (!rl.allowed) return json({ error: RATE_LIMIT_REFUSAL }, 429);

  try {
    const order = await priceTicketOrder(admin, showingId, descriptors, 'online', { code });
    return json({
      quote: {
        ticketCount: order.tickets.length,
        subtotal: order.listSubtotal,
        discount: order.discount ? { label: order.discount.label, amount: order.discount.cents / 100 } : null,
        tax: order.tax,
        total: order.total,
        processingFee: order.processingFee,
        grandTotal: order.grandTotal,
      },
      promo: order.promo,
    });
  } catch (err) {
    if (isPromoRefusal(err)) {
      // A miss. Claimed after the fact: only failures count.
      await checkRateLimit(
        admin, req, LIMITS.promoCodeMiss.bucket, LIMITS.promoCodeMiss.limit, LIMITS.promoCodeMiss.windowSeconds,
      );
      return json({ error: (err as PricingError).message, promo_refused: true }, 400);
    }
    if (err instanceof PricingError) return json({ error: err.message }, 400);
    console.error('[promo-quote] pricing failed', err);
    return json({ error: 'Could not price this order' }, 500);
  }
});
