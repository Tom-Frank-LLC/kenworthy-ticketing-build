-- Sales tax is the ORDER's tax, computed the way Square computes it.
--
-- ## What was wrong
--
-- enforce_ticket_pricing taxed each ticket row on its own and rounded half-up
-- (Postgres ROUND). Square taxes an order ONCE, on the sum of its taxed lines,
-- and rounds half-to-even — measured against the sandbox, 49 orders,
-- docs/FINDINGS-square-order-arithmetic.md. The two agree only while every price
-- is a multiple of 50 cents, because 6% of such a price is a whole number of
-- cents and nothing rounds at all. Every price in production is one, which is
-- why nothing has broken. At $8.25 x 2 we charge 17.50, Square totals 17.49,
-- the checkout's reconciliation guard trips, and the Square order is abandoned
-- to a bare payment. A percent discount lands on such prices routinely (25% off
-- $9 is $6.75), which is what forced the question.
--
-- ## What changes
--
--   1. The row trigger no longer DERIVES tax. It keeps the tax the inserter
--      sent when that is within a cent of the row's own 6% — which is as far as
--      an apportioned share can ever stray — and otherwise falls back to the
--      row's own 6%, rounded Square's way.
--   2. A new statement-level trigger sees the whole INSERT, groups it by
--      order_token, and REFUSES any order whose rows do not sum to Square's tax
--      on that order. Every paid order in this system is written by one INSERT
--      sharing one order_token (ticket-checkout, StaffPOS), so "the statement"
--      is "the order".
--
-- The inserter apportions; the database checks. Deriving here instead would
-- have needed an UPDATE after the insert, and INSERT ... RETURNING is evaluated
-- before an AFTER STATEMENT trigger runs — ticket-checkout reads prices from
-- that RETURNING, and would have read the wrong ones.
--
-- ## What does not change
--
-- The charge is still SUM(tickets.total_price) for the order. That is what
-- square-refund, square-cash-sale and the transactions reconciliation re-read.
--
-- And for every price that exists today this migration is a no-op: at a
-- 50-cent multiple the row's own 6% is exact, the old and new row values are
-- identical, and the order check passes trivially. Verified against production
-- on 21 Sep 2026: 919 ticket rows, 453 paid orders, none whose tax differs
-- under the new rule. So it is safe to apply before OR after the edge functions
-- and the site that apportion — a client that still sends per-ticket tax keeps
-- working until somebody sets a price that is not a multiple of 50 cents.
--
-- Mirrored by supabase/functions/_shared/order_math.ts and its browser twin
-- src/lib/orderMath.ts. pricing_vectors.json pins all three to Square's totals.

-- ---------------------------------------------------------------------------
-- Half-to-even, in integers
-- ---------------------------------------------------------------------------

-- n / d rounded half-to-even. ROUND(numeric) is half-away-from-zero: it turns
-- 40.5 into 41 where Square says 40. (49.5 is 50 under both, which is how a
-- probe at $8.25 x 1 once failed to tell them apart.)
CREATE OR REPLACE FUNCTION public.round_half_even_div(n bigint, d bigint)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN 2 * (n - (n / d) * d) > d THEN n / d + 1
    WHEN 2 * (n - (n / d) * d) = d AND (n / d) % 2 <> 0 THEN n / d + 1
    ELSE n / d
  END
$$;
COMMENT ON FUNCTION public.round_half_even_div(bigint, bigint) IS
  'n/d rounded half-to-even, for non-negative n. Square''s rounding; not ROUND().';

-- 6% of a taxable base, in cents, the way Square totals an order.
CREATE OR REPLACE FUNCTION public.order_tax_cents(base_cents bigint)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT public.round_half_even_div(base_cents * 6, 100)
$$;
COMMENT ON FUNCTION public.order_tax_cents(bigint) IS
  'Sales tax on an order''s taxable base. Twin of taxOnCents in _shared/order_math.ts.';

-- ---------------------------------------------------------------------------
-- The row trigger: price is still derived, tax is now bounded
-- ---------------------------------------------------------------------------
-- Reproduced verbatim from 20260819040000 with the tax lines changed. Seat tier
-- resolution, tier pricing, the comp/film_pass branch and the pending-status
-- carve-out are untouched.

CREATE OR REPLACE FUNCTION public.enforce_ticket_pricing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_price numeric;
  v_seat_tier_id uuid;
  v_tax_rate numeric := 0.06;
  v_price_cents bigint;
