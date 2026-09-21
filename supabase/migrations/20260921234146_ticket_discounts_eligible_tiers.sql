-- A discount rule can be limited to some ticket types.
--
-- "25% off for 4+, but not on Student/Senior tickets": those are already
-- reduced, and a group rate should not reduce them twice. Decided 21 Sep 2026:
--
--   * `eligible_tiers` NULL means every ticket type. Otherwise it lists the
--     CANONICAL tier names the rule reduces ("Student/Senior", not "students").
--   * Every paid ticket still counts towards `min_quantity`. Two adults and two
--     students have earned a "4+" offer; the students simply are not reduced.
--   * A showing with no tiers has one implicit type, named '' — a rule listing
--     types can only reduce it by listing ''.
--
-- Tier names are free-typed and canonicalised, the same way Square variations
-- are named (`_shared/square-catalog.ts`), so "Students", "student" and
-- "Student" are one type. The SQL table below is a copy of the one in
-- `_shared/order_math.ts`; supabase/tests/ticket_discounts proves the two agree
-- on every entry. Do not add a spelling to one without the other.

ALTER TABLE public.ticket_discounts
  ADD COLUMN IF NOT EXISTS eligible_tiers text[]
    CONSTRAINT ticket_discounts_eligible_tiers_nonempty
    CHECK (eligible_tiers IS NULL OR cardinality(eligible_tiers) >= 1);

