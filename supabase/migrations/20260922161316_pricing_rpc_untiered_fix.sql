-- Hotfix: price_ticket_order failed on every showing WITHOUT price tiers.
--
-- `v_tiers || ''` — appending the empty tier name of a single-price ticket —
-- resolved to array || array, and '' is not an array literal: "malformed array
-- literal". The harness built every showing with tiers and never took this
-- branch; production is mostly single-price showings, and online checkout on
-- them returned "Could not price this order" from the moment 20260922001849
-- was applied until this. The cast makes the right operand a text element.
--
-- Function body otherwise identical to 20260922001849.

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
      v_tiers := v_tiers || COALESCE(v_tier.tier_name, '')::text;
    ELSE
      IF s.ticket_price IS NULL OR s.ticket_price < 0 THEN
        RAISE EXCEPTION 'This showing has no valid price configured' USING ERRCODE = 'PT400';
      END IF;
      v_list := v_list || ROUND(s.ticket_price * 100)::bigint;
      v_tiers := v_tiers || ''::text;
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
