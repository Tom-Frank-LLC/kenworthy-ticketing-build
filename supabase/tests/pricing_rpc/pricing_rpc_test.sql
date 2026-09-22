\set ON_ERROR_STOP 1
CREATE TABLE public.results (n serial, name text, pass boolean, detail text);
CREATE FUNCTION public.try_sql(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM; END $$;
CREATE FUNCTION public.expect(name text, got text, want_prefix text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.results (name, pass, detail) VALUES (name, got LIKE want_prefix || '%', got) $$;
SELECT set_config('test.authrole', 'service_role', false);
CREATE TABLE public.vectors AS SELECT :'doc'::jsonb AS doc;

-- Turn a list of cents (+ optional tier names) into a showing with tiers and
-- a tickets JSON, so a vector can be quoted through the real function.
CREATE FUNCTION public.mk(p_list bigint[], p_tiers text[] DEFAULT NULL, OUT showing uuid, OUT tickets jsonb)
LANGUAGE plpgsql AS $$
DECLARE i int; tid uuid; nm text; arr jsonb := '[]';
BEGIN
  INSERT INTO public.showings (ticket_price) VALUES (0) RETURNING id INTO showing;
  FOR i IN 1 .. array_length(p_list, 1) LOOP
    nm := COALESCE(p_tiers[i], 'c' || p_list[i]);
    SELECT id INTO tid FROM public.showing_price_tiers WHERE showing_id = showing AND tier_name = nm;
    IF tid IS NULL THEN
      INSERT INTO public.showing_price_tiers (showing_id, tier_name, price) VALUES (showing, nm, p_list[i] / 100.0) RETURNING id INTO tid;
    END IF;
    arr := arr || jsonb_build_object('tier_id', tid);
  END LOOP;
  tickets := arr;
END $$;

-- 1. Square's tax vectors through quote_ticket_order.
DO $$
DECLARE v record; m record; q record;
BEGIN
  FOR v IN SELECT j ->> 'label' AS label, (j ->> 'square_tax_cents')::bigint AS tax, (j ->> 'square_total_cents')::bigint AS total,
                  ARRAY(SELECT jsonb_array_elements_text(j -> 'ticket_net_cents')::bigint) AS list
           FROM jsonb_array_elements((SELECT doc FROM public.vectors) -> 'tax_only') j LOOP
    SELECT * INTO m FROM public.mk(v.list);
    SELECT SUM(ROUND(tax_amount * 100)) t, SUM(ROUND(total_price * 100)) tot, min(order_tax) ot, min(order_total) otot, count(*) n
      INTO q FROM public.quote_ticket_order(m.showing, m.tickets);
    INSERT INTO public.results (name, pass, detail) VALUES ('quote = Square: ' || v.label,
      q.t = v.tax AND q.tot = v.total AND ROUND(q.ot * 100) = v.tax AND ROUND(q.otot * 100) = v.total AND q.n = array_length(v.list, 1),
      'rows ' || q.tot || ' order ' || q.otot || ' Square ' || v.total);
  END LOOP;
END $$;

-- 1b. The same vectors on a SINGLE-PRICE showing (no tiers, tickets are {}).
--     This branch was untested and broke production on 22 Sep 2026: appending
--     the empty tier name resolved to array || array. Every vector with one
--     distinct price runs here too.
DO $$
DECLARE v record; sid uuid; q record; arr jsonb;
BEGIN
  FOR v IN SELECT j ->> 'label' AS label, (j ->> 'square_total_cents')::bigint AS total,
                  ARRAY(SELECT jsonb_array_elements_text(j -> 'ticket_net_cents')::bigint) AS list
           FROM jsonb_array_elements((SELECT doc FROM public.vectors) -> 'tax_only') j LOOP
    CONTINUE WHEN (SELECT count(DISTINCT x) FROM unnest(v.list) x) <> 1;
    INSERT INTO public.showings (ticket_price) VALUES (v.list[1] / 100.0) RETURNING id INTO sid;
    SELECT jsonb_agg('{}'::jsonb) INTO arr FROM unnest(v.list);
    SELECT SUM(ROUND(total_price * 100)) tot, bool_and(tier_id IS NULL AND tier_name IS NULL) untiered INTO q FROM public.quote_ticket_order(sid, arr);
    INSERT INTO public.results (name, pass, detail) VALUES ('untiered quote = Square: ' || v.label, q.tot = v.total AND q.untiered, q.tot || '/' || v.total);
  END LOOP;
END $$;

-- 2. Square's discounted vectors, with the rule on the showing.
DO $$
DECLARE v record; m record; q record;
BEGIN
  FOR v IN SELECT j ->> 'label' AS label, j -> 'rule' AS rule, (j ->> 'square_discount_cents')::bigint AS d,
                  (j ->> 'square_tax_cents')::bigint AS tax, (j ->> 'square_total_cents')::bigint AS total,
                  ARRAY(SELECT jsonb_array_elements_text(j -> 'ticket_list_cents')::bigint) AS list
           FROM jsonb_array_elements((SELECT doc FROM public.vectors) -> 'discounted') j LOOP
    SELECT * INTO m FROM public.mk(v.list);
    INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label)
      VALUES (m.showing, v.rule ->> 'type', (v.rule ->> 'value')::numeric, (v.rule ->> 'min_quantity')::int, 'vec');
    SELECT SUM(ROUND(discount_amount * 100)) d, SUM(ROUND(tax_amount * 100)) t, SUM(ROUND(total_price * 100)) tot,
           bool_and(price = list_price - discount_amount AND price >= 0) ok, min(order_discount) od
      INTO q FROM public.quote_ticket_order(m.showing, m.tickets);
    INSERT INTO public.results (name, pass, detail) VALUES ('quote = Square, discounted: ' || v.label,
      q.d = v.d AND q.t = v.tax AND q.tot = v.total AND q.ok AND ROUND(q.od * 100) = v.d,
      'off ' || q.d || '/' || v.d || ' tax ' || q.t || '/' || v.tax || ' total ' || q.tot || '/' || v.total);
  END LOOP;
END $$;

-- 3. Eligibility, seat-tier override, best rule, fee.
DO $$
DECLARE m record; q record; sid uuid; rid uuid; got text;
BEGIN
  SELECT * INTO m FROM public.mk(ARRAY[900,900,700,700]::bigint[], ARRAY['Adult','Adult','Students','student']);
  INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label, eligible_tiers) VALUES (m.showing, 'percent', 25, 4, 'adults', ARRAY['Adult']);
  SELECT array_agg(ROUND(discount_amount * 100)::int ORDER BY seq) offs, SUM(ROUND(total_price * 100)) tot INTO q FROM public.quote_ticket_order(m.showing, m.tickets);
  INSERT INTO public.results (name, pass, detail) VALUES ('2 Adult + 2 Student, Adult-only 25%: 225,225,0,0 and 2915', q.offs = ARRAY[225,225,0,0] AND q.tot = 2915, q.offs::text || ' ' || q.tot);

  -- best of three rules
  SELECT * INTO m FROM public.mk(ARRAY[900,900,900,900]::bigint[]);
  INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label) VALUES
    (m.showing, 'percent', 25, 4, 'pct'), (m.showing, 'fixed_per_ticket', 2, 4, 'each'), (m.showing, 'fixed_per_order', 10, 4, 'order');
  SELECT min(discount_label) l, min(order_discount) d INTO q FROM public.quote_ticket_order(m.showing, m.tickets);
  INSERT INTO public.results (name, pass, detail) VALUES ('the largest of three rules wins, never their sum', q.l = 'order' AND q.d = 10, q.l || ' ' || q.d);

  -- below the minimum: no discount
  SELECT min(order_discount) d INTO q FROM public.quote_ticket_order(m.showing, m.tickets - 0);
  INSERT INTO public.results (name, pass, detail) VALUES ('three tickets earn nothing from a 4+ rule', q.d = 0, q.d::text);

  -- a seat's own tier overrides the requested tier
  INSERT INTO public.showings (id, ticket_price) VALUES ('00000000-0000-0000-0000-0000000000f1', 5);
  INSERT INTO public.showing_price_tiers (id, showing_id, tier_name, price) VALUES
    ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', 'Front', 20),
    ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f1', 'Back', 8);
  INSERT INTO public.venue_seats (id, seat_row, seat_number) VALUES ('00000000-0000-0000-0000-0000000000f4', 'A', 1);
  INSERT INTO public.seats (id, seat_row, seat_number) VALUES ('00000000-0000-0000-0000-0000000000f5', 'A', 1);
  INSERT INTO public.showing_seat_tiers VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f2');
  SELECT min(list_price) p, (array_agg(tier_id))[1] t INTO q FROM public.quote_ticket_order('00000000-0000-0000-0000-0000000000f1',
    '[{"seat_id":"00000000-0000-0000-0000-0000000000f5","tier_id":"00000000-0000-0000-0000-0000000000f3"}]');
  INSERT INTO public.results (name, pass, detail) VALUES ('a front-row seat cannot be bought at the back-row tier', q.p = 20 AND q.t = '00000000-0000-0000-0000-0000000000f2', q.p::text);

  -- tier from another showing
  got := public.try_sql(format($q$SELECT * FROM public.quote_ticket_order(%L, '[{"tier_id":"00000000-0000-0000-0000-0000000000f3"}]')$q$, m.showing));
  PERFORM public.expect('a tier from another showing is refused', got, 'PT400: Invalid ticket tier');

  -- surcharge on the DISCOUNTED total, and only when the production opted in
  INSERT INTO public.movies (id, title, pass_processing_fee) VALUES ('00000000-0000-0000-0000-0000000000fa', 'Rental', true);
  UPDATE public.showings SET movie_id = '00000000-0000-0000-0000-0000000000fa' WHERE id = m.showing;
  SELECT min(order_total) t, min(order_processing_fee) f, min(order_grand_total) g INTO q FROM public.quote_ticket_order(m.showing, m.tickets, 'online');
  INSERT INTO public.results (name, pass, detail) VALUES ('fee is grossed up on the discounted total (27.56 online → 1.13)', q.t = 27.56 AND q.f = 1.13 AND q.g = 28.69, q.t || ' ' || q.f || ' ' || q.g);
  SELECT min(order_processing_fee) f INTO q FROM public.quote_ticket_order(m.showing, m.tickets, 'none');
  INSERT INTO public.results (name, pass, detail) VALUES ('no fee on a cash sale', q.f = 0, q.f::text);
