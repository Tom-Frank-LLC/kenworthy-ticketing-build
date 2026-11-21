-- Promo codes (20261120190412, BRIEF-promo-codes). Runs after
-- pricing_rpc_test.sql in the same database, so mk(), try_sql(), expect() and
-- the results table already exist. pricing_rpc_test.sql §9 is the other half:
-- it asks the new price_ticket_order every production shape without a code
-- and requires the old function's answer exactly.
\set ON_ERROR_STOP 1
SELECT set_config('test.authrole', 'service_role', false);
SELECT set_config('test.role', '', false);
SELECT set_config('test.uid', '', false);
CREATE TABLE public.promo_mark AS SELECT COALESCE(max(n), 0) AS before FROM public.results;

-- A single-price showing, the shape most of production has: n x {} at p cents.
CREATE FUNCTION public.mk_untiered(p_cents bigint, p_n int, p_movie uuid DEFAULT NULL, p_start timestamptz DEFAULT now() + interval '7 days',
  OUT showing uuid, OUT tickets jsonb) LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.showings (ticket_price, movie_id, start_time) VALUES (p_cents / 100.0, p_movie, p_start) RETURNING id INTO showing;
  SELECT jsonb_agg('{}'::jsonb) INTO tickets FROM generate_series(1, p_n);
END $$;

