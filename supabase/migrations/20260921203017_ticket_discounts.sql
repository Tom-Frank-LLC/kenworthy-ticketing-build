-- Ticket discounts: rules staff can attach to a showing or a whole production.
--
-- Ship 2 of BRIEF-ticket-discounts. Ship 1 (20260921200433) made sales tax the
-- ORDER's tax, Square's way; this adds a discount to the order on the same
-- footing. docs/DESIGN-order-level-tax-and-ticket-discounts.md is the design,
-- docs/FINDINGS-square-order-arithmetic.md the measurements behind it.
--
-- ## The model
--
-- One rule per order, never stacked. A rule yields ONE number for the order, D:
--
--   percent           half_even(value% x SUM(list price of priced tickets))
--   fixed_per_ticket  SUM(LEAST(value, list price))
--   fixed_per_order   LEAST(value, SUM(list price of priced tickets))
--
-- D is shared out across the ticket rows by the inserter; each row records what
-- it lost (discount_amount) and what it would have cost (list_price), and
-- `price` becomes the NET price. That last point is deliberate: refunds, the
-- QuickBooks export, the distributor settlement and the Square reconciliation
-- all read `price` / `total_price` as "what was charged", and they stay right
-- without being touched.
--
-- ## Enforcement: the inserter allocates, the database checks
--
-- Same division of labour as Ship 1, for the same reason (an AFTER STATEMENT
-- UPDATE would be invisible to INSERT ... RETURNING). The row trigger bounds a
-- row's discount to [0, list price]. The statement trigger then holds every
-- discounted order to its rule: the rule must exist, be active, be inside its
-- window, carry no code, belong to this showing or its production, have its
-- minimum quantity met by the order's priced tickets, and the rows' discounts
-- must sum to exactly the D above. Anything else is refused with PT422 before a
-- card is charged. A forged or stale discount cannot get in; a row that claims
-- none is simply sold at full price.
--
-- It does not insist the BEST rule was used — only that the one used is valid.
-- Choosing the best is the server's job (_shared/pricing.ts -> bestDiscount).

-- ---------------------------------------------------------------------------
-- 1. The rules
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ticket_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: exactly one. A showing, or every showing of a production.
  showing_id          uuid REFERENCES public.showings(id)          ON DELETE CASCADE,
  movie_id            uuid REFERENCES public.movies(id)            ON DELETE CASCADE,
  event_id            uuid REFERENCES public.events(id)            ON DELETE CASCADE,
  live_performance_id uuid REFERENCES public.live_performances(id) ON DELETE CASCADE,

  type text NOT NULL CHECK (type IN ('percent', 'fixed_per_ticket', 'fixed_per_order')),
  -- Percent (25 = 25%) for 'percent'; dollars for the fixed types.
  value numeric NOT NULL CHECK (value > 0),
  min_quantity integer NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),

  starts_at timestamptz,
  ends_at   timestamptz,

  -- What the buyer sees: on the showing page, in the summary, on the receipt and
  -- on Square's own receipt.
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  is_active boolean NOT NULL DEFAULT true,

  -- Reserved for promo codes. NULL means the rule applies automatically; a rule
  -- WITH a code is ignored by every automatic path until codes are built.
  code text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ticket_discounts_one_scope CHECK (
    num_nonnulls(showing_id, movie_id, event_id, live_performance_id) = 1
  ),
  CONSTRAINT ticket_discounts_percent_range CHECK (type <> 'percent' OR value <= 100),
  -- Basis points for a percent, cents for an amount: nothing finer can be charged.
  CONSTRAINT ticket_discounts_value_precision CHECK (value = ROUND(value, 2)),
  CONSTRAINT ticket_discounts_window CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

COMMENT ON TABLE public.ticket_discounts IS
  'Ticket discount rules. One applies per order (the largest), never stacked. '
  'Arithmetic: _shared/order_math.ts; enforcement: enforce_ticket_order_totals.';

CREATE INDEX IF NOT EXISTS ticket_discounts_showing_idx ON public.ticket_discounts (showing_id) WHERE showing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ticket_discounts_movie_idx   ON public.ticket_discounts (movie_id)   WHERE movie_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ticket_discounts_event_idx   ON public.ticket_discounts (event_id)   WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ticket_discounts_live_idx    ON public.ticket_discounts (live_performance_id) WHERE live_performance_id IS NOT NULL;

-- RLS mirrors showing_price_tiers: anyone may read an ACTIVE rule (the showing
-- page advertises it and previews it), staff and admins read them all, only
-- admins write. Both the POLICY and the GRANT — a policy without a grant is dead
-- (20260814214233).
ALTER TABLE public.ticket_discounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active ticket discounts" ON public.ticket_discounts;
CREATE POLICY "Anyone can view active ticket discounts"
  ON public.ticket_discounts FOR SELECT
  USING (is_active = true OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));

DROP POLICY IF EXISTS "Admins can insert ticket discounts" ON public.ticket_discounts;
CREATE POLICY "Admins can insert ticket discounts"
  ON public.ticket_discounts FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can update ticket discounts" ON public.ticket_discounts;
