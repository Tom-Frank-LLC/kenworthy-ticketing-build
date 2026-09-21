-- Run by run.sh after BOTH pricing migrations, and after ../order_tax's own test
-- has been replayed under the new trigger (its `results` table is reused here).
\set ON_ERROR_STOP 1

-- What the inserter does: share D across the tickets cumulatively in proportion
-- to list price (or a flat amount per ticket), then apportion tax on the net.
-- A third copy of applyDiscount's allocation, here only so the vectors can be
-- pushed through the real triggers.
CREATE FUNCTION public.sell(p_showing uuid, p_rule uuid, p_token text, p_list bigint[], p_force_off bigint DEFAULT NULL, p_tiers text[] DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  r public.ticket_discounts%ROWTYPE; d bigint := 0; total bigint := 0; i int; tid uuid;
  run_list bigint := 0; run_off bigint := 0; off bigint; run_net bigint := 0; run_tax bigint := 0; share bigint;
BEGIN
  IF p_rule IS NOT NULL THEN
    SELECT * INTO r FROM public.ticket_discounts WHERE id = p_rule;
    d := COALESCE(p_force_off, public.ticket_discount_cents(r.type, r.value, r.min_quantity, p_list, r.eligible_tiers, p_tiers));
  END IF;
  -- The tier a ticket is sold under: the named type, or an ad-hoc price tier.
  CREATE TEMP TABLE tk AS
    SELECT c, ord, COALESCE(p_tiers[ord], 'c' || c) AS tname,
           c > 0 AND (p_rule IS NULL OR r.eligible_tiers IS NULL
                      OR public.canonical_tier_name(COALESCE(p_tiers[ord], '')) = ANY (r.eligible_tiers)) AS reducible
    FROM unnest(p_list) WITH ORDINALITY AS u(c, ord);
  SELECT COALESCE(SUM(c), 0) INTO total FROM tk WHERE reducible;
  INSERT INTO public.showing_price_tiers (showing_id, tier_name, price)
    SELECT DISTINCT p_showing, tname, c / 100.0 FROM tk
    WHERE NOT EXISTS (SELECT 1 FROM public.showing_price_tiers t WHERE t.showing_id = p_showing AND t.tier_name = tk.tname);
  CREATE TEMP TABLE batch (b_tier uuid, b_off numeric, b_tax numeric, b_n int);
  FOR i IN 1 .. array_length(p_list, 1) LOOP
    IF p_rule IS NULL OR d = 0 OR NOT (SELECT reducible FROM tk WHERE ord = i) THEN off := 0;
    ELSIF r.type = 'fixed_per_ticket' AND p_force_off IS NULL THEN off := LEAST(ROUND(r.value * 100)::bigint, p_list[i]);
    ELSE
      run_list := run_list + p_list[i];
      off := public.round_half_even_div(d * run_list, total) - run_off;
      run_off := run_off + off;
    END IF;
    run_net := run_net + p_list[i] - off;
    share := public.order_tax_cents(run_net) - run_tax; run_tax := run_tax + share;
    SELECT id INTO tid FROM public.showing_price_tiers WHERE showing_id = p_showing AND tier_name = (SELECT tname FROM tk WHERE ord = i);
    INSERT INTO batch VALUES (tid, off / 100.0, share / 100.0, i);
  END LOOP;
  BEGIN
    INSERT INTO public.tickets (showing_id, tier_id, price, tax_amount, total_price, order_token, discount_id, discount_amount, discount_label)
      SELECT p_showing, b_tier, 0, b_tax, 0, p_token, CASE WHEN b_off > 0 THEN p_rule END, b_off, 'label' FROM batch ORDER BY b_n;
  EXCEPTION WHEN OTHERS THEN
    DROP TABLE batch; DROP TABLE tk; RETURN SQLSTATE || ': ' || SQLERRM;
  END;
  DROP TABLE batch; DROP TABLE tk; RETURN 'ok';
END $$;

INSERT INTO public.movies (id, title) VALUES ('00000000-0000-0000-0000-00000000aaaa', 'Metropolis'), ('00000000-0000-0000-0000-00000000bbbb', 'Other film');
INSERT INTO public.showings (id, ticket_price, movie_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 9, '00000000-0000-0000-0000-00000000aaaa'),
  ('00000000-0000-0000-0000-0000000000b1', 9, '00000000-0000-0000-0000-00000000bbbb'),
  ('00000000-0000-0000-0000-0000000000c1', 9, NULL);

-- 1. Square's discounted vectors, through the real triggers.
CREATE TABLE public.dvec AS
SELECT v ->> 'label' AS label, v -> 'rule' AS rule,
       (v ->> 'square_discount_cents')::bigint AS sq_d, (v ->> 'square_tax_cents')::bigint AS sq_tax,
       (v ->> 'square_total_cents')::bigint AS sq_total,
       ARRAY(SELECT jsonb_array_elements_text(v -> 'ticket_list_cents')::bigint) AS list
FROM jsonb_array_elements(:'doc'::jsonb -> 'discounted') v;

DO $$
DECLARE v record; sid uuid; rid uuid; verdict text; g record;
BEGIN
  FOR v IN SELECT * FROM public.dvec LOOP
    INSERT INTO public.showings (ticket_price) VALUES (0) RETURNING id INTO sid;
    INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label)
      VALUES (sid, v.rule ->> 'type', (v.rule ->> 'value')::numeric, (v.rule ->> 'min_quantity')::int, 'vec') RETURNING id INTO rid;
    verdict := public.sell(sid, rid, 'dvec-' || v.label, v.list);
    SELECT SUM(ROUND(discount_amount * 100)) d, SUM(ROUND(tax_amount * 100)) t, SUM(ROUND(total_price * 100)) tot,
           bool_and(price = list_price - discount_amount AND price >= 0) consistent
      INTO g FROM public.tickets WHERE order_token = 'dvec-' || v.label;
    INSERT INTO public.results (name, pass, detail) VALUES
      ('Square agrees, discounted: ' || v.label,
       verdict = 'ok' AND g.d = v.sq_d AND g.t = v.sq_tax AND g.tot = v.sq_total AND g.consistent,
       verdict || ' | rows: off ' || g.d || ' tax ' || g.t || ' total ' || g.tot || ' | Square ' || v.sq_d || '/' || v.sq_tax || '/' || v.sq_total);
  END LOOP;