-- One line per quote: discount cents, total cents, label, code, status, minimum.
CREATE FUNCTION public.q(p_showing uuid, p_tickets jsonb, p_code text, p_channel text DEFAULT 'online', p_buyer uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT ROUND(min(order_discount) * 100)::int d, SUM(ROUND(total_price * 100))::int tot, min(discount_label) l,
         min(promo_code) c, min(promo_status) st, min(promo_min_quantity) mq
    INTO r FROM public.quote_ticket_order_coded(p_showing, p_tickets, p_channel, p_code, p_buyer);
  RETURN format('%s/%s/%s/%s/%s/%s', r.d, r.tot, COALESCE(r.l, '-'), COALESCE(r.c, '-'), COALESCE(r.st, '-'), COALESCE(r.mq::text, '-'));
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM;
END $$;

-- An online order as ticket-checkout writes it (service role, pending).
CREATE FUNCTION public.buy(p_showing uuid, p_tickets jsonb, p_code text, p_buyer uuid, p_token text, p_method text DEFAULT 'online')
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM * FROM public.create_ticket_order(p_showing, p_tickets, p_method, p_buyer, p_token,
    CASE WHEN p_method = 'online' THEN 'pending' ELSE 'confirmed' END, NULL, NULL, NULL, NULL, NULL, p_code);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- P1. The table
-- ---------------------------------------------------------------------------
INSERT INTO public.movies (id, title) VALUES
  ('00000000-0000-0000-0000-00000000c001', 'Coded Film'),
  ('00000000-0000-0000-0000-00000000c002', 'Other Film');
INSERT INTO public.events (id, title) VALUES ('00000000-0000-0000-0000-00000000c003', 'Coded Event');
INSERT INTO public.live_performances (id, title) VALUES ('00000000-0000-0000-0000-00000000c004', 'Coded Play');

SELECT public.expect('an automatic rule cannot be site-wide', public.try_sql($q$
  INSERT INTO public.ticket_discounts (type, value, label) VALUES ('percent', 10, 'everything')$q$), '23514');
SELECT public.expect('a coded rule can be site-wide', public.try_sql($q$
  INSERT INTO public.ticket_discounts (type, value, label, code) VALUES ('percent', 10, 'Members 10%', 'MEMBERS10')$q$), 'ok');
SELECT public.expect('a coded rule still cannot have two scopes', public.try_sql($q$
  INSERT INTO public.ticket_discounts (movie_id, event_id, type, value, label, code)
  VALUES ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c003', 'percent', 10, 'x', 'TWOSCOPES')$q$), '23514');
SELECT public.expect('a code is stored upper-case', public.try_sql($q$
  INSERT INTO public.ticket_discounts (movie_id, type, value, label, code) VALUES ('00000000-0000-0000-0000-00000000c001', 'percent', 10, 'x', 'lower')$q$), '23514');
SELECT public.expect('...and trimmed', public.try_sql($q$
  INSERT INTO public.ticket_discounts (movie_id, type, value, label, code) VALUES ('00000000-0000-0000-0000-00000000c001', 'percent', 10, 'x', ' SPACED')$q$), '23514');
SELECT public.expect('...and at least three characters', public.try_sql($q$
  INSERT INTO public.ticket_discounts (movie_id, type, value, label, code) VALUES ('00000000-0000-0000-0000-00000000c001', 'percent', 10, 'x', 'AB')$q$), '23514');
SELECT public.expect('a code is unique site-wide', public.try_sql($q$
  INSERT INTO public.ticket_discounts (movie_id, type, value, label, code) VALUES ('00000000-0000-0000-0000-00000000c001', 'percent', 5, 'x', 'MEMBERS10')$q$), '23505');
SELECT public.expect('channels are online and in_person only', public.try_sql($q$
  INSERT INTO public.ticket_discounts (movie_id, type, value, label, channels) VALUES ('00000000-0000-0000-0000-00000000c001', 'percent', 5, 'x', ARRAY['phone'])$q$), '23514');
SELECT public.expect('...and not an empty list', public.try_sql($q$
  INSERT INTO public.ticket_discounts (movie_id, type, value, label, channels) VALUES ('00000000-0000-0000-0000-00000000c001', 'percent', 5, 'x', '{}')$q$), '23514');
SELECT public.expect('only tickets, for now', public.try_sql($q$
  INSERT INTO public.ticket_discounts (movie_id, type, value, label, applies_to) VALUES ('00000000-0000-0000-0000-00000000c001', 'percent', 5, 'x', 'concessions')$q$), '23514');
SELECT public.expect('a limit needs a known measure', public.try_sql($q$
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses)
  SELECT id, 'orders', 'week', 1 FROM public.ticket_discounts WHERE code = 'MEMBERS10'$q$), '23514');
SELECT public.expect('...and at least one use', public.try_sql($q$
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses)
  SELECT id, 'orders', 'total', 0 FROM public.ticket_discounts WHERE code = 'MEMBERS10'$q$), '23514');

-- ---------------------------------------------------------------------------
-- P2. Pricing with a code
-- ---------------------------------------------------------------------------
DO $$
DECLARE m record; m2 record; got text; auto text; coded text;
BEGIN
  -- Untiered (most of production): 2 x $8, 25% off with a code.
  SELECT * INTO m FROM public.mk_untiered(800, 2, '00000000-0000-0000-0000-00000000c001');
  INSERT INTO public.ticket_discounts (movie_id, type, value, min_quantity, label, code)
    VALUES ('00000000-0000-0000-0000-00000000c001', 'percent', 25, 1, 'Quarter off', 'QUARTER25');
  got := public.q(m.showing, m.tickets, '  quarter25 ');
  PERFORM public.expect('untiered: a code typed lower-case with spaces applies 25%: 400 off, 1272', got, '400/1272/Quarter off/QUARTER25/applied/1');
  got := public.q(m.showing, m.tickets, NULL);
  PERFORM public.expect('...and without the code, nothing comes off', got, '0/1696/-/-/-/-');
  got := (SELECT count(*)::text FROM public.quote_ticket_order(m.showing, m.tickets) WHERE discount_id IS NOT NULL);
  PERFORM public.expect('...nor through the public quote, which takes no code', got, '0');

  -- The same rule as a code and as an automatic rule price identically, to
  -- the cent, on the tiered Square vector §5 uses (25% off 4 x $8.25 = 2623).
  SELECT * INTO m FROM public.mk(ARRAY[825,825,825,825]::bigint[]);
  UPDATE public.showings SET movie_id = '00000000-0000-0000-0000-00000000c002' WHERE id = m.showing;
  INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label, code) VALUES (m.showing, 'percent', 25, 4, 'quarter', 'VECTOR25');
  SELECT string_agg(format('%s/%s/%s', discount_amount, tax_amount, total_price), ' ' ORDER BY seq) INTO coded
    FROM public.quote_ticket_order_coded(m.showing, m.tickets, 'online', 'VECTOR25');
  SELECT * INTO m2 FROM public.mk(ARRAY[825,825,825,825]::bigint[]);
  INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label) VALUES (m2.showing, 'percent', 25, 4, 'quarter');
  SELECT string_agg(format('%s/%s/%s', discount_amount, tax_amount, total_price), ' ' ORDER BY seq) INTO auto
    FROM public.quote_ticket_order(m2.showing, m2.tickets);
  INSERT INTO public.results (name, pass, detail) VALUES ('a coded rule prices exactly as the same automatic rule (Square vector 2623)',
    coded = auto AND (SELECT SUM(ROUND(total_price * 100)) FROM public.quote_ticket_order_coded(m.showing, m.tickets, 'online', 'VECTOR25')) = 2623, coded);

  -- One discount per order: a better automatic rule wins, and says so.
  SELECT * INTO m FROM public.mk_untiered(1000, 4);
  INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label) VALUES (m.showing, 'percent', 25, 4, 'Four or more');
  INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label, code) VALUES (m.showing, 'percent', 10, 1, 'Ten off', 'TENOFF');
  got := public.q(m.showing, m.tickets, 'TENOFF');
  PERFORM public.expect('a better automatic discount beats the code, never both', got, '1000/3180/Four or more/TENOFF/better_discount/1');
  -- ...but with 2 tickets the automatic rule does not apply, and the code does.
  got := public.q(m.showing, '[{},{}]', 'TENOFF');
  PERFORM public.expect('...below the automatic minimum, the code applies', got, '200/1908/Ten off/TENOFF/applied/1');
  -- An equal discount does not spend a use.
  INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label, code) VALUES (m.showing, 'percent', 25, 4, 'Equal', 'EQUAL25');
  got := public.q(m.showing, m.tickets, 'EQUAL25');
  PERFORM public.expect('an equal code loses to the automatic rule', got, '1000/3180/Four or more/EQUAL25/better_discount/4');

  -- Valid, but it takes nothing off: told why, not refused.
  SELECT * INTO m FROM public.mk_untiered(800, 2);
  INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label, code) VALUES (m.showing, 'percent', 50, 4, 'Half off 4+', 'HALF4');
  got := public.q(m.showing, m.tickets, 'HALF4');
  PERFORM public.expect('below the code''s minimum: full price, status and minimum reported', got, '0/1696/-/HALF4/below_minimum/4');
  SELECT * INTO m FROM public.mk(ARRAY[700,700]::bigint[], ARRAY['Students','Students']);
  INSERT INTO public.ticket_discounts (showing_id, type, value, min_quantity, label, code, eligible_tiers) VALUES (m.showing, 'percent', 50, 1, 'Adults half', 'ADULTHALF', ARRAY['Adult']);
  got := public.q(m.showing, m.tickets, 'ADULTHALF');
  PERFORM public.expect('no eligible ticket type in the basket: not_eligible', got, '0/1484/-/ADULTHALF/not_eligible/1');

  -- Refusals.
  SELECT * INTO m FROM public.mk_untiered(800, 1, '00000000-0000-0000-0000-00000000c001');
  PERFORM public.expect('an unknown code is refused', public.q(m.showing, m.tickets, 'NOSUCH'), 'PT422: That promo code isn''t valid.');
  INSERT INTO public.ticket_discounts (movie_id, type, value, label, code, is_active) VALUES ('00000000-0000-0000-0000-00000000c001', 'percent', 50, 'off', 'SWITCHEDOFF', false);
  PERFORM public.expect('an inactive code reads as not valid', public.q(m.showing, m.tickets, 'SWITCHEDOFF'), 'PT422: That promo code isn''t valid.');
  INSERT INTO public.ticket_discounts (movie_id, type, value, label, code, starts_at) VALUES ('00000000-0000-0000-0000-00000000c001', 'percent', 50, 'soon', 'SOON', now() + interval '1 day');
  PERFORM public.expect('a code not yet open', public.q(m.showing, m.tickets, 'SOON'), 'PT422: That promo code isn''t active yet.');
  INSERT INTO public.ticket_discounts (movie_id, type, value, label, code, starts_at, ends_at) VALUES ('00000000-0000-0000-0000-00000000c001', 'percent', 50, 'gone', 'GONE', now() - interval '2 days', now() - interval '1 day');
  PERFORM public.expect('an expired code', public.q(m.showing, m.tickets, 'GONE'), 'PT422: That promo code has expired.');
  SELECT * INTO m2 FROM public.mk_untiered(800, 1, '00000000-0000-0000-0000-00000000c002');
  PERFORM public.expect('a film''s code at another film', public.q(m2.showing, m2.tickets, 'QUARTER25'), 'PT422: That promo code can''t be used for this showing.');

  -- Site-wide: a film, an event and a live performance.
  PERFORM public.expect('site-wide code at a film', public.q(m2.showing, m2.tickets, 'members10'), '80/763/Members 10%/MEMBERS10/applied/1');
  INSERT INTO public.showings (id, ticket_price, event_id) VALUES ('00000000-0000-0000-0000-00000000c013', 20, '00000000-0000-0000-0000-00000000c003');
  PERFORM public.expect('...at an event', public.q('00000000-0000-0000-0000-00000000c013', '[{}]', 'MEMBERS10'), '200/1908/Members 10%/MEMBERS10/applied/1');
  INSERT INTO public.showings (id, ticket_price, live_performance_id) VALUES ('00000000-0000-0000-0000-00000000c014', 15, '00000000-0000-0000-0000-00000000c004');
  PERFORM public.expect('...at a live performance', public.q('00000000-0000-0000-0000-00000000c014', '[{}]', 'MEMBERS10'), '150/1431/Members 10%/MEMBERS10/applied/1');

  -- Channels. A cash sale prices as 'none' and counts as the box office.
  INSERT INTO public.ticket_discounts (type, value, label, code, channels) VALUES ('percent', 10, 'Web only', 'WEBONLY', ARRAY['online']);
  INSERT INTO public.ticket_discounts (type, value, label, code, channels) VALUES ('percent', 10, 'Counter only', 'COUNTER', ARRAY['in_person']);
  PERFORM public.expect('an online-only code online', public.q(m2.showing, m2.tickets, 'WEBONLY'), '80/763/Web only/WEBONLY/applied/1');
  PERFORM public.expect('...refused at the box office', public.q(m2.showing, m2.tickets, 'WEBONLY', 'in_person'), 'PT422: That promo code can only be used online.');
  PERFORM public.expect('a box-office-only code refused online', public.q(m2.showing, m2.tickets, 'COUNTER'), 'PT422: That promo code can only be used at the box office.');
  PERFORM public.expect('...accepted for a card sale at the counter', public.q(m2.showing, m2.tickets, 'COUNTER', 'in_person'), '80/763/Counter only/COUNTER/applied/1');
  PERFORM public.expect('...and for cash, which prices as none', public.q(m2.showing, m2.tickets, 'COUNTER', 'none'), '80/763/Counter only/COUNTER/applied/1');
  -- An automatic rule can be channel-limited too.
  SELECT * INTO m FROM public.mk_untiered(1000, 1);
  INSERT INTO public.ticket_discounts (showing_id, type, value, label, channels) VALUES (m.showing, 'fixed_per_order', 2, 'Counter deal', ARRAY['in_person']);
  PERFORM public.expect('an automatic counter-only rule does not apply online', public.q(m.showing, m.tickets, NULL), '0/1060/-/-/-/-');
  PERFORM public.expect('...and does at the counter', public.q(m.showing, m.tickets, NULL, 'none'), '200/848/Counter deal/-/-/-');