CREATE POLICY "Admins can update ticket discounts"
  ON public.ticket_discounts FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can delete ticket discounts" ON public.ticket_discounts;
CREATE POLICY "Admins can delete ticket discounts"
  ON public.ticket_discounts FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON public.ticket_discounts FROM anon, authenticated;
GRANT SELECT ON public.ticket_discounts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_discounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_discounts TO service_role;

DROP TRIGGER IF EXISTS set_ticket_discounts_updated_at ON public.ticket_discounts;
CREATE TRIGGER set_ticket_discounts_updated_at
  BEFORE UPDATE ON public.ticket_discounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Who changed a price rule, and to what, belongs in the audit log with the tiers.
DROP TRIGGER IF EXISTS audit_ticket_discounts ON public.ticket_discounts;
CREATE TRIGGER audit_ticket_discounts
  AFTER INSERT OR UPDATE OR DELETE ON public.ticket_discounts
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

-- ---------------------------------------------------------------------------
-- 2. What a ticket row records
-- ---------------------------------------------------------------------------

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS list_price numeric,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  -- SET NULL, not RESTRICT: deleting a rule must not be blocked by history, and
  -- the money it took off stays on the row either way.
  ADD COLUMN IF NOT EXISTS discount_id uuid REFERENCES public.ticket_discounts(id) ON DELETE SET NULL,
  -- The label as sold, so a receipt reads the same after the rule is renamed or deleted.
  ADD COLUMN IF NOT EXISTS discount_label text;

COMMENT ON COLUMN public.tickets.list_price IS
  'Tier/showing price before any discount. NULL on rows written before discounts existed, where it equals price.';
COMMENT ON COLUMN public.tickets.price IS
  'NET pre-tax price actually charged: list_price - discount_amount.';

CREATE INDEX IF NOT EXISTS tickets_discount_idx ON public.tickets (discount_id) WHERE discount_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. D, in SQL. Twin of applyDiscount in _shared/order_math.ts.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ticket_discount_cents(
  p_type text, p_value numeric, p_min_quantity integer, p_list_cents bigint[]
) RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH priced AS (
    SELECT c FROM unnest(p_list_cents) AS c WHERE c > 0
  ), agg AS (
    SELECT count(*) AS n, COALESCE(SUM(c), 0)::bigint AS total FROM priced
  )
  SELECT CASE
    WHEN agg.n = 0 OR agg.n < GREATEST(1, p_min_quantity) THEN 0
    WHEN p_type = 'percent' THEN
      public.round_half_even_div(ROUND(p_value * 100)::bigint * agg.total, 10000)
    WHEN p_type = 'fixed_per_ticket' THEN
      (SELECT COALESCE(SUM(LEAST(ROUND(p_value * 100)::bigint, c)), 0)::bigint FROM priced)
    WHEN p_type = 'fixed_per_order' THEN
      LEAST(ROUND(p_value * 100)::bigint, agg.total)
    ELSE 0
  END
  FROM agg
$$;
COMMENT ON FUNCTION public.ticket_discount_cents(text, numeric, integer, bigint[]) IS
  'The order-level discount a rule yields for these list prices, in cents; 0 if it does not apply.';

-- ---------------------------------------------------------------------------
-- 4. The row trigger: list price derived, discount bounded, price is net
-- ---------------------------------------------------------------------------
-- Reproduced from 20260921200433 with the discount lines added.

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
  -- a zero-value, zero-tax ticket; neither is a sale at the door, and neither
  -- can carry a discount.
  IF NEW.payment_method IN ('comp', 'film_pass') THEN
    NEW.price := 0;
    NEW.list_price := 0;
    NEW.discount_amount := 0;
    NEW.discount_id := NULL;
    NEW.discount_label := NULL;
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

  NEW.list_price := v_ticket_price;

  -- A discount is only a claim here: no rule named, no discount; and never more
  -- than the ticket costs. Whether the rule is real, open, and met by this order
  -- is not knowable from one row — enforce_ticket_order_totals decides that.
  IF NEW.discount_id IS NULL OR NEW.discount_amount IS NULL OR NEW.discount_amount <= 0 THEN
    NEW.discount_id := NULL;
    NEW.discount_label := NULL;
    NEW.discount_amount := 0;
  ELSE
    NEW.discount_amount := LEAST(ROUND(NEW.discount_amount, 2), ROUND(v_ticket_price, 2));
  END IF;

  NEW.price := v_ticket_price - NEW.discount_amount;
  NEW.tax_rate := v_tax_rate;

  -- This row's share of its order's tax, within a cent of its own 6% — of the
  -- NET price. See 20260921200433 for why this is a bound and not a derivation.
  v_price_cents := ROUND(NEW.price * 100);
  IF NEW.tax_amount IS NULL
     OR ABS(NEW.tax_amount * 100 - v_price_cents * v_tax_rate) > 1 THEN
    NEW.tax_amount := ROUND(public.order_tax_cents(v_price_cents) / 100.0, 2);
  ELSE
    NEW.tax_amount := ROUND(NEW.tax_amount, 2);
  END IF;
  NEW.total_price := ROUND(NEW.price, 2) + NEW.tax_amount;

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
  'Server-side ticket pricing. list_price comes from the tier or showing, never '
  'the inserter; price is list_price less a bounded discount; tax is the row''s '
  'share of its ORDER''s tax. comp and film_pass record $0. The order-level truth '
  'of the discount and the tax is held by enforce_ticket_order_totals.';

