-- activate_film_pass fulfils an order by its quantity (20261006225347, audit L2).
\set ON_ERROR_STOP 1
CREATE TABLE public.results (n serial, name text, pass boolean, detail text);
CREATE FUNCTION public.ok(name text, pass boolean, detail text DEFAULT '') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.results (name, pass, detail) VALUES (name, COALESCE(pass, false), detail) $$;
CREATE FUNCTION public.act(qr text, ord uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.activate_film_pass(qr, ord, NULL, NULL, '00000000-0000-0000-0000-0000000000f0') $$;
CREATE TABLE public.v (k text PRIMARY KEY, j jsonb);

-- 0. The bug, as the old function had it.
SELECT public.ok('before: one sticker fulfilled a three-pass order',
  (SELECT bool_or(verdict ->> 'result' = 'activated') FROM public.before_result)
  AND (SELECT bool_or(verdict ->> 'order_status' = 'fulfilled') FROM public.before_result),
  (SELECT string_agg(verdict::text, ' ') FROM public.before_result));
-- ...and the migration linked that pass to the order it discharged.
SELECT public.ok('backfill: the pass in an order''s pass_id records the order',
  (SELECT film_pass_order_id FROM public.user_film_passes WHERE qr_code = 'PASS:0010') = '00000000-0000-0000-0000-0000000000c0');
SELECT public.ok('backfill: no other pass is linked',
  (SELECT count(*) FROM public.user_film_passes WHERE film_pass_order_id IS NOT NULL) = 1);

-- 1. Three passes, three stickers.
INSERT INTO public.v SELECT 'a1', public.act('PASS:0001', '00000000-0000-0000-0000-0000000000c3');
SELECT public.ok('first sticker activates', (SELECT j ->> 'result' FROM public.v WHERE k = 'a1') = 'activated', (SELECT j::text FROM public.v WHERE k = 'a1'));
SELECT public.ok('...and says 1 of 3, 2 to go',
  (SELECT (j ->> 'quantity')::int = 3 AND (j ->> 'passes_activated')::int = 1 AND (j ->> 'passes_remaining')::int = 2
          AND (j ->> 'order_fulfilled')::boolean = false FROM public.v WHERE k = 'a1'));
SELECT public.ok('the order is still paid, still in the queue, not fulfilled',
  (SELECT status = 'paid' AND fulfilled_at IS NULL AND fulfilled_by IS NULL FROM public.film_pass_orders WHERE id = '00000000-0000-0000-0000-0000000000c3'));
SELECT public.ok('pass_id is the first pass',
  (SELECT o.pass_id = p.id FROM public.film_pass_orders o, public.user_film_passes p
   WHERE o.id = '00000000-0000-0000-0000-0000000000c3' AND p.qr_code = 'PASS:0001'));

INSERT INTO public.v SELECT 'a2', public.act('PASS:0002', '00000000-0000-0000-0000-0000000000c3');
SELECT public.ok('second sticker: 2 of 3, order still paid',
  (SELECT (j ->> 'passes_activated')::int = 2 AND (j ->> 'passes_remaining')::int = 1 FROM public.v WHERE k = 'a2')
  AND (SELECT status = 'paid' FROM public.film_pass_orders WHERE id = '00000000-0000-0000-0000-0000000000c3'));

INSERT INTO public.v SELECT 'a3', public.act('PASS:0003', '00000000-0000-0000-0000-0000000000c3');
SELECT public.ok('third sticker fulfils the order',
  (SELECT (j ->> 'passes_activated')::int = 3 AND (j ->> 'passes_remaining')::int = 0 AND (j ->> 'order_fulfilled')::boolean FROM public.v WHERE k = 'a3')
  AND (SELECT status = 'fulfilled' AND fulfilled_at IS NOT NULL AND fulfilled_by = '00000000-0000-0000-0000-0000000000f0'
       FROM public.film_pass_orders WHERE id = '00000000-0000-0000-0000-0000000000c3'));
SELECT public.ok('pass_id is still the first pass',
  (SELECT o.pass_id = p.id FROM public.film_pass_orders o, public.user_film_passes p
   WHERE o.id = '00000000-0000-0000-0000-0000000000c3' AND p.qr_code = 'PASS:0001'));
SELECT public.ok('three active passes, owned by the buyer, linked to the order, a third of the charge each',
  (SELECT count(*) = 3 AND bool_and(status = 'active' AND user_id = '00000000-0000-0000-0000-0000000000a1'
                                    AND remaining_balance = 60 AND price_paid = 63.60)
   FROM public.user_film_passes WHERE film_pass_order_id = '00000000-0000-0000-0000-0000000000c3'));

INSERT INTO public.v SELECT 'a4', public.act('PASS:0004', '00000000-0000-0000-0000-0000000000c3');
SELECT public.ok('a fourth sticker against the fulfilled order is refused',
  (SELECT j ->> 'result' = 'order_not_payable' AND j ->> 'order_status' = 'fulfilled' FROM public.v WHERE k = 'a4'),
  (SELECT j::text FROM public.v WHERE k = 'a4'));
SELECT public.ok('...and the sticker stays blank',
  (SELECT status = 'unassigned' AND film_pass_order_id IS NULL FROM public.user_film_passes WHERE qr_code = 'PASS:0004'));

-- 2. A one-pass order: fulfilled by its one sticker, as before.
INSERT INTO public.v SELECT 'b1', public.act('PASS:0005', '00000000-0000-0000-0000-0000000000c1');
SELECT public.ok('a one-pass order is fulfilled by its sticker',
  (SELECT (j ->> 'order_fulfilled')::boolean AND (j ->> 'passes_remaining')::int = 0 FROM public.v WHERE k = 'b1')
  AND (SELECT status = 'fulfilled' AND pass_id IS NOT NULL FROM public.film_pass_orders WHERE id = '00000000-0000-0000-0000-0000000000c1'));

-- 3. A counter sale (no order): untouched.
INSERT INTO public.v SELECT 'w1', public.activate_film_pass('PASS:0006', NULL, NULL, '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000f0', 'cash', 60, NULL);
SELECT public.ok('a walk-in activates with no order fields',
  (SELECT j ->> 'result' = 'activated' AND j -> 'quantity' = 'null'::jsonb AND j -> 'passes_activated' = 'null'::jsonb FROM public.v WHERE k = 'w1'),
  (SELECT j::text FROM public.v WHERE k = 'w1'));
SELECT public.ok('...is a counter sale, linked to no order',
  (SELECT status = 'active' AND film_pass_order_id IS NULL AND payment_method = 'cash' AND price_paid = 60 AND user_id IS NULL
   FROM public.user_film_passes WHERE qr_code = 'PASS:0006'));
SELECT public.ok('re-scanning an active sticker is still already_activated',
  (public.act('PASS:0006') ->> 'result') = 'already_activated');

-- 4. Defensive: a 'paid' order that somehow already has all its passes.
INSERT INTO public.film_pass_orders (id, user_id, pass_type_id, quantity, amount_paid, status)
  VALUES ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', 1, 63.60, 'paid');
UPDATE public.user_film_passes SET film_pass_order_id = '00000000-0000-0000-0000-0000000000c9' WHERE qr_code = 'PASS:0006';
INSERT INTO public.v SELECT 'd1', public.act('PASS:0007', '00000000-0000-0000-0000-0000000000c9');
SELECT public.ok('an order already holding its quantity issues no more',
  (SELECT j ->> 'result' = 'order_not_payable' AND (j ->> 'passes_activated')::int = 1 FROM public.v WHERE k = 'd1')
  AND (SELECT status = 'unassigned' FROM public.user_film_passes WHERE qr_code = 'PASS:0007'),
  (SELECT j::text FROM public.v WHERE k = 'd1'));

-- 5. Still the service role's alone.
SELECT public.ok('anon cannot execute it',
  NOT has_function_privilege('anon', 'public.activate_film_pass(text, uuid, uuid, uuid, uuid, text, numeric, text)', 'EXECUTE'));
SELECT public.ok('authenticated cannot execute it',
  NOT has_function_privilege('authenticated', 'public.activate_film_pass(text, uuid, uuid, uuid, uuid, text, numeric, text)', 'EXECUTE'));
SELECT public.ok('service_role can',
  has_function_privilege('service_role', 'public.activate_film_pass(text, uuid, uuid, uuid, uuid, text, numeric, text)', 'EXECUTE'));

SELECT n, CASE WHEN pass THEN 'ok  ' ELSE 'FAIL' END AS verdict, name, detail FROM public.results ORDER BY n;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM public.results;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.results WHERE NOT pass) THEN RAISE EXCEPTION 'film_pass_activation tests failed'; END IF; END $$;