END $$;

-- 2. Refusals. One rule, 25% off 4+, on showing A1.
INSERT INTO public.ticket_discounts (id, showing_id, type, value, min_quantity, label) VALUES
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000a1', 'percent', 25, 4, '25% off 4+');

CREATE FUNCTION public.expect(name text, got text, want_prefix text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.results (name, pass, detail) VALUES (name, got LIKE want_prefix || '%', got) $$;

SELECT public.expect('4 tickets with the rule are accepted',
  public.sell('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001', 'ok-4', ARRAY[900,900,900,900]::bigint[]), 'ok');
SELECT public.expect('3 tickets claiming the 4+ rule are refused',
  public.sell('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001', 'three', ARRAY[900,900,900]::bigint[], 675), 'PT422');
SELECT public.expect('free tickets do not make up the minimum',
  public.sell('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001', 'free-pad', ARRAY[0,900,900,900]::bigint[], 675), 'PT422');
SELECT public.expect('a forged, larger discount is refused',
  public.sell('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001', 'forged-discount', ARRAY[900,900,900,900]::bigint[], 1800), 'PT422');
SELECT public.expect('a smaller-than-entitled discount is refused too (it would not match Square)',
  public.sell('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001', 'short', ARRAY[900,900,900,900]::bigint[], 400), 'PT422');
SELECT public.expect('the rule does not travel to another showing',
  public.sell('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d001', 'wrong-showing', ARRAY[900,900,900,900]::bigint[]), 'PT422');

UPDATE public.ticket_discounts SET is_active = false WHERE id = '00000000-0000-0000-0000-00000000d001';
SELECT public.expect('an inactive rule is refused',
  public.sell('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001', 'inactive', ARRAY[900,900,900,900]::bigint[]), 'PT422');
UPDATE public.ticket_discounts SET is_active = true, starts_at = now() + interval '1 day' WHERE id = '00000000-0000-0000-0000-00000000d001';
SELECT public.expect('a rule whose window has not opened is refused',
  public.sell('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001', 'early', ARRAY[900,900,900,900]::bigint[]), 'PT422');
UPDATE public.ticket_discounts SET starts_at = now() - interval '2 day', ends_at = now() - interval '1 day' WHERE id = '00000000-0000-0000-0000-00000000d001';
SELECT public.expect('a rule whose window has closed is refused',
  public.sell('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001', 'late', ARRAY[900,900,900,900]::bigint[]), 'PT422');
UPDATE public.ticket_discounts SET starts_at = NULL, ends_at = NULL, code = 'FRIENDS' WHERE id = '00000000-0000-0000-0000-00000000d001';
SELECT public.expect('a rule with a promo code never applies automatically',
  public.sell('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d001', 'coded', ARRAY[900,900,900,900]::bigint[]), 'PT422');
UPDATE public.ticket_discounts SET code = NULL WHERE id = '00000000-0000-0000-0000-00000000d001';

INSERT INTO public.results (name, pass, detail)
SELECT 'no refused order left a row behind',
       NOT EXISTS (SELECT 1 FROM public.tickets WHERE order_token IN ('three','free-pad','forged-discount','short','wrong-showing','inactive','early','late','coded')), '';

-- 3. Production scope.
INSERT INTO public.ticket_discounts (id, movie_id, type, value, min_quantity, label) VALUES
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000aaaa', 'fixed_per_order', 10, 4, '$10 off 4+');
SELECT public.expect('a production-wide rule covers a showing of that production',
  public.sell('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d002', 'prod-ok', ARRAY[900,900,900,900]::bigint[]), 'ok');
SELECT public.expect('...and not a showing of another production',
  public.sell('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000d002', 'prod-other', ARRAY[900,900,900,900]::bigint[]), 'PT422');
INSERT INTO public.events (id, title) VALUES ('00000000-0000-0000-0000-00000000eeee', 'Gala');
INSERT INTO public.ticket_discounts (id, event_id, type, value, min_quantity, label) VALUES
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000eeee', 'percent', 50, 1, 'event rule');
SELECT public.expect('NULL = NULL is not a match: an event rule does not cover a showing with no event',
  public.sell('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000d003', 'null-scope', ARRAY[900]::bigint[]), 'PT422');

-- 4. A row that names no rule is sold at full price, whatever else it claims.
INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, order_token, discount_amount)
VALUES ('00000000-0000-0000-0000-0000000000a1', 1, 0, 1, 'no-rule', 5.00);
INSERT INTO public.results (name, pass, detail)
SELECT 'a discount with no rule behind it is ignored', price = 9 AND discount_amount = 0 AND list_price = 9 AND total_price = 9.54,
       price || ' / ' || discount_amount || ' / ' || total_price FROM public.tickets WHERE order_token = 'no-rule';