END $$;

-- ---------------------------------------------------------------------------
-- P3. Usage limits, through create_ticket_order as checkout and the POS call it
-- ---------------------------------------------------------------------------
DO $$
DECLARE m record; m2 record; got text; rid uuid; n int;
  u1 uuid := '00000000-0000-0000-0000-0000000000b1';
  u2 uuid := '00000000-0000-0000-0000-0000000000b2';
  staff uuid := '00000000-0000-0000-0000-0000000000b9';
BEGIN
  -- Total orders: one use, everywhere.
  SELECT * INTO m FROM public.mk_untiered(800, 2);
  INSERT INTO public.ticket_discounts (showing_id, type, value, label, code) VALUES (m.showing, 'percent', 50, 'Once', 'ONCEONLY') RETURNING id INTO rid;
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses) VALUES (rid, 'orders', 'total', 1);
  PERFORM public.expect('total 1 order: the first order uses it', public.buy(m.showing, m.tickets, 'ONCEONLY', u1, 'once-1'), 'ok');
  SELECT count(*) INTO n FROM public.tickets WHERE order_token = 'once-1' AND discount_id = rid AND discount_code = 'ONCEONLY' AND discount_amount = 4;
  INSERT INTO public.results (name, pass, detail) VALUES ('...its rows carry the rule and the code as entered', n = 2, n::text);
  PERFORM public.expect('...the second is refused', public.buy(m.showing, m.tickets, 'onceonly', u2, 'once-2'), 'PT422: This promo code has been used up.');
  PERFORM public.expect('...and a quote says so before checkout', public.q(m.showing, m.tickets, 'ONCEONLY'), 'PT422: This promo code has been used up.');
  -- A failed charge gives the use back; a refund does not.
  UPDATE public.tickets SET status = 'failed' WHERE order_token = 'once-1';
  PERFORM public.expect('a failed order holds no use', public.q(m.showing, m.tickets, 'ONCEONLY'), '800/848/Once/ONCEONLY/applied/1');
  UPDATE public.tickets SET status = 'refunded' WHERE order_token = 'once-1';
  PERFORM public.expect('a refunded order still counts', public.q(m.showing, m.tickets, 'ONCEONLY'), 'PT422: This promo code has been used up.');
  -- An abandoned pending checkout holds it for 15 minutes, then lets go.
  UPDATE public.tickets SET status = 'pending', purchased_at = now() - interval '5 minutes' WHERE order_token = 'once-1';
  PERFORM public.expect('a live pending order holds the use', public.q(m.showing, m.tickets, 'ONCEONLY'), 'PT422: This promo code has been used up.');
  UPDATE public.tickets SET purchased_at = now() - interval '20 minutes' WHERE order_token = 'once-1';
  PERFORM public.expect('...an abandoned one does not', public.q(m.showing, m.tickets, 'ONCEONLY'), '800/848/Once/ONCEONLY/applied/1');

  -- Total tickets: three discounted tickets, ever.
  SELECT * INTO m FROM public.mk_untiered(800, 2);
  INSERT INTO public.ticket_discounts (showing_id, type, value, label, code) VALUES (m.showing, 'fixed_per_ticket', 1, 'Dollar off', 'THREETIX') RETURNING id INTO rid;
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses) VALUES (rid, 'tickets', 'total', 3);
  PERFORM public.expect('total 3 tickets: 2 now', public.buy(m.showing, m.tickets, 'THREETIX', u1, 'tix-1'), 'ok');
  PERFORM public.expect('...2 more is refused, with what is left', public.buy(m.showing, m.tickets, 'THREETIX', u2, 'tix-2'), 'PT422: Only 1 more ticket can use this promo code.');
  PERFORM public.expect('...1 more is fine', public.buy(m.showing, '[{}]', 'THREETIX', u2, 'tix-3'), 'ok');
  -- Only discounted tickets count: a full-price ticket bought alongside is not a use.
  SELECT * INTO m FROM public.mk(ARRAY[900,700]::bigint[], ARRAY['Adult','Students']);
  INSERT INTO public.ticket_discounts (showing_id, type, value, label, code, eligible_tiers) VALUES (m.showing, 'fixed_per_ticket', 1, 'Adult dollar', 'ADULTONE', ARRAY['Adult']) RETURNING id INTO rid;
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses) VALUES (rid, 'tickets', 'total', 1);
  PERFORM public.expect('an Adult + Student order uses one ticket of a 1-ticket limit', public.buy(m.showing, m.tickets, 'ADULTONE', u1, 'adult-1'), 'ok');
  SELECT count(*) INTO n FROM public.tickets WHERE order_token = 'adult-1' AND discount_id = rid;
  INSERT INTO public.results (name, pass, detail) VALUES ('...only the Adult row carries the rule', n = 1, n::text);

  -- Per buyer: online buyers are counted; box-office sales are not theirs.
  SELECT * INTO m FROM public.mk_untiered(800, 1);
  INSERT INTO public.ticket_discounts (showing_id, type, value, label, code) VALUES (m.showing, 'percent', 50, 'Once each', 'ONCEEACH') RETURNING id INTO rid;
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses) VALUES (rid, 'orders', 'buyer', 1);
  PERFORM public.expect('per buyer 1 order: buyer 1 uses it', public.buy(m.showing, m.tickets, 'ONCEEACH', u1, 'each-1'), 'ok');
  PERFORM public.expect('...buyer 1 again is refused', public.buy(m.showing, m.tickets, 'ONCEEACH', u1, 'each-2'), 'PT422: You have already used this promo code as many times as it allows.');
  PERFORM public.expect('...buyer 2 is fine', public.buy(m.showing, m.tickets, 'ONCEEACH', u2, 'each-3'), 'ok');
  PERFORM public.expect('...a guest quote (no buyer yet) is not refused; checkout checks', public.q(m.showing, m.tickets, 'ONCEEACH'), '400/424/Once each/ONCEEACH/applied/1');
  -- The box office: user_id is the staff member. Two counter sales by the same
  -- staff member are not one buyer using it twice.
  PERFORM set_config('test.authrole', 'authenticated', false); PERFORM set_config('test.role', 'staff', false); PERFORM set_config('test.uid', staff::text, false);
  PERFORM public.expect('a counter cash sale with a per-buyer code', public.buy(m.showing, m.tickets, 'ONCEEACH', staff, 'each-pos-1', 'cash'), 'ok');
  PERFORM public.expect('...and a second by the same staff member', public.buy(m.showing, m.tickets, 'ONCEEACH', staff, 'each-pos-2', 'cash'), 'ok');
  PERFORM set_config('test.authrole', 'service_role', false); PERFORM set_config('test.role', '', false); PERFORM set_config('test.uid', '', false);
  PERFORM public.expect('...nor do they count against that person buying online', public.buy(m.showing, m.tickets, 'ONCEEACH', staff, 'each-4'), 'ok');

  -- Per showing: used up at one showing, still good at the next.
  SELECT * INTO m FROM public.mk_untiered(800, 2, '00000000-0000-0000-0000-00000000c002');
  SELECT * INTO m2 FROM public.mk_untiered(800, 2, '00000000-0000-0000-0000-00000000c002');
  INSERT INTO public.ticket_discounts (movie_id, type, value, label, code) VALUES ('00000000-0000-0000-0000-00000000c002', 'percent', 50, 'Two a show', 'TWOASHOW') RETURNING id INTO rid;
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses) VALUES (rid, 'tickets', 'showing', 2);
  PERFORM public.expect('per showing 2 tickets: 2 at the first showing', public.buy(m.showing, m.tickets, 'TWOASHOW', u1, 'show-1'), 'ok');
  PERFORM public.expect('...none left there', public.buy(m.showing, '[{}]', 'TWOASHOW', u2, 'show-2'), 'PT422: This promo code has been used up for this showing.');
  PERFORM public.expect('...the next showing has its own two', public.buy(m2.showing, m2.tickets, 'TWOASHOW', u2, 'show-3'), 'ok');

  -- Per day, by the theatre's date: 6pm and 9:30pm Pacific are one day even
  -- though 9:30pm is the next day in UTC.
  SELECT * INTO m FROM public.mk_untiered(800, 1, NULL, '2030-01-10 18:00:00-08');
  SELECT * INTO m2 FROM public.mk_untiered(800, 1, NULL, '2030-01-10 21:30:00-08');
  INSERT INTO public.ticket_discounts (type, value, label, code) VALUES ('percent', 50, 'One a day', 'ONEADAY') RETURNING id INTO rid;
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses) VALUES (rid, 'orders', 'day', 1);
  PERFORM public.expect('per day 1 order: the 6pm show', public.buy(m.showing, m.tickets, 'ONEADAY', u1, 'day-1'), 'ok');
  PERFORM public.expect('...the 9:30pm show the same Pacific day is refused', public.buy(m2.showing, m2.tickets, 'ONEADAY', u2, 'day-2'), 'PT422: This promo code has been used up for that day.');
  SELECT * INTO m2 FROM public.mk_untiered(800, 1, NULL, '2030-01-11 18:00:00-08');
  PERFORM public.expect('...the next day is fine', public.buy(m2.showing, m2.tickets, 'ONEADAY', u2, 'day-3'), 'ok');

  -- Per buyer per showing, in tickets, with what is left.
  SELECT * INTO m FROM public.mk_untiered(800, 3);
  INSERT INTO public.ticket_discounts (showing_id, type, value, label, code) VALUES (m.showing, 'percent', 20, 'Pair', 'PAIRPER') RETURNING id INTO rid;
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses) VALUES (rid, 'tickets', 'buyer_showing', 2);
  PERFORM public.expect('2 tickets per person per showing: 3 is refused', public.buy(m.showing, m.tickets, 'PAIRPER', u1, 'pair-1'), 'PT422: This promo code allows 2 tickets per person for this showing; you have 2 left.');
  PERFORM public.expect('...2 is fine', public.buy(m.showing, '[{},{}]', 'PAIRPER', u1, 'pair-2'), 'ok');

  -- Two limits on one rule: the order must pass both.
  SELECT * INTO m FROM public.mk_untiered(800, 1);
  INSERT INTO public.ticket_discounts (showing_id, type, value, label, code) VALUES (m.showing, 'percent', 50, 'Both', 'BOTHLIMITS') RETURNING id INTO rid;
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses) VALUES (rid, 'orders', 'total', 10), (rid, 'orders', 'buyer', 1);
  PERFORM public.expect('two limits: the first order passes both', public.buy(m.showing, m.tickets, 'BOTHLIMITS', u1, 'both-1'), 'ok');
  PERFORM public.expect('...the total has room, the per-buyer does not', public.buy(m.showing, m.tickets, 'BOTHLIMITS', u1, 'both-2'), 'PT422: You have already used this promo code as many times as it allows.');

  -- An automatic rule with a limit: over it, the order is priced without it,
  -- not refused. Nobody asked for it by name.
  SELECT * INTO m FROM public.mk_untiered(1000, 1);
  INSERT INTO public.ticket_discounts (showing_id, type, value, label) VALUES (m.showing, 'fixed_per_order', 3, 'First buyer') RETURNING id INTO rid;
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses) VALUES (rid, 'orders', 'total', 1);
  PERFORM public.expect('a limited automatic rule: the first order gets it', public.buy(m.showing, m.tickets, NULL, u1, 'auto-1'), 'ok');
  SELECT count(*) INTO n FROM public.tickets WHERE order_token = 'auto-1' AND discount_id = rid AND discount_code IS NULL;
  INSERT INTO public.results (name, pass, detail) VALUES ('...an automatic discount records no code', n = 1, n::text);
  PERFORM public.expect('...the second pays full price, unrefused', public.buy(m.showing, m.tickets, NULL, u2, 'auto-2'), 'ok');
  SELECT count(*) INTO n FROM public.tickets WHERE order_token = 'auto-2' AND discount_id IS NULL AND total_price = 10.60;
  INSERT INTO public.results (name, pass, detail) VALUES ('...at $10.60', n = 1, n::text);
