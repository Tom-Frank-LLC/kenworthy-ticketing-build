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
-- Not sold here: a film ticketed through an outside site, and an info-only
-- one, keep their showings (the dates are real) but sell nothing through this
-- door. Same sentence as the showing page. A comp is not a sale and still goes
-- through — the theatre may seat a guest at a film it is hosting but not selling.
INSERT INTO public.movies (id, title, ticket_type, rsvp_url) VALUES ('00000000-0000-0000-0000-0000000000f1', 'Festival Film', 'rsvp', 'https://festival.example/tickets');
INSERT INTO public.showings (id, ticket_price, movie_id) VALUES ('00000000-0000-0000-0000-0000000000e5', 8, '00000000-0000-0000-0000-0000000000f1');
SELECT public.expect('film ticketed elsewhere', public.try_sql($q$SELECT * FROM public.quote_ticket_order('00000000-0000-0000-0000-0000000000e5', '[{}]')$q$), 'PT409: Tickets for this showing are not sold here.');
INSERT INTO public.movies (id, title, ticket_type) VALUES ('00000000-0000-0000-0000-0000000000f2', 'Info Only Film', 'info_only');
INSERT INTO public.showings (id, ticket_price, movie_id) VALUES ('00000000-0000-0000-0000-0000000000e6', 8, '00000000-0000-0000-0000-0000000000f2');
SELECT public.expect('info-only film', public.try_sql($q$SELECT * FROM public.quote_ticket_order('00000000-0000-0000-0000-0000000000e6', '[{}]')$q$), 'PT409: Tickets for this showing are not sold here.');
INSERT INTO public.events (id, title, ticket_type, rsvp_url) VALUES ('00000000-0000-0000-0000-0000000000f3', 'RSVP Event', 'rsvp', 'https://rsvp.example');
INSERT INTO public.showings (id, ticket_price, event_id) VALUES ('00000000-0000-0000-0000-0000000000e7', 8, '00000000-0000-0000-0000-0000000000f3');
SELECT public.expect('RSVP event with a showing row', public.try_sql($q$SELECT * FROM public.quote_ticket_order('00000000-0000-0000-0000-0000000000e7', '[{}]')$q$), 'PT409: Tickets for this showing are not sold here.');
INSERT INTO public.movies (id, title) VALUES ('00000000-0000-0000-0000-0000000000f4', 'Ordinary Film');
INSERT INTO public.showings (id, ticket_price, movie_id) VALUES ('00000000-0000-0000-0000-0000000000e8', 8, '00000000-0000-0000-0000-0000000000f4');
SELECT public.expect('a ticketed film still prices', (SELECT count(*)::text FROM public.quote_ticket_order('00000000-0000-0000-0000-0000000000e8', '[{}]')), '1');
SELECT public.expect('comp at a film ticketed elsewhere', public.try_sql($q$SELECT * FROM public.create_ticket_order('00000000-0000-0000-0000-0000000000e5', '[{}]', 'comp', NULL, 'comp-ext', 'confirmed', NULL, NULL, NULL, 'A Guest', NULL)$q$), 'ok');
SELECT public.expect('cash sale at a film ticketed elsewhere', public.try_sql($q$SELECT * FROM public.create_ticket_order('00000000-0000-0000-0000-0000000000e5', '[{}]', 'cash', NULL)$q$), 'PT409: Tickets for this showing are not sold here.');
SELECT public.expect('no tickets', public.try_sql($q$SELECT * FROM public.quote_ticket_order('00000000-0000-0000-0000-0000000000e3', '[]')$q$), 'PT400: No tickets requested');
SELECT public.expect('unknown showing', public.try_sql($q$SELECT * FROM public.quote_ticket_order('00000000-0000-0000-0000-00000000dead', '[{}]')$q$), 'PT404');

-- 5. create_ticket_order writes what quote says.
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