-- 5. A comp cannot carry a discount.
INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, order_token, payment_method, discount_id, discount_amount)
VALUES ('00000000-0000-0000-0000-0000000000a1', 9, 0, 9, 'comp-disc', 'comp', '00000000-0000-0000-0000-00000000d001', 2.25);
INSERT INTO public.results (name, pass, detail)
SELECT 'a comp drops any discount claim', discount_id IS NULL AND discount_amount = 0 AND total_price = 0, ''
FROM public.tickets WHERE order_token = 'comp-disc';

-- 6. The table's own guard rails.
SELECT public.expect('a rule must have exactly one scope', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, movie_id, type, value, label)
  VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000aaaa', 'percent', 10, 'x')$q$), '23514');
SELECT public.expect('...and cannot have none', public.try_sql($q$
  INSERT INTO public.ticket_discounts (type, value, label) VALUES ('percent', 10, 'x')$q$), '23514');
SELECT public.expect('a percent over 100 is refused', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, type, value, label) VALUES ('00000000-0000-0000-0000-0000000000a1', 'percent', 101, 'x')$q$), '23514');
SELECT public.expect('a window that ends before it starts is refused', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, type, value, label, starts_at, ends_at)
  VALUES ('00000000-0000-0000-0000-0000000000a1', 'percent', 10, 'x', now(), now() - interval '1 hour')$q$), '23514');

-- 6b. Eligible ticket types. Rule: 25% off 4+, Adult only, on showing A1.
INSERT INTO public.ticket_discounts (id, showing_id, type, value, min_quantity, label, eligible_tiers) VALUES
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000a1', 'percent', 25, 4, 'adults 25%', ARRAY['Adult']);

INSERT INTO public.results (name, pass, detail)
SELECT 'canonical_tier_name agrees with the TypeScript table on every spelling',
       public.canonical_tier_name('Students') = 'Student' AND public.canonical_tier_name('student ') = 'Student'
   AND public.canonical_tier_name('GA') = 'General Admission' AND public.canonical_tier_name('Student / Senior') = 'Student/Senior'
   AND public.canonical_tier_name('vip') = 'VIP' AND public.canonical_tier_name('front row') = 'Front Row'
   AND public.canonical_tier_name('') = '' AND public.canonical_tier_name(NULL) = '', '';