END $$;

-- ---------------------------------------------------------------------------
-- P4. Who may quote with a code
-- ---------------------------------------------------------------------------
DO $$
DECLARE got text;
BEGIN
  PERFORM set_config('test.authrole', 'anon', false); PERFORM set_config('test.role', '', false);
  got := public.q('00000000-0000-0000-0000-00000000c013', '[{}]', 'MEMBERS10');
  PERFORM public.expect('anon cannot quote with a code (no unthrottled guessing)', got, '42501');
  PERFORM set_config('test.authrole', 'authenticated', false);
  got := public.q('00000000-0000-0000-0000-00000000c013', '[{}]', 'MEMBERS10');
  PERFORM public.expect('...nor can a patron session', got, '42501');
  PERFORM set_config('test.role', 'staff', false);
  got := public.q('00000000-0000-0000-0000-00000000c013', '[{}]', 'MEMBERS10');
  PERFORM public.expect('staff can (the box office)', got, '200/1908/Members 10%/MEMBERS10/applied/1');
  -- A staff session cannot ask about a buyer's usage: p_buyer is ignored.
  got := public.q((SELECT showing_id FROM public.tickets WHERE order_token = 'each-1' LIMIT 1), '[{}]', 'ONCEEACH', 'online', '00000000-0000-0000-0000-0000000000b1');
  PERFORM public.expect('...and the buyer it names is ignored', got, '400/424/Once each/ONCEEACH/applied/1');
  PERFORM set_config('test.authrole', 'service_role', false); PERFORM set_config('test.role', '', false);
  got := public.q((SELECT showing_id FROM public.tickets WHERE order_token = 'each-1' LIMIT 1), '[{}]', 'ONCEEACH', 'online', '00000000-0000-0000-0000-0000000000b1');
  PERFORM public.expect('the service role (checkout) does check the buyer', got, 'PT422: You have already used');
