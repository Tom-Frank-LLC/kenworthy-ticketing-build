-- Under the OLD activate_film_pass: one sticker against a three-pass order
-- fulfils the whole order. Recorded so the test can show the bug was real,
-- and so the migration's backfill has a history to link.
\set ON_ERROR_STOP 1
CREATE TABLE public.before_result AS
SELECT public.activate_film_pass('PASS:0010', '00000000-0000-0000-0000-0000000000c0', NULL, NULL,
                                 '00000000-0000-0000-0000-0000000000f0') AS verdict;
INSERT INTO public.before_result
SELECT jsonb_build_object('order_status', status, 'pass_id', pass_id) FROM public.film_pass_orders
WHERE id = '00000000-0000-0000-0000-0000000000c0';