END $$;

-- 4. Refusals carry the same sentences the TypeScript used.
INSERT INTO public.showings (id, ticket_price, no_ticket_required) VALUES ('00000000-0000-0000-0000-0000000000e1', 0, true);
SELECT public.expect('no-ticket showing', public.try_sql($q$SELECT * FROM public.quote_ticket_order('00000000-0000-0000-0000-0000000000e1', '[{}]')$q$), 'PT409: This showing does not require a ticket.');
INSERT INTO public.showings (id, ticket_price, start_time) VALUES ('00000000-0000-0000-0000-0000000000e2', 8, now() - interval '1 day');
SELECT public.expect('past showing', public.try_sql($q$SELECT * FROM public.quote_ticket_order('00000000-0000-0000-0000-0000000000e2', '[{}]')$q$), 'PT410: This showing has passed.');
INSERT INTO public.showings (id, ticket_price, manually_sold_out, sold_out_message) VALUES ('00000000-0000-0000-0000-0000000000e3', 8, true, 'Booked privately.');
SELECT public.expect('manually sold out, with the admin''s own sentence', public.try_sql($q$SELECT * FROM public.quote_ticket_order('00000000-0000-0000-0000-0000000000e3', '[{}]')$q$), 'PT409: Booked privately.');
INSERT INTO public.showings (id, ticket_price, is_active) VALUES ('00000000-0000-0000-0000-0000000000e4', 8, false);
SELECT public.expect('inactive showing', public.try_sql($q$SELECT * FROM public.quote_ticket_order('00000000-0000-0000-0000-0000000000e4', '[{}]')$q$), 'PT409: This showing is no longer on sale');
SELECT public.expect('no tickets', public.try_sql($q$SELECT * FROM public.quote_ticket_order('00000000-0000-0000-0000-0000000000e3', '[]')$q$), 'PT400: No tickets requested');
SELECT public.expect('unknown showing', public.try_sql($q$SELECT * FROM public.quote_ticket_order('00000000-0000-0000-0000-00000000dead', '[{}]')$q$), 'PT404');