END $$;

-- Usage, as the admin screens read it: the same count the limits enforce.
DO $$
DECLARE got text;
BEGIN
  SELECT format('%s/%s', u.orders, u.tickets) INTO got
    FROM public.ticket_discount_usage(ARRAY(SELECT id FROM public.ticket_discounts WHERE code = 'THREETIX')) u;
  PERFORM public.expect('usage: THREETIX has 2 orders and 3 tickets', got, '2/3');
  PERFORM set_config('test.authrole', 'authenticated', false); PERFORM set_config('test.role', '', false);
  got := public.try_sql($q$SELECT * FROM public.ticket_discount_usage(ARRAY[gen_random_uuid()])$q$);
  PERFORM public.expect('a patron session cannot read usage', got, '42501');
  PERFORM set_config('test.role', 'admin', false);
  got := public.try_sql($q$SELECT * FROM public.ticket_discount_usage(ARRAY[gen_random_uuid()])$q$);
  PERFORM public.expect('an admin can', got, 'ok');
  PERFORM set_config('test.authrole', 'service_role', false); PERFORM set_config('test.role', '', false);
END $$;

-- RLS on the limits table.
INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses)
  SELECT id, 'orders', 'total', 500 FROM public.ticket_discounts WHERE code = 'MEMBERS10';