COMMENT ON COLUMN public.ticket_discounts.eligible_tiers IS
  'Canonical tier names this rule reduces; NULL = every ticket type. All paid tickets '
  'still count towards min_quantity. '''' is the implicit type of a showing with no tiers.';

CREATE OR REPLACE FUNCTION public.canonical_tier_name(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  t text := regexp_replace(btrim(COALESCE(raw, '')), '\s+', ' ', 'g');
  k text;
BEGIN
  IF t = '' THEN RETURN ''; END IF;
  k := regexp_replace(lower(t), '[.\s]+$', '');
  RETURN CASE k
    WHEN 'ga' THEN 'General Admission'
    WHEN 'g.a.' THEN 'General Admission'
    WHEN 'general admission' THEN 'General Admission'
    WHEN 'general' THEN 'General Admission'
    WHEN 'adult' THEN 'Adult'
    WHEN 'adults' THEN 'Adult'
    WHEN 'child' THEN 'Child'
    WHEN 'children' THEN 'Child'
    WHEN 'kid' THEN 'Child'
    WHEN 'kids' THEN 'Child'
    WHEN 'student' THEN 'Student'
    WHEN 'students' THEN 'Student'
    WHEN 'student/senior' THEN 'Student/Senior'
    WHEN 'student / senior' THEN 'Student/Senior'
    WHEN 'student/seniors' THEN 'Student/Senior'
    WHEN 'senior' THEN 'Senior'
    WHEN 'seniors' THEN 'Senior'
    WHEN 'student/child' THEN 'Student/Child'
    WHEN 'preferred seating' THEN 'Preferred Seating'
    WHEN 'preferred' THEN 'Preferred Seating'
    WHEN 'vip' THEN 'VIP'
    WHEN 'member' THEN 'Member'
    WHEN 'members' THEN 'Member'
    -- Unknown: title-case each word, leave short all-caps words (VIP) alone.
    ELSE (
      SELECT string_agg(
        CASE WHEN length(w) <= 3 AND w = upper(w) THEN w
             ELSE upper(left(w, 1)) || lower(substr(w, 2)) END, ' ')
      FROM unnest(string_to_array(t, ' ')) AS w
    )
  END;
END $$;
COMMENT ON FUNCTION public.canonical_tier_name(text) IS
  'Twin of canonicalTierName in _shared/order_math.ts and canonicalTier in _shared/square-catalog.ts.';

-- D over the eligible tickets only. Twin of applyDiscount in _shared/order_math.ts.
-- `p_list_cents[i]` and `p_tiers[i]` describe ticket i; a NULL p_tiers means
-- every ticket is eligible. The minimum is counted over ALL paid tickets.
CREATE OR REPLACE FUNCTION public.ticket_discount_cents(
  p_type text, p_value numeric, p_min_quantity integer, p_list_cents bigint[],
  p_eligible_tiers text[] DEFAULT NULL, p_tiers text[] DEFAULT NULL
) RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH t AS (
    SELECT c, ord,
           c > 0 AND (p_eligible_tiers IS NULL
                      OR public.canonical_tier_name(COALESCE(p_tiers[ord], '')) = ANY (p_eligible_tiers)) AS reducible
    FROM unnest(p_list_cents) WITH ORDINALITY AS u(c, ord)
  ), agg AS (
    SELECT count(*) FILTER (WHERE c > 0) AS paid,
           COALESCE(SUM(c) FILTER (WHERE reducible), 0)::bigint AS total
    FROM t
  )
  SELECT CASE
    WHEN agg.paid = 0 OR agg.paid < GREATEST(1, p_min_quantity) OR agg.total = 0 THEN 0
    WHEN p_type = 'percent' THEN
      public.round_half_even_div(ROUND(p_value * 100)::bigint * agg.total, 10000)
    WHEN p_type = 'fixed_per_ticket' THEN
      (SELECT COALESCE(SUM(LEAST(ROUND(p_value * 100)::bigint, c)), 0)::bigint FROM t WHERE reducible)
    WHEN p_type = 'fixed_per_order' THEN
      LEAST(ROUND(p_value * 100)::bigint, agg.total)
    ELSE 0
  END
  FROM agg
$$;
DROP FUNCTION IF EXISTS public.ticket_discount_cents(text, numeric, integer, bigint[]);

-- The statement trigger: the same check as before, over eligible tickets, and
-- no discount may sit on an ineligible row.
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
  v_misplaced bigint;
BEGIN
  FOR o IN
    SELECT n.order_token,
           SUM(ROUND(n.price * 100))::bigint           AS base_cents,
           SUM(ROUND(n.tax_amount * 100))::bigint      AS tax_cents,
           SUM(ROUND(n.discount_amount * 100))::bigint AS discount_cents,
           count(DISTINCT n.discount_id)               AS rule_count,
           count(DISTINCT n.showing_id)                AS showing_count,
           (array_agg(n.discount_id) FILTER (WHERE n.discount_id IS NOT NULL))[1] AS discount_id,
           (array_agg(n.showing_id))[1]                AS showing_id,
           array_agg(ROUND(n.list_price * 100)::bigint ORDER BY n.id) AS list_cents,
           array_agg(COALESCE(pt.tier_name, '') ORDER BY n.id)        AS tiers,
           array_agg(ROUND(n.discount_amount * 100)::bigint ORDER BY n.id) AS offs
      FROM new_tickets n
      LEFT JOIN public.showing_price_tiers pt ON pt.id = n.tier_id
     WHERE n.payment_method NOT IN ('comp', 'film_pass')
     GROUP BY n.order_token
  LOOP
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

    IF NOT COALESCE(
         r.showing_id = s.id
      OR r.movie_id = s.movie_id
      OR r.event_id = s.event_id
      OR r.live_performance_id = s.live_performance_id, false) THEN
      RAISE EXCEPTION 'That discount does not apply to this showing.'
        USING ERRCODE = 'PT422', DETAIL = 'discount ' || o.discount_id || ' on order ' || o.order_token;
    END IF;

    -- Money on a ticket type the rule does not reduce.
    IF r.eligible_tiers IS NOT NULL THEN
      SELECT COALESCE(SUM(off), 0) INTO v_misplaced
        FROM unnest(o.offs, o.tiers) AS u(off, tier)
       WHERE off > 0 AND NOT (public.canonical_tier_name(tier) = ANY (r.eligible_tiers));
      IF v_misplaced > 0 THEN
        RAISE EXCEPTION 'That discount does not apply to every ticket type in order %.', o.order_token
          USING ERRCODE = 'PT422';
      END IF;
    END IF;

    v_expected := public.ticket_discount_cents(r.type, r.value, r.min_quantity, o.list_cents, r.eligible_tiers, o.tiers);
    IF v_expected = 0 THEN
      RAISE EXCEPTION 'That discount needs at least % tickets, of a type it applies to.', r.min_quantity
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