-- 6b. Comps through the function.
DO $$
DECLARE m record; got text; n int;
BEGIN
  SELECT * INTO m FROM public.mk(ARRAY[900,900]::bigint[]);
  INSERT INTO public.host_assignments VALUES ('00000000-0000-0000-0000-000000000003', m.showing);

  PERFORM set_config('test.authrole', 'authenticated', false); PERFORM set_config('test.role', 'staff', false); PERFORM set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
  got := public.try_sql(format($q$SELECT * FROM public.create_ticket_order(%L, '[{},{}]', 'comp', '00000000-0000-0000-0000-000000000002', 'comp-1', 'confirmed', NULL, NULL, NULL, 'Guest Name', 'guest@example.com')$q$, m.showing));
  PERFORM public.expect('staff can issue comps through the function', got, 'ok');
  SELECT count(*) INTO n FROM public.tickets WHERE order_token = 'comp-1' AND payment_method = 'comp' AND total_price = 0 AND comp_recipient_name = 'Guest Name' AND qr_code LIKE 'COMP-%' AND issued_by_user_id = '00000000-0000-0000-0000-000000000002';
  INSERT INTO public.results (name, pass, detail) VALUES ('...two $0 comp rows, named, COMP- coded, issuer recorded', n = 2, n::text);
  got := public.try_sql(format($q$SELECT * FROM public.create_ticket_order(%L, '[{}]', 'comp', '00000000-0000-0000-0000-000000000002', 'comp-2', 'confirmed', NULL, NULL, NULL, '   ', NULL)$q$, m.showing));
  PERFORM public.expect('a comp needs a recipient name', got, 'PT400');

  -- a host: comps for an assigned showing, nothing else
  PERFORM set_config('test.role', '', false); PERFORM set_config('test.uid', '00000000-0000-0000-0000-000000000003', false);
  got := public.try_sql(format($q$SELECT * FROM public.create_ticket_order(%L, '[{}]', 'comp', '00000000-0000-0000-0000-000000000003', 'comp-host', 'confirmed', NULL, NULL, NULL, 'Host Guest', NULL)$q$, m.showing));
  PERFORM public.expect('a host can comp their own showing', got, 'ok');
  got := public.try_sql(format($q$SELECT * FROM public.create_ticket_order(%L, '[{}]', 'cash', '00000000-0000-0000-0000-000000000003', 'host-cash')$q$, m.showing));
  PERFORM public.expect('...but cannot sell', got, '42501');
  got := public.try_sql($q$SELECT * FROM public.create_ticket_order('00000000-0000-0000-0000-0000000000f1', '[{}]', 'comp', '00000000-0000-0000-0000-000000000003', 'host-other', 'confirmed', NULL, NULL, NULL, 'X', NULL)$q$);
  PERFORM public.expect('...nor comp a showing they are not assigned to', got, '42501');
  PERFORM set_config('test.authrole', 'service_role', false); PERFORM set_config('test.uid', '', false);
END $$;

-- 7. No INSERT policy remains: a direct insert by staff is refused, comp or not.
GRANT INSERT, SELECT ON public.results TO authenticated; GRANT USAGE ON SEQUENCE public.results_n_seq TO authenticated;
GRANT SELECT, INSERT ON public.tickets TO authenticated; GRANT SELECT ON public.showings, public.showing_price_tiers TO authenticated;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
SET ROLE authenticated; SELECT set_config('test.role', 'staff', false); SELECT set_config('test.authrole', 'authenticated', false);
SELECT public.expect('a staff bundle can no longer insert a paid row directly', public.try_sql($q$
  INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, payment_method, order_token) VALUES ('00000000-0000-0000-0000-0000000000f1', 1, 0, 1, 'cash', 'direct')$q$), '42501');
SELECT public.expect('...and neither can a direct comp any more', public.try_sql($q$
  INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, payment_method, order_token) VALUES ('00000000-0000-0000-0000-0000000000f1', 0, 0, 0, 'comp', 'comp-direct')$q$), '42501');
RESET ROLE;

-- 8. ticket_discounts: its own constraints and RLS (moved from the retired
--    ticket_discounts harness; the pricing checks it held are §1–§3 above).
SELECT public.expect('a rule must have exactly one scope', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, movie_id, type, value, label)
  VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000fa', 'percent', 10, 'x')$q$), '23514');
SELECT public.expect('...and cannot have none', public.try_sql($q$
  INSERT INTO public.ticket_discounts (type, value, label) VALUES ('percent', 10, 'x')$q$), '23514');
SELECT public.expect('a percent over 100 is refused', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, type, value, label) VALUES ('00000000-0000-0000-0000-0000000000f1', 'percent', 101, 'x')$q$), '23514');
SELECT public.expect('a window that ends before it starts is refused', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, type, value, label, starts_at, ends_at)
  VALUES ('00000000-0000-0000-0000-0000000000f1', 'percent', 10, 'x', now(), now() - interval '1 hour')$q$), '23514');
