-- Promo codes on ticket purchases. docs/briefs/BRIEF-promo-codes.md.
--
-- ticket_discounts.code has been reserved since 20260921203017 ("NULL means
-- the rule applies automatically; a rule WITH a code is ignored by every
-- automatic path until codes are built"), and the public cannot read coded
-- rules since 20261006225937. This builds the rest:
--
--   1. ticket_discounts: codes are stored upper-case and unique site-wide; a
--      coded rule may have no scope at all (site-wide); `channels` limits a
--      rule to online or the box office; `applies_to` is 'tickets' (passes
--      and concessions may join later by widening its CHECK).
--   2. ticket_discount_limits: any number of usage limits per rule, each
--      counting orders or tickets, in total / per buyer / per showing / per
--      showing day / per buyer per showing.
--   3. tickets.discount_code: what the buyer typed (normalised), kept on the
--      row because the rule can be edited or deleted later.
--   4. price_ticket_order takes p_code and p_buyer. A code that cannot be used
--      is a refusal (PT422) in plain words, never a silent full price. A code
--      that is valid but does not change this order is reported through
--      priced_ticket.promo_status, so the page can say why.
--   5. create_ticket_order takes p_code, passes the buyer for online sales
--      only (at the box office user_id is the staff member, not the patron),
--      and locks a limited rule before writing, so two buyers cannot both take
--      its last use.
--   6. quote_ticket_order_coded: a quote with a code, for the service role
--      (the rate-limited promo-quote edge function) and staff (the POS).
--      quote_ticket_order, which anon calls directly and unthrottled, keeps no
--      code argument: through it, codes could be guessed as fast as PostgREST
--      answers.
--
-- Checked before writing (20 Nov 2026): no rule in either environment has a
-- code (production 1 rule, staging 0), so the new CHECK on `code` and the
-- unique index cannot fail on existing data, and no forgotten coded rule
-- starts applying.
--
-- The price_ticket_order body is 20261006225325's (the effective definition)
-- with the scope, channel, limit and code logic added; the arithmetic below
-- "Allocate D" is unchanged. Every existing caller passes three arguments or
-- named ones, and both new arguments default to NULL, so a call without a
-- code prices exactly as before.

-- ---------------------------------------------------------------------------
-- 1. ticket_discounts
-- ---------------------------------------------------------------------------

ALTER TABLE public.ticket_discounts
  ADD COLUMN IF NOT EXISTS channels text[],
  ADD COLUMN IF NOT EXISTS applies_to text NOT NULL DEFAULT 'tickets';

COMMENT ON COLUMN public.ticket_discounts.code IS
  'Promo code. NULL: the rule applies automatically. Otherwise it applies only when this code is entered. Stored upper-case; unique site-wide.';
COMMENT ON COLUMN public.ticket_discounts.channels IS
  'Where the rule may be used: NULL = everywhere, else a subset of {online, in_person}. A box-office cash sale counts as in_person.';
COMMENT ON COLUMN public.ticket_discounts.applies_to IS
  'What the rule discounts. Only tickets today; passes or concessions join by widening ticket_discounts_applies_to.';

-- Buyers type codes in every case and with stray spaces; the price function
-- compares upper(btrim(input)) with this, so the stored form must be the same.
ALTER TABLE public.ticket_discounts DROP CONSTRAINT IF EXISTS ticket_discounts_code_format;
ALTER TABLE public.ticket_discounts ADD CONSTRAINT ticket_discounts_code_format CHECK (
  code IS NULL OR (code = upper(btrim(code)) AND code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_discounts_code_key
  ON public.ticket_discounts (code) WHERE code IS NOT NULL;

-- A rule had exactly one scope. Now at most one, and none only with a code:
-- an automatic rule with no scope would discount every ticket on the site the
-- moment it was saved, so the table refuses it rather than trusting a form.
ALTER TABLE public.ticket_discounts DROP CONSTRAINT IF EXISTS ticket_discounts_one_scope;
ALTER TABLE public.ticket_discounts DROP CONSTRAINT IF EXISTS ticket_discounts_scope;
ALTER TABLE public.ticket_discounts ADD CONSTRAINT ticket_discounts_scope CHECK (
  num_nonnulls(showing_id, movie_id, event_id, live_performance_id) = 1
  OR (num_nonnulls(showing_id, movie_id, event_id, live_performance_id) = 0 AND code IS NOT NULL)
);

ALTER TABLE public.ticket_discounts DROP CONSTRAINT IF EXISTS ticket_discounts_channels;
ALTER TABLE public.ticket_discounts ADD CONSTRAINT ticket_discounts_channels CHECK (
  channels IS NULL OR (cardinality(channels) >= 1 AND channels <@ ARRAY['online', 'in_person']::text[])
);
ALTER TABLE public.ticket_discounts DROP CONSTRAINT IF EXISTS ticket_discounts_applies_to;
ALTER TABLE public.ticket_discounts ADD CONSTRAINT ticket_discounts_applies_to CHECK (applies_to = 'tickets');

-- ---------------------------------------------------------------------------
-- 2. ticket_discount_limits
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ticket_discount_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_id uuid NOT NULL REFERENCES public.ticket_discounts(id) ON DELETE CASCADE,
  -- What a use is: one order (however many tickets), or one discounted ticket.
  counts text NOT NULL CHECK (counts IN ('orders', 'tickets')),
  -- What the count is measured within. 'day' is the showing's date at the
  -- theatre (America/Los_Angeles), not the purchase date.
  per text NOT NULL CHECK (per IN ('total', 'buyer', 'showing', 'day', 'buyer_showing')),
  max_uses integer NOT NULL CHECK (max_uses >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_discount_limits_one_per_kind UNIQUE (discount_id, counts, per)
);

COMMENT ON TABLE public.ticket_discount_limits IS
  'Usage limits on a ticket discount rule (BRIEF-promo-codes). An order must pass every limit on its rule. Uses are counted from tickets, never stored: rows carrying the rule with discount_amount > 0, except failed ones and pending ones older than the 15-minute checkout hold. Refunds still count. Per-buyer limits count online orders only.';

ALTER TABLE public.ticket_discount_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_discount_limits FROM anon;

DROP POLICY IF EXISTS "Staff read discount limits" ON public.ticket_discount_limits;
CREATE POLICY "Staff read discount limits" ON public.ticket_discount_limits FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));
DROP POLICY IF EXISTS "Admins add discount limits" ON public.ticket_discount_limits;
CREATE POLICY "Admins add discount limits" ON public.ticket_discount_limits FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins change discount limits" ON public.ticket_discount_limits;
CREATE POLICY "Admins change discount limits" ON public.ticket_discount_limits FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins remove discount limits" ON public.ticket_discount_limits;
CREATE POLICY "Admins remove discount limits" ON public.ticket_discount_limits FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS audit_ticket_discount_limits ON public.ticket_discount_limits;
CREATE TRIGGER audit_ticket_discount_limits
  AFTER INSERT OR UPDATE OR DELETE ON public.ticket_discount_limits
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

-- ---------------------------------------------------------------------------
-- 3. tickets.discount_code
-- ---------------------------------------------------------------------------

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS discount_code text;
COMMENT ON COLUMN public.tickets.discount_code IS
  'The promo code this ticket was discounted with, as entered (normalised). NULL for automatic discounts. Kept because the rule can be edited or deleted (discount_id is ON DELETE SET NULL).';

-- ---------------------------------------------------------------------------
-- 4. Counting uses, and the first limit an order would cross
-- ---------------------------------------------------------------------------

-- How many uses a rule has had, within one limit's measure. Not granted to
-- anyone: price_ticket_order (SECURITY DEFINER) is its only caller.
CREATE OR REPLACE FUNCTION public.ticket_discount_uses(
  p_discount_id uuid, p_counts text, p_per text, p_showing_id uuid, p_buyer uuid
) RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN p_counts = 'orders' THEN count(DISTINCT t.order_token) ELSE count(*) END
  FROM public.tickets t
  WHERE t.discount_id = p_discount_id
    AND t.discount_amount > 0
    -- Held, by the rule seats use (ticket-checkout PENDING_HOLD_MS): a failed
    -- charge holds nothing, and neither does a pending row whose checkout died.
    AND t.status <> 'failed'
    AND NOT (t.status = 'pending' AND t.purchased_at < now() - interval '15 minutes')
    AND (p_per NOT IN ('showing', 'buyer_showing') OR t.showing_id = p_showing_id)
    -- At the box office user_id is the staff member who rang the sale, so only
    -- online rows say who the buyer was.
    AND (p_per NOT IN ('buyer', 'buyer_showing') OR (t.user_id = p_buyer AND t.payment_method = 'online'))
    AND (p_per <> 'day' OR t.showing_id IN (
          SELECT o.id FROM public.showings o, public.showings s
          WHERE s.id = p_showing_id
            AND (o.start_time AT TIME ZONE 'America/Los_Angeles')::date
              = (s.start_time AT TIME ZONE 'America/Los_Angeles')::date))
$$;
REVOKE ALL ON FUNCTION public.ticket_discount_uses(uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- The sentence for the first limit this order would cross, or NULL if it
-- crosses none. p_new_tickets is how many tickets this order would discount.
-- A per-buyer limit is skipped when the buyer is unknown (the box office, or a
-- guest's quote before checkout knows who they are); checkout checks it again
-- with the buyer.
CREATE OR REPLACE FUNCTION public.ticket_discount_limit_breach(
  p_discount_id uuid, p_showing_id uuid, p_buyer uuid, p_new_tickets integer
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  l record;
  v_used bigint;
  v_adding bigint;
  v_left bigint;
  v_where text;
BEGIN
  FOR l IN
    SELECT * FROM public.ticket_discount_limits WHERE discount_id = p_discount_id
    ORDER BY CASE per WHEN 'total' THEN 1 WHEN 'day' THEN 2 WHEN 'showing' THEN 3 WHEN 'buyer' THEN 4 ELSE 5 END, counts
  LOOP
    CONTINUE WHEN l.per IN ('buyer', 'buyer_showing') AND p_buyer IS NULL;
    v_used := public.ticket_discount_uses(p_discount_id, l.counts, l.per, p_showing_id, p_buyer);
    -- (Assigned first: inside an IF condition, PL/pgSQL takes a CASE's THEN
    -- as the end of the condition.)
    v_adding := CASE WHEN l.counts = 'orders' THEN 1 ELSE p_new_tickets END;
    IF v_used + v_adding <= l.max_uses THEN
      CONTINUE;
    END IF;
    v_left := GREATEST(l.max_uses - v_used, 0);
    v_where := CASE l.per WHEN 'showing' THEN ' for this showing' WHEN 'day' THEN ' for that day'
                          WHEN 'buyer_showing' THEN ' for this showing' ELSE '' END;
    IF l.per IN ('buyer', 'buyer_showing') THEN
      IF l.counts = 'tickets' AND v_left > 0 THEN
        RETURN format('This promo code allows %s ticket%s per person%s; you have %s left.',
                      l.max_uses, CASE WHEN l.max_uses = 1 THEN '' ELSE 's' END, v_where, v_left);
      END IF;
      RETURN format('You have already used this promo code as many times as it allows%s.', v_where);
    END IF;
    IF l.counts = 'tickets' AND v_left > 0 THEN
      RETURN format('Only %s more ticket%s can use this promo code%s.',
                    v_left, CASE WHEN v_left = 1 THEN '' ELSE 's' END, v_where);
    END IF;
    RETURN format('This promo code has been used up%s.', v_where);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.ticket_discount_limit_breach(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;

-- "N orders, M tickets so far", for the admin screens: the same count the
-- limits enforce, so the number an admin reads is the number a sale is
-- checked against. Counting rows in the browser would also meet PostgREST's
-- silent 1000-row cap. Staff and admins only.
CREATE OR REPLACE FUNCTION public.ticket_discount_usage(p_discount_ids uuid[])
RETURNS TABLE (discount_id uuid, orders bigint, tickets bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (auth.role() = 'service_role'
          OR public.has_role(auth.uid(), 'admin'::app_role)
          OR public.has_role(auth.uid(), 'staff'::app_role)) THEN
    RAISE EXCEPTION 'Staff access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT d.id,
         public.ticket_discount_uses(d.id, 'orders', 'total', NULL, NULL),
         public.ticket_discount_uses(d.id, 'tickets', 'total', NULL, NULL)
  FROM unnest(p_discount_ids) AS d(id);
END;
$$;
REVOKE ALL ON FUNCTION public.ticket_discount_usage(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_discount_usage(uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. price_ticket_order with a code
-- ---------------------------------------------------------------------------

-- What happened to the code, repeated on every row like the order totals.
--   promo_code          the code as matched (upper-case), when one was given
--   promo_status        applied | below_minimum | not_eligible | better_discount
--   promo_min_quantity  the rule's minimum, for "add N more tickets"
ALTER TYPE public.priced_ticket ADD ATTRIBUTE promo_code text;
ALTER TYPE public.priced_ticket ADD ATTRIBUTE promo_status text;
ALTER TYPE public.priced_ticket ADD ATTRIBUTE promo_min_quantity integer;

-- New arguments, so a new signature: the old one must go, or a three-argument
-- call would be ambiguous between them.
DROP FUNCTION IF EXISTS public.price_ticket_order(uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.price_ticket_order(
  p_showing_id uuid,
  p_tickets jsonb,
  p_channel text DEFAULT 'online',   -- 'online' | 'in_person' | 'none'
  p_code text DEFAULT NULL,          -- a promo code as typed, or NULL
  p_buyer uuid DEFAULT NULL          -- the online buyer, for per-buyer limits
) RETURNS SETOF public.priced_ticket
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s public.showings%ROWTYPE;
  v_title text; v_category text; v_pass_fee boolean := false;
  v_ticket_type text;
  v_closes timestamptz;
  v_tiered boolean;
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
  c public.ticket_discounts%ROWTYPE;
  v_d bigint;
  v_k integer;
  v_breach text;
  v_sale_channel text;
  v_code text;
  v_promo_status text;
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

  -- The production: title, category, the surcharge opt-in, how people get in.
  IF s.event_id IS NOT NULL THEN
    SELECT title, COALESCE(pass_processing_fee, false), ticket_type::text
      INTO v_title, v_pass_fee, v_ticket_type FROM public.events WHERE id = s.event_id;
    v_title := COALESCE(v_title, 'Kenworthy event'); v_category := 'Special Events';
  ELSIF s.live_performance_id IS NOT NULL THEN
    SELECT title, COALESCE(pass_processing_fee, false), ticket_type::text
      INTO v_title, v_pass_fee, v_ticket_type FROM public.live_performances WHERE id = s.live_performance_id;
    v_title := COALESCE(v_title, 'Kenworthy performance'); v_category := 'Live Performances';
  ELSE
    SELECT title, COALESCE(pass_processing_fee, false), ticket_type::text
      INTO v_title, v_pass_fee, v_ticket_type FROM public.movies WHERE id = s.movie_id;
    v_title := COALESCE(v_title, 'Kenworthy showing'); v_category := 'Films';
  END IF;

  IF v_ticket_type IN ('rsvp', 'info_only') THEN
    RAISE EXCEPTION 'Tickets for this showing are not sold here.' USING ERRCODE = 'PT409';
  END IF;

  IF s.start_time IS NOT NULL THEN
    v_closes := GREATEST(public.showing_ends_at(s), s.start_time + public.door_grace_window());
    IF now() > v_closes THEN RAISE EXCEPTION 'This showing has passed.' USING ERRCODE = 'PT410'; END IF;
  END IF;

  IF s.manually_sold_out THEN
    RAISE EXCEPTION '%', COALESCE(NULLIF(btrim(s.sold_out_message), ''), 'This showing is sold out.') USING ERRCODE = 'PT409';
  END IF;

  v_tiered := EXISTS (SELECT 1 FROM public.showing_price_tiers
                      WHERE showing_id = p_showing_id AND is_active);

  -- Pass one: each ticket's tier and list price.
  FOR i IN 0 .. n - 1 LOOP
    t := NULL;
    SELECT NULLIF(p_tickets -> i ->> 'seat_id', '')::uuid AS seat_id,
           NULLIF(p_tickets -> i ->> 'tier_id', '')::uuid AS tier_id INTO t;

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
    ELSIF v_tiered THEN
      RAISE EXCEPTION 'Choose a ticket type for each ticket.' USING ERRCODE = 'PT400';
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

  -- Where this sale happens, in a rule's terms. A cash sale prices with
  -- channel 'none' (no surcharge) but it is still at the box office.
  v_sale_channel := CASE WHEN p_channel = 'online' THEN 'online' ELSE 'in_person' END;

  -- Pass two: the one best discount. Automatic rules on this showing or its
  -- production, usable now, here, and within their limits; the largest D
  -- wins, ties to the older rule then the lower id. A rule over a limit is
  -- simply not a candidate: nobody asked for it by name.
  v_d := 0;
  FOR r IN
    SELECT d.* FROM public.ticket_discounts d
    WHERE d.is_active AND d.code IS NULL AND d.applies_to = 'tickets'
      AND (d.starts_at IS NULL OR d.starts_at <= now())
      AND (d.ends_at IS NULL OR now() < d.ends_at)
      AND (d.channels IS NULL OR v_sale_channel = ANY (d.channels))
      AND (d.showing_id = p_showing_id
           OR (s.movie_id IS NOT NULL AND d.movie_id = s.movie_id)
           OR (s.event_id IS NOT NULL AND d.event_id = s.event_id)
           OR (s.live_performance_id IS NOT NULL AND d.live_performance_id = s.live_performance_id))
    ORDER BY d.created_at, d.id
  LOOP
    o := public.ticket_discount_cents(r.type, r.value, r.min_quantity, v_list, r.eligible_tiers, v_tiers);
    IF o > v_d THEN
      SELECT count(*) INTO v_k FROM generate_subscripts(v_list, 1) g(j)
       WHERE v_list[j] > 0 AND (r.eligible_tiers IS NULL OR public.canonical_tier_name(v_tiers[j]) = ANY (r.eligible_tiers));
      IF public.ticket_discount_limit_breach(r.id, p_showing_id, p_buyer, v_k) IS NULL THEN
        v_d := o; best := r;
      END IF;
    END IF;
  END LOOP;

  -- The code, if one was given. Anything that stops it being used is a
  -- refusal in plain words: a buyer who typed a code and was charged full
  -- price without being told is the failure this is built against.
  v_code := upper(btrim(COALESCE(p_code, '')));
  IF v_code <> '' THEN
    SELECT * INTO c FROM public.ticket_discounts WHERE code = v_code;
    IF NOT FOUND OR NOT c.is_active OR c.applies_to <> 'tickets' THEN
      RAISE EXCEPTION 'That promo code isn''t valid.' USING ERRCODE = 'PT422';
    END IF;
    IF c.starts_at IS NOT NULL AND now() < c.starts_at THEN
      RAISE EXCEPTION 'That promo code isn''t active yet.' USING ERRCODE = 'PT422';
    END IF;
    IF c.ends_at IS NOT NULL AND now() >= c.ends_at THEN
      RAISE EXCEPTION 'That promo code has expired.' USING ERRCODE = 'PT422';
    END IF;
    -- COALESCE, not decoration: three of the four scope columns are NULL, so
    -- the OR is NULL rather than false when nothing matches, NOT NULL is NULL,
    -- and IF NULL does not raise. Without it every scoped code worked at
    -- every showing (caught by the harness, promo_codes_test.sql P2).
    IF NOT COALESCE(
         num_nonnulls(c.showing_id, c.movie_id, c.event_id, c.live_performance_id) = 0
         OR c.showing_id = p_showing_id
         OR (s.movie_id IS NOT NULL AND c.movie_id = s.movie_id)
         OR (s.event_id IS NOT NULL AND c.event_id = s.event_id)
         OR (s.live_performance_id IS NOT NULL AND c.live_performance_id = s.live_performance_id),
         false) THEN
      RAISE EXCEPTION 'That promo code can''t be used for this showing.' USING ERRCODE = 'PT422';
    END IF;
    IF c.channels IS NOT NULL AND NOT (v_sale_channel = ANY (c.channels)) THEN
      RAISE EXCEPTION '%', CASE WHEN v_sale_channel = 'online'
                                THEN 'That promo code can only be used at the box office.'
                                ELSE 'That promo code can only be used online.' END
        USING ERRCODE = 'PT422';
    END IF;

    o := public.ticket_discount_cents(c.type, c.value, c.min_quantity, v_list, c.eligible_tiers, v_tiers);
    SELECT count(*) INTO v_k FROM generate_subscripts(v_list, 1) g(j)
     WHERE v_list[j] > 0 AND (c.eligible_tiers IS NULL OR public.canonical_tier_name(v_tiers[j]) = ANY (c.eligible_tiers));
    IF o = 0 THEN
      -- Valid, but it takes nothing off this order. Not a refusal: the buyer
      -- may be one ticket short, and the page says so.
      v_promo_status := CASE WHEN v_paid < GREATEST(1, c.min_quantity) THEN 'below_minimum' ELSE 'not_eligible' END;
    ELSIF o <= v_d THEN
      -- An automatic discount already takes as much or more. One discount per
      -- order (Tom, 19 Nov 2026), and an equal one does not spend a use.
      v_promo_status := 'better_discount';
    ELSE
      v_breach := public.ticket_discount_limit_breach(c.id, p_showing_id, p_buyer, v_k);
      IF v_breach IS NOT NULL THEN
        RAISE EXCEPTION '%', v_breach USING ERRCODE = 'PT422';
      END IF;
      v_d := o; best := c; v_promo_status := 'applied';
    END IF;
  END IF;

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
  IF v_pass_fee AND p_channel IN ('online', 'in_person') AND v_sub + v_taxsum > 0 THEN
    v_fee := public.processing_fee_cents(v_sub + v_taxsum, p_channel);
  END IF;

  FOR i IN 1 .. n LOOP
    RETURN NEXT (
      i - 1, v_seat_ids[i], v_tier_ids[i], NULLIF(v_tiers[i], ''),
      v_list[i] / 100.0, v_off[i] / 100.0, v_net[i] / 100.0, v_tax[i] / 100.0, (v_net[i] + v_tax[i]) / 100.0,
      CASE WHEN v_off[i] > 0 THEN best.id END, CASE WHEN v_off[i] > 0 THEN best.label END,
      v_list_sub / 100.0, v_disc / 100.0, v_sub / 100.0, v_taxsum / 100.0, (v_sub + v_taxsum) / 100.0,
      v_fee / 100.0, (v_sub + v_taxsum + v_fee) / 100.0, v_title, v_category,
      NULLIF(v_code, ''), v_promo_status, CASE WHEN v_code <> '' THEN c.min_quantity END
    )::public.priced_ticket;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.price_ticket_order(uuid, jsonb, text, text, uuid) FROM PUBLIC, anon, authenticated;

-- The public quote: unchanged, and deliberately without a code (header).
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
GRANT EXECUTE ON FUNCTION public.quote_ticket_order(uuid, jsonb, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. A quote with a code: the service role and staff only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.quote_ticket_order_coded(
  p_showing_id uuid,
  p_tickets jsonb,
  p_channel text DEFAULT 'online',
  p_code text DEFAULT NULL,
  p_buyer uuid DEFAULT NULL
) RETURNS SETOF public.priced_ticket
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := auth.role() = 'service_role';
BEGIN
  IF NOT (v_is_service OR public.has_role(auth.uid(), 'staff'::app_role)) THEN
    RAISE EXCEPTION 'Staff access required' USING ERRCODE = '42501';
  END IF;
  -- Only the server knows who an online buyer is; a staff session may not
  -- ask about anyone's usage.
  RETURN QUERY SELECT * FROM public.price_ticket_order(
    p_showing_id, p_tickets, p_channel, p_code, CASE WHEN v_is_service THEN p_buyer END);
END;
$$;
REVOKE ALL ON FUNCTION public.quote_ticket_order_coded(uuid, jsonb, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_ticket_order_coded(uuid, jsonb, text, text, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. create_ticket_order with a code
-- ---------------------------------------------------------------------------
--
-- 20261006225712's body, with p_code added, the buyer passed for online sales,
-- the limited-rule lock, and discount_code written. The comp branch is
-- unchanged.

DROP FUNCTION IF EXISTS public.create_ticket_order(uuid, jsonb, text, uuid, text, text, text, text, boolean, text, text);

CREATE OR REPLACE FUNCTION public.create_ticket_order(
  p_showing_id uuid,
  p_tickets jsonb,
  p_payment_method text,               -- 'online' | 'cash' | 'card' | 'comp'
  p_user_id uuid,
  p_order_token text DEFAULT NULL,
  p_status text DEFAULT 'confirmed',   -- 'pending' for a card sale awaiting its charge
  p_square_payment_id text DEFAULT NULL,
  p_checkout_idempotency_key text DEFAULT NULL,
  p_sms_consent boolean DEFAULT NULL,
  p_comp_recipient_name text DEFAULT NULL,
  p_comp_recipient_email text DEFAULT NULL,
  p_code text DEFAULT NULL
) RETURNS SETOF public.tickets
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_channel text;
  v_token text := COALESCE(p_order_token, gen_random_uuid()::text);
  v_is_service boolean := auth.role() = 'service_role';
  v_caller uuid := auth.uid();
  v_buyer uuid;
  v_rule uuid;
  i integer;
  t record;
BEGIN
  IF p_payment_method NOT IN ('online', 'cash', 'card', 'comp') THEN
    RAISE EXCEPTION 'create_ticket_order takes online, cash, card or comp' USING ERRCODE = 'PT400';
  END IF;
  IF p_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'status must be pending or confirmed' USING ERRCODE = 'PT400';
  END IF;

  IF NOT (
    v_is_service
    OR public.has_role(v_caller, 'staff'::app_role)
    OR (p_payment_method = 'comp' AND public.is_host_of_showing(v_caller, p_showing_id))
  ) THEN
    RAISE EXCEPTION 'Staff access required' USING ERRCODE = '42501';
  END IF;

  -- A signed-in session is a browser, and a browser cannot vouch for a card
  -- (security audit L1, 20261006225712).
  IF NOT v_is_service THEN
    IF p_square_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'A payment id is recorded by the server that read it from Square, not by the browser'
        USING ERRCODE = '42501';
    END IF;
    IF p_payment_method IN ('card', 'online') AND p_status = 'confirmed' THEN
      RAISE EXCEPTION 'A card sale starts pending and is confirmed once Square reports the payment'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_payment_method = 'comp' THEN
    IF p_tickets IS NULL OR jsonb_typeof(p_tickets) <> 'array' OR jsonb_array_length(p_tickets) = 0 THEN
      RAISE EXCEPTION 'No tickets requested' USING ERRCODE = 'PT400';
    END IF;
    IF NULLIF(btrim(COALESCE(p_comp_recipient_name, '')), '') IS NULL THEN
      RAISE EXCEPTION 'A comp needs the name of the person it is for' USING ERRCODE = 'PT400';
    END IF;
    FOR i IN 0 .. jsonb_array_length(p_tickets) - 1 LOOP
      SELECT NULLIF(p_tickets -> i ->> 'seat_id', '')::uuid AS seat_id,
             NULLIF(p_tickets -> i ->> 'tier_id', '')::uuid AS tier_id INTO t;
      IF t.tier_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.showing_price_tiers WHERE id = t.tier_id AND showing_id = p_showing_id) THEN
        RAISE EXCEPTION 'Invalid ticket tier for this showing' USING ERRCODE = 'PT400';
      END IF;
      RETURN QUERY
      INSERT INTO public.tickets (
        user_id, showing_id, seat_id, tier_id,
        price, tax_rate, tax_amount, total_price, processing_fee,
        qr_code, order_token, status, payment_method,
        comp_recipient_name, comp_recipient_email, issued_by_user_id
      ) VALUES (
        p_user_id, p_showing_id, t.seat_id, t.tier_id,
        0, 0, 0, 0, 0,
        'COMP-' || gen_random_uuid()::text, v_token, 'confirmed', 'comp',
        btrim(p_comp_recipient_name), NULLIF(btrim(COALESCE(p_comp_recipient_email, '')), ''),
        COALESCE(v_caller, p_user_id)
      )
      RETURNING public.tickets.*;
    END LOOP;
    RETURN;
  END IF;

  v_channel := CASE p_payment_method WHEN 'online' THEN 'online' WHEN 'card' THEN 'in_person' ELSE 'none' END;
  -- At the box office p_user_id is the staff member ringing the sale, not the
  -- patron, so per-buyer limits are an online check (staff police the counter).
  v_buyer := CASE WHEN p_payment_method = 'online' THEN p_user_id END;

  -- A rule with usage limits is a shared counter. Find the rule this order
  -- would use and lock it, so the next statement prices against every order
  -- that committed while this one waited: two buyers cannot both take the last
  -- use. The INSERT below re-prices from scratch after the lock (READ
  -- COMMITTED: a new snapshot per statement), and refuses if the limit is now
  -- reached.
  SELECT q.discount_id INTO v_rule
    FROM public.price_ticket_order(p_showing_id, p_tickets, v_channel, p_code, v_buyer) q
   WHERE q.discount_id IS NOT NULL
   LIMIT 1;
  IF v_rule IS NOT NULL AND EXISTS (SELECT 1 FROM public.ticket_discount_limits WHERE discount_id = v_rule) THEN
    PERFORM 1 FROM public.ticket_discounts WHERE id = v_rule FOR UPDATE;
  END IF;

  RETURN QUERY
  INSERT INTO public.tickets (
    user_id, showing_id, seat_id, tier_id,
    price, tax_rate, tax_amount, total_price,
    list_price, discount_amount, discount_id, discount_label, discount_code,
    processing_fee, qr_code, order_token, status, payment_method,
    square_payment_id, checkout_idempotency_key, sms_consent
  )
  SELECT p_user_id, p_showing_id, q.seat_id, q.tier_id,
         q.price, 0.06, q.tax_amount, q.total_price,
         q.list_price, q.discount_amount, q.discount_id, q.discount_label,
         CASE WHEN q.discount_id IS NOT NULL AND q.promo_status = 'applied' THEN q.promo_code END,
         CASE WHEN q.seq = 0 THEN q.order_processing_fee ELSE 0 END,
         gen_random_uuid()::text, v_token, p_status, p_payment_method,
         p_square_payment_id, p_checkout_idempotency_key, p_sms_consent
  FROM public.price_ticket_order(p_showing_id, p_tickets, v_channel, p_code, v_buyer) q
  ORDER BY q.seq
  RETURNING public.tickets.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_ticket_order(uuid, jsonb, text, uuid, text, text, text, text, boolean, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ticket_order(uuid, jsonb, text, uuid, text, text, text, text, boolean, text, text, text) TO authenticated, service_role;