-- 5. create_ticket_order writes what quote says, and passes the tripwire trigger.
DO $$
DECLARE m record; rows int; tot bigint; fee numeric; tok text;
BEGIN
  SELECT * INTO m FROM public.mk(ARRAY[825,825,825,825]::bigint[]);
  INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label) VALUES (m.showing, 'percent', 25, 4, 'quarter');
  SELECT count(*), SUM(ROUND(total_price * 100)), SUM(processing_fee), min(order_token) INTO rows, tot, fee, tok
    FROM public.create_ticket_order(m.showing, m.tickets, 'online', '00000000-0000-0000-0000-000000000001', NULL, 'pending', NULL, 'idem-1', false);
  INSERT INTO public.results (name, pass, detail) VALUES ('create writes 4 pending rows totalling 2623 (25% off 4 x $8.25), one token', rows = 4 AND tot = 2623, rows || ' rows ' || tot);
  INSERT INTO public.results (name, pass, detail)
  SELECT 'the rows are in the table, pending, with the discount recorded',
         count(*) = 4 AND bool_and(status = 'pending' AND discount_id IS NOT NULL AND discount_label = 'quarter' AND checkout_idempotency_key = 'idem-1'), count(*)::text
    FROM public.tickets WHERE order_token = tok;
END $$;