SELECT public.expect('an empty eligible list is refused (NULL means every type)', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, type, value, label, eligible_tiers) VALUES ('00000000-0000-0000-0000-0000000000f1', 'percent', 10, 'x', '{}')$q$), '23514');
INSERT INTO public.ticket_discounts (showing_id, type, value, label, is_active) VALUES ('00000000-0000-0000-0000-0000000000f1', 'percent', 10, 'hidden draft', false);
GRANT INSERT, SELECT ON public.results TO anon; GRANT USAGE ON SEQUENCE public.results_n_seq TO anon;
GRANT SELECT ON public.ticket_discounts TO anon; GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_discounts TO authenticated;
SET ROLE anon; SELECT set_config('test.role', '', false);
INSERT INTO public.results (name, pass, detail)
SELECT 'the public reads active rules only', count(*) FILTER (WHERE NOT is_active) = 0 AND count(*) > 0, count(*) || ' visible' FROM public.ticket_discounts;
SELECT public.expect('the public cannot write a rule', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, type, value, label) VALUES ('00000000-0000-0000-0000-0000000000f1', 'percent', 99, 'free money')$q$), '42501');
RESET ROLE;
SET ROLE authenticated; SELECT set_config('test.role', 'staff', false);
INSERT INTO public.results (name, pass, detail)
SELECT 'staff read inactive rules too', count(*) FILTER (WHERE NOT is_active) = 1, '' FROM public.ticket_discounts;
SELECT public.expect('staff cannot write a rule', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, type, value, label) VALUES ('00000000-0000-0000-0000-0000000000f1', 'percent', 99, 'x')$q$), '42501');
SELECT set_config('test.role', 'admin', false);
SELECT public.expect('an admin can', public.try_sql($q$
  INSERT INTO public.ticket_discounts (showing_id, type, value, label) VALUES ('00000000-0000-0000-0000-0000000000f1', 'percent', 5, 'admin made')$q$), 'ok');
RESET ROLE;

-- 9. A tiered showing refuses a ticket that names no tier (20261006225325,
--    audit H2). tier_required_before.sql recorded what the OLD function said
--    for every shape; the new one must say exactly the same, except for the
--    shapes marked `changes`, which priced at the base and are now refused.
SELECT set_config('test.authrole', 'service_role', false);
SELECT set_config('test.role', '', false);
SELECT public.shape_snapshot('after');
INSERT INTO public.results (name, pass, detail)
SELECT 'unchanged: ' || c.label, a.result = b.result AND a.result NOT LIKE 'PT400: Choose%', b.result || '  =>  ' || a.result
FROM public.shape_cases c
JOIN public.shape_results b ON b.label = c.label AND b.phase = 'before'
JOIN public.shape_results a ON a.label = c.label AND a.phase = 'after'
WHERE NOT c.changes;
INSERT INTO public.results (name, pass, detail)
SELECT 'refused now: ' || c.label,
       b.result NOT LIKE 'PT%' AND a.result = 'PT400: Choose a ticket type for each ticket.',
       b.result || '  =>  ' || a.result
FROM public.shape_cases c
JOIN public.shape_results b ON b.label = c.label AND b.phase = 'before'
JOIN public.shape_results a ON a.label = c.label AND a.phase = 'after'
WHERE c.changes;
-- The audit's own numbers, so the "before" really was the hole: four $55/$40
-- seats for $0.00, and a $40 seat for $8.48.
INSERT INTO public.results (name, pass, detail)
SELECT 'before the fix, 4 bare tickets at the base-0 gala cost 0.00', result LIKE '%| 0.00 0.00 0.00 0.00 0.00', result
FROM public.shape_results WHERE label = 'H2: gala base 0, 4 x {}' AND phase = 'before';
INSERT INTO public.results (name, pass, detail)
SELECT 'before the fix, a bare ticket at the base-8 gala cost 8.48', result LIKE '%| 8.00 0.00 0.48 0.00 8.48', result
FROM public.shape_results WHERE label = 'H2: gala base 8, {}' AND phase = 'before';
INSERT INTO public.results (name, pass, detail)
SELECT 'every shape was asked both times', count(*) = 2 * (SELECT count(*) FROM public.shape_cases), count(*)::text
FROM public.shape_results;

