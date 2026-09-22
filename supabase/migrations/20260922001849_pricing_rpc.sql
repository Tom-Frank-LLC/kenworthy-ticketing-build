-- One pricing function. BRIEF-pricing-rpc.
--
-- Until now the arithmetic that turns "these tickets for this showing" into
-- ticket rows existed three times — Deno, browser, SQL — held together by a
-- shared vector file, a twin-identity test and a trigger that recomputed what
-- the client should have computed. This puts it in one place, here, and gives
-- every writer of a paid ticket row one door:
--
--   quote_ticket_order(showing, tickets, channel)     prices; writes nothing.
--     Callable by anon: the showing page previews with it, so what the page
--     shows IS what will be charged, by construction rather than by discipline.
--
--   create_ticket_order(showing, tickets, ...)        prices, then inserts.
--     Callable by staff (box office) and the service role (online checkout).
--     Returns the rows. Nothing else may insert a paid row: the staff INSERT
--     policy is narrowed below to $0 comps and pass admissions.
--
-- The arithmetic is unchanged from what shipped in #311/#312/#314 and is still
-- pinned to Square's own totals (pricing_vectors.json, via the SQL harness):
-- list price from the tier or showing (a seat's own tier wins); the single best
-- discount, allocated in proportion to list price over the eligible tickets;
-- the ORDER's tax, half-to-even, apportioned cumulatively; the buyer-paid
-- surcharge, when a production opts in, on the discounted total.
--
-- `enforce_ticket_pricing` keeps deriving list_price (defence in depth) and
-- `enforce_ticket_order_totals` stays as a tripwire for this ship; it is removed
-- once every writer is on the function (Ship 2 of the brief).

-- ---------------------------------------------------------------------------
-- 1. Surcharge. Twin of computeProcessingFee (pricing.ts / booking.ts):
--    grossed up so the theatre nets the full amount after Square's cut.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.processing_fee_cents(net_cents bigint, channel text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  -- Square's published rates: online / keyed 2.9% + 30c; in person 2.6% + 10c.
  -- ROUND, not half-even: this mirrors the TypeScript, which rounds the dollar
  -- total to the cent with Math.round, and the fee has no Square-side twin to
  -- reconcile against (it is sent to Square as its own line).
  SELECT CASE
    WHEN channel = 'in_person' THEN ROUND((net_cents + 10) / (1 - 0.026)) - net_cents
    WHEN channel = 'online'    THEN ROUND((net_cents + 30) / (1 - 0.029)) - net_cents
    ELSE 0
  END::bigint
$$;

-- The shape both functions return: one row per ticket, in input order, with
-- the order-level figures repeated on every row (the simplest thing PostgREST
-- can return; callers read them off the first row).
DROP TYPE IF EXISTS public.priced_ticket CASCADE;
CREATE TYPE public.priced_ticket AS (
  seq integer,
  seat_id uuid,
  tier_id uuid,
  tier_name text,
  list_price numeric,
  discount_amount numeric,
  price numeric,
  tax_amount numeric,
  total_price numeric,
  discount_id uuid,
  discount_label text,
  -- order-level, repeated
  order_list_subtotal numeric,
  order_discount numeric,
  order_subtotal numeric,
  order_tax numeric,
  order_total numeric,
  order_processing_fee numeric,
  order_grand_total numeric,
  production_title text,
  production_category text
);

-- ---------------------------------------------------------------------------
-- 2. The pricing itself. Internal: not granted to anyone, called by the two
--    functions below. Raises the same sentences pricing.ts raised.
-- ---------------------------------------------------------------------------
-- p_tickets: JSON array of {seat_id?, tier_id?}, exactly what the browser sends
-- ticket-checkout today. Returns one row per ticket, in input order, plus the
-- order-level figures repeated on every row (simplest thing PostgREST can
-- return; the callers read them off the first row).
CREATE OR REPLACE FUNCTION public.price_ticket_order(
  p_showing_id uuid,
  p_tickets jsonb,
  p_channel text DEFAULT 'online'   -- 'online' | 'in_person' | 'none'
) RETURNS SETOF public.priced_ticket
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s public.showings%ROWTYPE;
  v_title text; v_category text; v_pass_fee boolean := false; v_duration integer;
  v_closes timestamptz;
  n integer;
  i integer;
  t record;
  v_seat_tier uuid;
  v_tier record;
  v_list bigint[] := '{}';
  v_tiers text[] := '{}';
  v_tier_ids uuid[] := '{}';
  v_seat_ids uuid[] := '{}';
  v_paid integer := 0;
  r record;
  best public.ticket_discounts%ROWTYPE;
  v_d bigint;
  v_reducible boolean[] := '{}';
  v_elig_total bigint := 0;
  v_off bigint[] := '{}';
  run_list bigint := 0; run_off bigint := 0; o bigint;
  v_net bigint[] := '{}';
  run_net bigint := 0; run_tax bigint := 0; v_tax bigint[] := '{}'; share bigint;
  v_list_sub bigint := 0; v_disc bigint := 0; v_sub bigint := 0; v_taxsum bigint := 0; v_fee bigint := 0;
BEGIN
  IF p_tickets IS NULL OR jsonb_typeof(p_tickets) <> 'array' OR jsonb_array_length(p_tickets) = 0 THEN
    RAISE EXCEPTION 'No tickets requested' USING ERRCODE = 'PT400';
  END IF;
  n := jsonb_array_length(p_tickets);

  SELECT * INTO s FROM public.showings WHERE id = p_showing_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Showing not found' USING ERRCODE = 'PT404'; END IF;
  IF s.is_active = false THEN RAISE EXCEPTION 'This showing is no longer on sale' USING ERRCODE = 'PT409'; END IF;
  IF s.no_ticket_required THEN RAISE EXCEPTION 'This showing does not require a ticket.' USING ERRCODE = 'PT409'; END IF;

  -- The production: title, category, the surcharge opt-in, a film's runtime.
  IF s.event_id IS NOT NULL THEN
    SELECT title, COALESCE(pass_processing_fee, false) INTO v_title, v_pass_fee FROM public.events WHERE id = s.event_id;
    v_title := COALESCE(v_title, 'Kenworthy event'); v_category := 'Special Events';
  ELSIF s.live_performance_id IS NOT NULL THEN
    SELECT title, COALESCE(pass_processing_fee, false) INTO v_title, v_pass_fee FROM public.live_performances WHERE id = s.live_performance_id;
    v_title := COALESCE(v_title, 'Kenworthy performance'); v_category := 'Live Performances';
  ELSE
    SELECT title, COALESCE(pass_processing_fee, false) INTO v_title, v_pass_fee FROM public.movies WHERE id = s.movie_id;
    v_title := COALESCE(v_title, 'Kenworthy showing'); v_category := 'Films';
  END IF;

  -- You cannot buy a ticket to something that has already happened. Same rule,
  -- same clock, as enforce_showing_not_past.
  IF s.start_time IS NOT NULL THEN
    v_closes := GREATEST(public.showing_ends_at(s), s.start_time + public.door_grace_window());
    IF now() > v_closes THEN RAISE EXCEPTION 'This showing has passed.' USING ERRCODE = 'PT410'; END IF;
  END IF;

  IF s.manually_sold_out THEN
    RAISE EXCEPTION '%', COALESCE(NULLIF(btrim(s.sold_out_message), ''), 'This showing is sold out.') USING ERRCODE = 'PT409';
  END IF;

  -- Pass one: each ticket's tier and list price.
  FOR i IN 0 .. n - 1 LOOP
    t := NULL;
    SELECT NULLIF(p_tickets -> i ->> 'seat_id', '')::uuid AS seat_id,
           NULLIF(p_tickets -> i ->> 'tier_id', '')::uuid AS tier_id INTO t;

    -- A seat's own tier mapping wins over whatever tier was asked for. This is
    -- what stops a buyer claiming a front-row seat at the back-row price.
    v_seat_tier := NULL;
    IF t.seat_id IS NOT NULL THEN
      SELECT sst.tier_id INTO v_seat_tier
      FROM public.showing_seat_tiers sst
      JOIN public.seats se ON se.id = t.seat_id
      JOIN public.venue_seats vs ON vs.seat_row = se.seat_row AND vs.seat_number = se.seat_number
                                AND COALESCE(vs.section, '') = COALESCE(se.section, '')
      WHERE sst.showing_id = p_showing_id AND sst.venue_seat_id = vs.id
      LIMIT 1;
    END IF;
    IF v_seat_tier IS NOT NULL THEN t.tier_id := v_seat_tier; END IF;

    IF t.tier_id IS NOT NULL THEN
      SELECT id, tier_name, price, is_active INTO v_tier
      FROM public.showing_price_tiers WHERE id = t.tier_id AND showing_id = p_showing_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Invalid ticket tier for this showing' USING ERRCODE = 'PT400'; END IF;
      IF v_tier.is_active = false THEN RAISE EXCEPTION 'That ticket tier is no longer on sale' USING ERRCODE = 'PT409'; END IF;
      v_list := v_list || ROUND(v_tier.price * 100)::bigint;
      v_tiers := v_tiers || COALESCE(v_tier.tier_name, '');
    ELSE
      IF s.ticket_price IS NULL OR s.ticket_price < 0 THEN
        RAISE EXCEPTION 'This showing has no valid price configured' USING ERRCODE = 'PT400';
      END IF;
      v_list := v_list || ROUND(s.ticket_price * 100)::bigint;
      v_tiers := v_tiers || '';
    END IF;
    v_tier_ids := v_tier_ids || t.tier_id;
    v_seat_ids := v_seat_ids || t.seat_id;
    IF v_list[i + 1] > 0 THEN v_paid := v_paid + 1; END IF;
  END LOOP;

  -- Pass two: the one best discount. Rules on this showing or its production,
  -- usable now; the largest D wins, ties to the older rule then the lower id.
  v_d := 0;
  FOR r IN
    SELECT d.* FROM public.ticket_discounts d
    WHERE d.is_active AND d.code IS NULL
      AND (d.starts_at IS NULL OR d.starts_at <= now())
      AND (d.ends_at IS NULL OR now() < d.ends_at)
      AND (d.showing_id = p_showing_id
           OR (s.movie_id IS NOT NULL AND d.movie_id = s.movie_id)
           OR (s.event_id IS NOT NULL AND d.event_id = s.event_id)
           OR (s.live_performance_id IS NOT NULL AND d.live_performance_id = s.live_performance_id))
    ORDER BY d.created_at, d.id
  LOOP
    o := public.ticket_discount_cents(r.type, r.value, r.min_quantity, v_list, r.eligible_tiers, v_tiers);
    IF o > v_d THEN v_d := o; best := r; END IF;
  END LOOP;

  -- Allocate D across the eligible tickets, in proportion to list price,
  -- cumulatively so the shares sum to D exactly. A fixed per-ticket amount is
  -- not a share: each eligible ticket loses the same, capped at its price.
  FOR i IN 1 .. n LOOP
    v_reducible := v_reducible || (v_d > 0 AND v_list[i] > 0
      AND (best.eligible_tiers IS NULL OR public.canonical_tier_name(v_tiers[i]) = ANY (best.eligible_tiers)));
    IF v_reducible[i] THEN v_elig_total := v_elig_total + v_list[i]; END IF;
  END LOOP;
  FOR i IN 1 .. n LOOP
    IF NOT v_reducible[i] THEN o := 0;
    ELSIF best.type = 'fixed_per_ticket' THEN o := LEAST(ROUND(best.value * 100)::bigint, v_list[i]);
    ELSE
      run_list := run_list + v_list[i];
      o := public.round_half_even_div(v_d * run_list, v_elig_total) - run_off;
      run_off := run_off + o;
    END IF;
    v_off := v_off || o;
    v_net := v_net || (v_list[i] - o);
  END LOOP;

  -- Pass three: the order's tax on what is left, apportioned cumulatively.
  FOR i IN 1 .. n LOOP
    run_net := run_net + v_net[i];
    share := public.order_tax_cents(run_net) - run_tax;
    run_tax := run_tax + share;
    v_tax := v_tax || share;
  END LOOP;

  SELECT COALESCE(SUM(x), 0) INTO v_list_sub FROM unnest(v_list) x;
  SELECT COALESCE(SUM(x), 0) INTO v_disc FROM unnest(v_off) x;
  v_sub := v_list_sub - v_disc;
  v_taxsum := run_tax;
  -- No surcharge on a standard sale; only a production that opted in, and only
  -- when money moves.
  IF v_pass_fee AND p_channel IN ('online', 'in_person') AND v_sub + v_taxsum > 0 THEN
    v_fee := public.processing_fee_cents(v_sub + v_taxsum, p_channel);
  END IF;

  FOR i IN 1 .. n LOOP
    RETURN NEXT (
      i - 1, v_seat_ids[i], v_tier_ids[i], NULLIF(v_tiers[i], ''),
      v_list[i] / 100.0, v_off[i] / 100.0, v_net[i] / 100.0, v_tax[i] / 100.0, (v_net[i] + v_tax[i]) / 100.0,
      CASE WHEN v_off[i] > 0 THEN best.id END, CASE WHEN v_off[i] > 0 THEN best.label END,
      v_list_sub / 100.0, v_disc / 100.0, v_sub / 100.0, v_taxsum / 100.0, (v_sub + v_taxsum) / 100.0,
      v_fee / 100.0, (v_sub + v_taxsum + v_fee) / 100.0, v_title, v_category
    )::public.priced_ticket;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.price_ticket_order(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. quote: the preview. Anyone may ask what an order would cost.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.quote_ticket_order(
  p_showing_id uuid, p_tickets jsonb, p_channel text DEFAULT 'online'
) RETURNS SETOF public.priced_ticket
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT * FROM public.price_ticket_order(p_showing_id, p_tickets, p_channel)
$$;
-- price_ticket_order's own read of tiers/rules runs as definer, so anon sees the
-- same prices the server will charge — including a rule RLS would hide.
GRANT EXECUTE ON FUNCTION public.quote_ticket_order(uuid, jsonb, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. create: price, then insert, in one statement. The only door for paid rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_ticket_order(
  p_showing_id uuid,
  p_tickets jsonb,
  p_payment_method text,               -- 'online' | 'cash' | 'card'
  p_user_id uuid,
  p_order_token text DEFAULT NULL,
  p_status text DEFAULT 'confirmed',   -- 'pending' for a card sale awaiting its charge
  p_square_payment_id text DEFAULT NULL,
  p_checkout_idempotency_key text DEFAULT NULL,
  p_sms_consent boolean DEFAULT NULL
) RETURNS SETOF public.tickets
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_channel text;
  v_token text := COALESCE(p_order_token, gen_random_uuid()::text);
BEGIN
  -- Comps and pass admissions are $0 and have their own paths; this door is for
  -- money. Staff may sell; the service role sells online. Nobody else.
  IF p_payment_method NOT IN ('online', 'cash', 'card') THEN
    RAISE EXCEPTION 'create_ticket_order takes online, cash or card' USING ERRCODE = 'PT400';
  END IF;
  IF p_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'status must be pending or confirmed' USING ERRCODE = 'PT400';
  END IF;
  IF NOT (auth.role() = 'service_role' OR public.has_role(auth.uid(), 'staff'::app_role)) THEN
    RAISE EXCEPTION 'Staff access required' USING ERRCODE = '42501';
  END IF;
  -- No card was processed for cash, so no surcharge; online is keyed entry.
  v_channel := CASE p_payment_method WHEN 'online' THEN 'online' WHEN 'card' THEN 'in_person' ELSE 'none' END;

  RETURN QUERY
  INSERT INTO public.tickets (
    user_id, showing_id, seat_id, tier_id,
    price, tax_rate, tax_amount, total_price,
    list_price, discount_amount, discount_id, discount_label,
    processing_fee, qr_code, order_token, status, payment_method,
    square_payment_id, checkout_idempotency_key, sms_consent
  )
  SELECT p_user_id, p_showing_id, q.seat_id, q.tier_id,
         q.price, 0.06, q.tax_amount, q.total_price,
         q.list_price, q.discount_amount, q.discount_id, q.discount_label,
         -- The surcharge belongs to the order; it rides on the first row so
         -- refunds can recover it without an orders table.
         CASE WHEN q.seq = 0 THEN q.order_processing_fee ELSE 0 END,
         gen_random_uuid()::text, v_token, p_status, p_payment_method,
         p_square_payment_id, p_checkout_idempotency_key, p_sms_consent
  FROM public.price_ticket_order(p_showing_id, p_tickets, v_channel) q
  ORDER BY q.seq
  RETURNING public.tickets.*;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_ticket_order(uuid, jsonb, text, uuid, text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ticket_order(uuid, jsonb, text, uuid, text, text, text, text, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Direct inserts of paid rows are over. Staff keep $0 comps; hosts keep
--    their existing policy (comps for assigned showings); pass admissions are
--    written by admit_with_film_pass, SECURITY DEFINER.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can sell tickets" ON public.tickets;
CREATE POLICY "Staff can issue comps"
  ON public.tickets FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'staff'::app_role) AND payment_method IN ('comp', 'film_pass'));
COMMENT ON POLICY "Staff can issue comps" ON public.tickets IS
  'Paid rows (online, cash, card) are written only by create_ticket_order. See BRIEF-pricing-rpc.';