-- No test-side GRANT here: the migrations' own grants are what is under test.
-- A test GRANT once hid that authenticated had none (20261120231805).
SET ROLE anon;
SELECT public.expect('anon cannot read limits', public.try_sql('SELECT count(*) FROM public.ticket_discount_limits'), '42501');
RESET ROLE;
SET ROLE authenticated; SELECT set_config('test.role', '', false);
INSERT INTO public.results (name, pass, detail)
SELECT 'a patron session reads no limits', count(*) = 0, count(*)::text FROM public.ticket_discount_limits;
SELECT set_config('test.role', 'staff', false);
INSERT INTO public.results (name, pass, detail)
SELECT 'staff read limits', count(*) > 0, count(*)::text FROM public.ticket_discount_limits;
SELECT public.expect('staff cannot add one', public.try_sql($q$
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses)
  SELECT id, 'tickets', 'total', 1 FROM public.ticket_discounts WHERE code = 'MEMBERS10'$q$), '42501');
SELECT set_config('test.role', 'admin', false);
SELECT public.expect('an admin can', public.try_sql($q$
  INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses)
  SELECT id, 'tickets', 'total', 1 FROM public.ticket_discounts WHERE code = 'MEMBERS10'$q$), 'ok');
RESET ROLE;
SELECT set_config('test.role', '', false);
-- The public still cannot see a coded rule (20261006225937).
SET ROLE anon;
INSERT INTO public.results (name, pass, detail)
SELECT 'the public still reads no coded rule', count(*) FILTER (WHERE code IS NOT NULL) = 0, count(*) || ' visible' FROM public.ticket_discounts;
RESET ROLE;

SELECT n, 'FAIL' AS verdict, name, detail FROM public.results WHERE NOT pass AND n > (SELECT before FROM public.promo_mark) ORDER BY n;
SELECT count(*) FILTER (WHERE pass) AS promo_passed, count(*) FILTER (WHERE NOT pass) AS promo_failed
  FROM public.results WHERE n > (SELECT before FROM public.promo_mark);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.results WHERE NOT pass) THEN RAISE EXCEPTION 'promo code tests failed'; END IF; END $$;