-- The doors that write rows, on the same shapes.
DO $$
DECLARE got text; n int;
BEGIN
  -- Box office cash, staff, no tier on a tiered showing: refused.
  PERFORM set_config('test.authrole', 'authenticated', false); PERFORM set_config('test.role', 'staff', false);
  PERFORM set_config('test.uid', '00000000-0000-0000-0000-000000000002', false);
  got := public.try_sql($q$SELECT * FROM public.create_ticket_order('00000000-0000-0000-0000-00000000b009', '[{},{}]', 'cash', '00000000-0000-0000-0000-000000000002', 'h2-cash')$q$);
  PERFORM public.expect('box office cash with no tier on a tiered showing is refused', got, 'PT400: Choose a ticket type');
  SELECT count(*) INTO n FROM public.tickets WHERE order_token = 'h2-cash';
  INSERT INTO public.results (name, pass, detail) VALUES ('...and writes no row', n = 0, n::text);
  -- ...with the tier, it sells.
  got := public.try_sql($q$SELECT * FROM public.create_ticket_order('00000000-0000-0000-0000-00000000b009', '[{"tier_id":"00000000-0000-0000-0000-00000000e902"}]', 'cash', '00000000-0000-0000-0000-000000000002', 'h2-cash-ok')$q$);
  PERFORM public.expect('box office cash naming the tier sells', got, 'ok');
  SELECT count(*) INTO n FROM public.tickets WHERE order_token = 'h2-cash-ok' AND price = 7 AND total_price = 7.42;
  INSERT INTO public.results (name, pass, detail) VALUES ('...at the tier price, $7 + tax', n = 1, n::text);
  -- Box office cash on an untiered showing: unchanged.
  got := public.try_sql($q$SELECT * FROM public.create_ticket_order('00000000-0000-0000-0000-00000000b001', '[{},{}]', 'cash', '00000000-0000-0000-0000-000000000002', 'h2-untiered')$q$);
  PERFORM public.expect('box office cash on an untiered showing still sells', got, 'ok');
  SELECT count(*) INTO n FROM public.tickets WHERE order_token = 'h2-untiered' AND price = 8 AND tier_id IS NULL;
  INSERT INTO public.results (name, pass, detail) VALUES ('...two $8 rows', n = 2, n::text);
  -- A comp names no tier and is not priced: still issued on a tiered showing.
  got := public.try_sql($q$SELECT * FROM public.create_ticket_order('00000000-0000-0000-0000-00000000b007', '[{},{}]', 'comp', '00000000-0000-0000-0000-000000000002', 'h2-comp', 'confirmed', NULL, NULL, NULL, 'Gala Guest', NULL)$q$);
  PERFORM public.expect('a comp with no tier at a tiered showing is still issued', got, 'ok');
  SELECT count(*) INTO n FROM public.tickets WHERE order_token = 'h2-comp' AND total_price = 0;
  INSERT INTO public.results (name, pass, detail) VALUES ('...two $0 comp rows', n = 2, n::text);
  -- Online (ticket-checkout's createTicketOrder, as the service role).
  PERFORM set_config('test.authrole', 'service_role', false); PERFORM set_config('test.role', '', false); PERFORM set_config('test.uid', '', false);
  got := public.try_sql($q$SELECT * FROM public.create_ticket_order('00000000-0000-0000-0000-00000000b007', '[{},{},{},{}]', 'online', NULL, 'h2-online', 'pending')$q$);
  PERFORM public.expect('online with no tier at the gala is refused', got, 'PT400: Choose a ticket type');
  got := public.try_sql($q$SELECT * FROM public.create_ticket_order('00000000-0000-0000-0000-00000000b007', '[{"tier_id":"00000000-0000-0000-0000-00000000e702"}]', 'online', NULL, 'h2-online-ok', 'pending')$q$);
  PERFORM public.expect('online naming the GA tier writes its row', got, 'ok');
  SELECT count(*) INTO n FROM public.tickets WHERE order_token = 'h2-online-ok' AND price = 40 AND total_price = 42.40;
  INSERT INTO public.results (name, pass, detail) VALUES ('...at $40 + tax = $42.40', n = 1, n::text);
END $$;

SELECT n, CASE WHEN pass THEN 'ok  ' ELSE 'FAIL' END AS verdict, name, detail FROM public.results WHERE NOT pass ORDER BY n;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM public.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.results WHERE NOT pass) THEN RAISE EXCEPTION 'pricing_rpc tests failed'; END IF; END $$;