BEGIN
  -- A comp is free, and a pass admission has already been paid for. Both record
  -- a zero-value, zero-tax ticket; neither is a sale at the door.
  IF NEW.payment_method IN ('comp', 'film_pass') THEN
    NEW.price := 0;
    NEW.tax_rate := 0;
    NEW.tax_amount := 0;
    NEW.total_price := 0;
    NEW.processing_fee := 0;
    NEW.status := 'confirmed';
    RETURN NEW;
  END IF;

  IF NEW.seat_id IS NOT NULL THEN
    SELECT sst.tier_id INTO v_seat_tier_id
    FROM public.showing_seat_tiers sst
    JOIN public.seats s ON s.id = NEW.seat_id
    JOIN public.venue_seats vs
      ON vs.seat_row = s.seat_row
     AND vs.seat_number = s.seat_number
     AND COALESCE(vs.section,'') = COALESCE(s.section,'')
    WHERE sst.showing_id = NEW.showing_id
      AND sst.venue_seat_id = vs.id
    LIMIT 1;
    IF v_seat_tier_id IS NOT NULL THEN
      NEW.tier_id := v_seat_tier_id;
    END IF;
  END IF;

  IF NEW.tier_id IS NOT NULL THEN
    SELECT price INTO v_ticket_price
    FROM public.showing_price_tiers
    WHERE id = NEW.tier_id AND showing_id = NEW.showing_id;
    IF v_ticket_price IS NULL THEN
      RAISE EXCEPTION 'Invalid tier_id for this showing';
    END IF;
  ELSE
    SELECT ticket_price INTO v_ticket_price
    FROM public.showings WHERE id = NEW.showing_id;
    IF v_ticket_price IS NULL THEN
      RAISE EXCEPTION 'Invalid showing_id';
    END IF;
  END IF;

  NEW.price := v_ticket_price;
  NEW.tax_rate := v_tax_rate;

  -- This row's share of its order's tax. The inserter apportions the order's
  -- tax across the rows (cumulatively, so the shares sum exactly), and a share
  -- can sit up to a cent either side of the row's own 6%. Anything further off
  -- than that is not an apportionment — it is a wrong number or no number — and
  -- is replaced with the row's own 6%. Whether the shares add up to the ORDER's
  -- tax is not knowable from one row; enforce_ticket_order_tax checks that once
  -- the whole statement is in.
  v_price_cents := ROUND(v_ticket_price * 100);
  IF NEW.tax_amount IS NULL
     OR ABS(NEW.tax_amount * 100 - v_price_cents * v_tax_rate) > 1 THEN
    NEW.tax_amount := ROUND(public.order_tax_cents(v_price_cents) / 100.0, 2);
  ELSE
    NEW.tax_amount := ROUND(NEW.tax_amount, 2);
  END IF;
  NEW.total_price := ROUND(v_ticket_price, 2) + NEW.tax_amount;

  -- processing_fee is buyer-paid pass-through; the checkout function computes
  -- it server-side. Negative or absent means none.
  IF NEW.processing_fee IS NULL OR NEW.processing_fee < 0 THEN
    NEW.processing_fee := 0;
  END IF;

  -- A ticket awaiting its charge stays pending; anything else is confirmed on
  -- insert exactly as before.
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    NEW.status := 'confirmed';
  END IF;

  RETURN NEW;
END;
$function$;
COMMENT ON FUNCTION public.enforce_ticket_pricing() IS
  'Server-side ticket pricing. Price comes from the tier or showing, never the '
  'inserter. comp and film_pass record a $0 admission. Tax is the row''s share of '
  'its ORDER''s tax: accepted within a cent of the row''s own 6%, and held to the '
  'order total by enforce_ticket_order_tax. See _shared/order_math.ts.';

-- ---------------------------------------------------------------------------
-- The statement trigger: the rows of an order must sum to Square's tax
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_ticket_order_tax()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bad record;
BEGIN
  SELECT order_token,
         SUM(ROUND(price * 100))::bigint      AS base_cents,
         SUM(ROUND(tax_amount * 100))::bigint AS tax_cents
    INTO v_bad
    FROM new_tickets
   WHERE payment_method NOT IN ('comp', 'film_pass')
   GROUP BY order_token
  HAVING SUM(ROUND(tax_amount * 100))::bigint
         <> public.order_tax_cents(SUM(ROUND(price * 100))::bigint)
   LIMIT 1;

  IF FOUND THEN
    -- PT422 reaches a PostgREST caller as HTTP 422. Nothing has been charged
    -- online at this point: ticket-checkout inserts pending rows before it
    -- touches the card.
    RAISE EXCEPTION
      'Order % carries % cents of tax on a % cent subtotal; Square will total it at %.',
      v_bad.order_token, v_bad.tax_cents, v_bad.base_cents,
      public.order_tax_cents(v_bad.base_cents)
      USING ERRCODE = 'PT422',
            HINT = 'Apportion the order''s tax with apportionOrderTax (_shared/order_math.ts / src/lib/orderMath.ts).';
  END IF;

  RETURN NULL;
END;
$function$;
COMMENT ON FUNCTION public.enforce_ticket_order_tax() IS
  'Refuses an INSERT in which any order''s ticket rows do not sum to Square''s tax '
  'on that order: half_even(6% x SUM(price)). One INSERT per order is how every '
  'paid path writes, so the statement is the order.';

-- AFTER, so it sees rows as the BEFORE ROW triggers left them (price derived,
-- status settled, capacity already enforced). Transition tables require a
-- single-event trigger, which INSERT-only already is.
DROP TRIGGER IF EXISTS enforce_ticket_order_tax_on_insert ON public.tickets;
CREATE TRIGGER enforce_ticket_order_tax_on_insert
  AFTER INSERT ON public.tickets
  REFERENCING NEW TABLE AS new_tickets
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.enforce_ticket_order_tax();