SELECT public.expect('2 Adult + 2 Student: the students count towards 4+, only the adults are reduced',
  public.sell('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d005', 'mixed-ok',
              ARRAY[900,900,700,700]::bigint[], NULL, ARRAY['Adult','Adult','Students','student']), 'ok');
INSERT INTO public.results (name, pass, detail)
SELECT '...and the rows say so: 225 + 225 + 0 + 0',
       array_agg(ROUND(discount_amount * 100)::int ORDER BY list_price DESC, id) = ARRAY[225,225,0,0]
       AND SUM(ROUND(discount_amount * 100)) = 450,
       array_agg(ROUND(discount_amount * 100)::int ORDER BY list_price DESC, id)::text
FROM public.tickets WHERE order_token = 'mixed-ok';

SELECT public.expect('4 Students alone are sold at full price under an Adult-only rule',
  public.sell('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000d005', 'students-only',
              ARRAY[700,700,700,700]::bigint[], NULL, ARRAY['Student','Student','Student','Student']), 'ok');
INSERT INTO public.results (name, pass, detail)
SELECT '...with no discount on any row', SUM(discount_amount) = 0 AND bool_and(discount_id IS NULL), ''
FROM public.tickets WHERE order_token = 'students-only';

-- A forged allocation that puts the right total on the wrong tickets.
INSERT INTO public.showing_price_tiers (showing_id, tier_name, price)
  SELECT '00000000-0000-0000-0000-0000000000a1', n, p FROM (VALUES ('Adult', 9.00), ('Student', 7.00)) v(n, p)
  WHERE NOT EXISTS (SELECT 1 FROM public.showing_price_tiers t WHERE t.showing_id = '00000000-0000-0000-0000-0000000000a1' AND t.tier_name = v.n);
INSERT INTO public.results (name, pass, detail)
SELECT 'money on an ineligible ticket type is refused even when the total is right', got LIKE 'PT422%', got
FROM (SELECT public.try_sql($q$
  INSERT INTO public.tickets (showing_id, tier_id, price, tax_amount, total_price, order_token, discount_id, discount_amount)
  SELECT '00000000-0000-0000-0000-0000000000a1', t.id, 0, v.tax, 0, 'misplaced', '00000000-0000-0000-0000-00000000d005', v.off
  FROM (VALUES ('Adult', 2.25, 0.41), ('Adult', 0.00, 0.54), ('Student', 2.25, 0.29), ('Student', 0.00, 0.42)) v(tier, off, tax)
  JOIN public.showing_price_tiers t ON t.showing_id = '00000000-0000-0000-0000-0000000000a1' AND t.tier_name = v.tier$q$) AS got) x;

-- 7. RLS, as PostgREST would run it.
INSERT INTO public.ticket_discounts (id, showing_id, type, value, label, is_active) VALUES
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000b1', 'percent', 10, 'hidden draft', false);
GRANT INSERT, SELECT ON public.results TO anon, authenticated; GRANT USAGE ON SEQUENCE public.results_n_seq TO anon, authenticated;

SET ROLE anon;
INSERT INTO public.results (name, pass, detail)
SELECT 'the public reads active rules only', count(*) FILTER (WHERE NOT is_active) = 0 AND count(*) > 0, count(*) || ' visible' FROM public.ticket_discounts;
SELECT public.expect('the public cannot write a rule', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, type, value, label) VALUES ('00000000-0000-0000-0000-0000000000a1', 'percent', 99, 'free money')$q$), '42501');
RESET ROLE;

SET ROLE authenticated; SELECT set_config('test.role', 'staff', false);
INSERT INTO public.results (name, pass, detail)
SELECT 'staff read inactive rules too', count(*) FILTER (WHERE NOT is_active) = 1, '' FROM public.ticket_discounts;
SELECT public.expect('staff cannot write a rule', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, type, value, label) VALUES ('00000000-0000-0000-0000-0000000000a1', 'percent', 99, 'x')$q$), '42501');
SELECT set_config('test.role', 'admin', false);
SELECT public.expect('an admin can', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, type, value, label) VALUES ('00000000-0000-0000-0000-0000000000a1', 'percent', 5, 'admin made')$q$), 'ok');
RESET ROLE;

SELECT n, CASE WHEN pass THEN 'ok  ' ELSE 'FAIL' END AS verdict, name, detail FROM public.results WHERE n > :first_new ORDER BY n;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM public.results;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.results WHERE NOT pass) THEN RAISE EXCEPTION 'ticket_discounts tests failed'; END IF;
END $$;