-- 6. Who may create. anon: no. staff: yes, cash. service role: yes.
DO $$
DECLARE m record; got text;
BEGIN
  SELECT * INTO m FROM public.mk(ARRAY[800,800]::bigint[]);
  PERFORM set_config('test.authrole', 'anon', false); PERFORM set_config('test.role', '', false);
  got := public.try_sql(format($q$SELECT * FROM public.create_ticket_order(%L, %L, 'cash', NULL)$q$, m.showing, m.tickets));
  PERFORM public.expect('anonymous cannot create an order', got, '42501');
  PERFORM set_config('test.authrole', 'authenticated', false); PERFORM set_config('test.role', 'staff', false);
  got := public.try_sql(format($q$SELECT * FROM public.create_ticket_order(%L, %L, 'cash', '00000000-0000-0000-0000-000000000002')$q$, m.showing, m.tickets));
  PERFORM public.expect('staff can sell for cash', got, 'ok');
  got := public.try_sql(format($q$SELECT * FROM public.create_ticket_order(%L, %L, 'comp', '00000000-0000-0000-0000-000000000002')$q$, m.showing, m.tickets));
  PERFORM public.expect('comps do not come through this door', got, 'PT400');
  PERFORM set_config('test.authrole', 'service_role', false);
END $$;

-- 7. The policy: a direct paid insert by staff is refused; a comp is not.
GRANT INSERT, SELECT ON public.results TO authenticated; GRANT USAGE ON SEQUENCE public.results_n_seq TO authenticated;
GRANT SELECT, INSERT ON public.tickets TO authenticated; GRANT SELECT ON public.showings, public.showing_price_tiers TO authenticated;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
SET ROLE authenticated; SELECT set_config('test.role', 'staff', false); SELECT set_config('test.authrole', 'authenticated', false);
SELECT public.expect('a staff bundle can no longer insert a paid row directly', public.try_sql($q$
  INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, payment_method, order_token) VALUES ('00000000-0000-0000-0000-0000000000f1', 1, 0, 1, 'cash', 'direct')$q$), '42501');
SELECT public.expect('...but can still issue a comp directly', public.try_sql($q$
  INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, payment_method, order_token) VALUES ('00000000-0000-0000-0000-0000000000f1', 0, 0, 0, 'comp', 'comp-direct')$q$), 'ok');
RESET ROLE;

SELECT n, CASE WHEN pass THEN 'ok  ' ELSE 'FAIL' END AS verdict, name, detail FROM public.results WHERE NOT pass ORDER BY n;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM public.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.results WHERE NOT pass) THEN RAISE EXCEPTION 'pricing_rpc tests failed'; END IF; END $$;