-- ---------------------------------------------------------------------------
-- 5. The statement trigger: each order's tax AND discount must be the order's
-- ---------------------------------------------------------------------------
-- Replaces enforce_ticket_order_tax from Ship 1. Its tax check is carried over
-- unchanged; the discount check is new.

CREATE OR REPLACE FUNCTION public.enforce_ticket_order_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o record;
  r public.ticket_discounts%ROWTYPE;
  s public.showings%ROWTYPE;
  v_expected bigint;
BEGIN
  FOR o IN
    SELECT order_token,
           SUM(ROUND(price * 100))::bigint           AS base_cents,
           SUM(ROUND(tax_amount * 100))::bigint      AS tax_cents,
           SUM(ROUND(discount_amount * 100))::bigint AS discount_cents,
           count(DISTINCT discount_id)               AS rule_count,
           count(DISTINCT showing_id)                AS showing_count,
           (array_agg(discount_id) FILTER (WHERE discount_id IS NOT NULL))[1] AS discount_id,
           (array_agg(showing_id))[1]                AS showing_id,
           array_agg(ROUND(list_price * 100)::bigint) AS list_cents
      FROM new_tickets
     WHERE payment_method NOT IN ('comp', 'film_pass')
     GROUP BY order_token
  LOOP
    -- Tax: Square's, on the net subtotal. (Ship 1.)
    IF o.tax_cents <> public.order_tax_cents(o.base_cents) THEN
      RAISE EXCEPTION
        'Order % carries % cents of tax on a % cent subtotal; Square will total it at %.',
        o.order_token, o.tax_cents, o.base_cents, public.order_tax_cents(o.base_cents)
        USING ERRCODE = 'PT422',
              HINT = 'Apportion the order''s tax with apportionOrderTax (_shared/order_math.ts / src/lib/orderMath.ts).';
    END IF;

    CONTINUE WHEN o.discount_id IS NULL;

    IF o.rule_count > 1 OR o.showing_count > 1 THEN
      RAISE EXCEPTION 'Order % mixes discount rules or showings; one rule applies per order.', o.order_token
        USING ERRCODE = 'PT422';
    END IF;

    SELECT * INTO r FROM public.ticket_discounts WHERE id = o.discount_id;
    SELECT * INTO s FROM public.showings WHERE id = o.showing_id;

    IF r.id IS NULL
       OR NOT r.is_active
       OR r.code IS NOT NULL
       OR (r.starts_at IS NOT NULL AND now() <  r.starts_at)
       OR (r.ends_at   IS NOT NULL AND now() >= r.ends_at) THEN
      RAISE EXCEPTION 'That discount is not available right now.'
        USING ERRCODE = 'PT422', DETAIL = 'discount ' || o.discount_id || ' on order ' || o.order_token;
    END IF;

    -- IS NOT DISTINCT FROM would let NULL = NULL through; a rule scoped to a
    -- movie must not match a showing that simply has no movie.
    IF NOT COALESCE(
         r.showing_id = s.id
      OR r.movie_id = s.movie_id
      OR r.event_id = s.event_id
      OR r.live_performance_id = s.live_performance_id, false) THEN
      RAISE EXCEPTION 'That discount does not apply to this showing.'
        USING ERRCODE = 'PT422', DETAIL = 'discount ' || o.discount_id || ' on order ' || o.order_token;
    END IF;

    v_expected := public.ticket_discount_cents(r.type, r.value, r.min_quantity, o.list_cents);
    IF v_expected = 0 THEN
      RAISE EXCEPTION 'That discount needs at least % tickets.', r.min_quantity
        USING ERRCODE = 'PT422', DETAIL = 'order ' || o.order_token;
    END IF;
    IF o.discount_cents <> v_expected THEN
      RAISE EXCEPTION 'Order % takes % cents off; rule % allows exactly %.',
        o.order_token, o.discount_cents, r.id, v_expected
        USING ERRCODE = 'PT422',
              HINT = 'Allocate the discount with applyDiscount (_shared/order_math.ts / src/lib/orderMath.ts).';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;
COMMENT ON FUNCTION public.enforce_ticket_order_totals() IS
  'Refuses an INSERT in which any order''s rows do not sum to Square''s tax on its '
  'net subtotal, or whose discount is not exactly what one valid, open, in-scope '
  'rule allows for that order. One INSERT per order is how every paid path writes.';

DROP TRIGGER IF EXISTS enforce_ticket_order_tax_on_insert ON public.tickets;
DROP TRIGGER IF EXISTS enforce_ticket_order_totals_on_insert ON public.tickets;
CREATE TRIGGER enforce_ticket_order_totals_on_insert
  AFTER INSERT ON public.tickets
  REFERENCING NEW TABLE AS new_tickets
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.enforce_ticket_order_totals();

DROP FUNCTION IF EXISTS public.enforce_ticket_order_tax();
