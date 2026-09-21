-- Run by run.sh after the migration under test. Prints one row per check and
-- fails the script if any did not pass.
\set ON_ERROR_STOP 1
\set doc `cat /tmp/pricing_vectors.json`
CREATE TABLE public.results (n serial, name text, pass boolean, detail text);

-- Try an INSERT in a subtransaction; report the SQLSTATE it raised, or 'ok'.
CREATE FUNCTION public.try_sql(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

-- 1. Half-even itself.
INSERT INTO public.results (name, pass, detail)
SELECT 'round_half_even_div ' || n || '/10 = ' || want, public.round_half_even_div(n, 10) = want, ''
FROM (VALUES (405, 40), (495, 50), (645, 64), (45, 4), (15, 2), (404, 40), (406, 41), (0, 0)) v(n, want);

-- 2. No-op at today's prices: an inserter that sends NO tax (what a client
--    written before this migration amounts to) gets rows identical to the old
--    trigger's, for every 50-cent price, and the order check lets them in.
WITH s AS (
  INSERT INTO public.showings (ticket_price)
  SELECT c / 100.0 FROM generate_series(50, 10000, 50) c
  RETURNING id, ticket_price
), t AS (
  INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, order_token)
  SELECT s.id, 0, 0, 0, 'new-' || s.ticket_price FROM s, generate_series(1, 4)
  RETURNING price, tax_amount, total_price
), now_rows AS (SELECT DISTINCT price, tax_amount, total_price FROM t)
INSERT INTO public.results (name, pass, detail)
SELECT 'every 50-cent price stores exactly what the old trigger stored',
       NOT EXISTS (SELECT * FROM now_rows EXCEPT SELECT * FROM public.baseline)
   AND NOT EXISTS (SELECT * FROM public.baseline EXCEPT SELECT * FROM now_rows)
   AND (SELECT count(*) FROM now_rows) = 200,
       (SELECT count(*) FROM now_rows) || ' distinct price rows compared';

-- 3. Square's vectors, through the real triggers. One showing per vector, one
--    tier per distinct price; the test apportions cumulatively, exactly as
--    apportionOrderTax does, using the SQL function under test.
CREATE TABLE public.vec AS
SELECT v ->> 'label' AS label,
       (v ->> 'square_tax_cents')::bigint AS square_tax,
       (v ->> 'square_total_cents')::bigint AS square_total,
       ARRAY(SELECT jsonb_array_elements_text(v -> 'ticket_net_cents')::bigint) AS cents
FROM jsonb_array_elements(:'doc'::jsonb -> 'tax_only') v;

DO $$
DECLARE
  r record; sid uuid; i int; tid uuid; running bigint; prev_tax bigint; share bigint;
  got_tax bigint; got_total bigint;
BEGIN
  FOR r IN SELECT * FROM public.vec LOOP
    INSERT INTO public.showings (ticket_price) VALUES (0) RETURNING id INTO sid;
    INSERT INTO public.showing_price_tiers (showing_id, tier_name, price)
      SELECT DISTINCT sid, 'c' || c, c / 100.0 FROM unnest(r.cents) c;

    CREATE TEMP TABLE batch (LIKE public.tickets INCLUDING DEFAULTS) ON COMMIT DROP;
    running := 0; prev_tax := 0;
    FOR i IN 1 .. array_length(r.cents, 1) LOOP
      running := running + r.cents[i];
      share := public.order_tax_cents(running) - prev_tax;
      prev_tax := prev_tax + share;
      SELECT id INTO tid FROM public.showing_price_tiers
        WHERE showing_id = sid AND tier_name = 'c' || r.cents[i];
      INSERT INTO batch (showing_id, tier_id, price, tax_amount, total_price, order_token)
        VALUES (sid, tid, 0, share / 100.0, 0, 'vec-' || r.label);
    END LOOP;

    -- ONE statement, as ticket-checkout and StaffPOS write an order.
    INSERT INTO public.tickets (showing_id, tier_id, price, tax_amount, total_price, order_token)
      SELECT showing_id, tier_id, price, tax_amount, total_price, order_token FROM batch;
    DROP TABLE batch;

    SELECT SUM(ROUND(tax_amount * 100)), SUM(ROUND(total_price * 100)) INTO got_tax, got_total
      FROM public.tickets WHERE order_token = 'vec-' || r.label;
    INSERT INTO public.results (name, pass, detail)
      VALUES ('Square agrees: ' || r.label,
              got_tax = r.square_tax AND got_total = r.square_total,
              'rows sum to ' || got_total || ', Square ' || r.square_total);
  END LOOP;
END $$;

-- 4. The refusal. $8.25 x 2 with the OLD per-ticket tax (0.50 + 0.50 = 1.00;
--    Square says 0.99) must not get in, and must say PT422.
INSERT INTO public.showings (id, ticket_price) VALUES ('00000000-0000-0000-0000-000000000825', 8.25);
INSERT INTO public.results (name, pass, detail)
SELECT 'per-ticket half-up tax at $8.25 x 2 is refused with PT422', got = 'PT422', got
FROM (SELECT public.try_sql($q$
  INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, order_token) VALUES
    ('00000000-0000-0000-0000-000000000825', 8.25, 0.50, 8.75, 'old-model'),
    ('00000000-0000-0000-0000-000000000825', 8.25, 0.50, 8.75, 'old-model')$q$) AS got) x;

INSERT INTO public.results (name, pass, detail)
SELECT 'a refused order leaves no rows behind',
       NOT EXISTS (SELECT 1 FROM public.tickets WHERE order_token = 'old-model'), '';

INSERT INTO public.results (name, pass, detail)
SELECT 'the same order, apportioned 0.50 + 0.49, is accepted', got = 'ok', got
FROM (SELECT public.try_sql($q$
  INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, order_token) VALUES
    ('00000000-0000-0000-0000-000000000825', 8.25, 0.50, 8.75, 'new-model'),
    ('00000000-0000-0000-0000-000000000825', 8.25, 0.49, 8.74, 'new-model')$q$) AS got) x;

-- 5. Orders are judged separately even when one statement carries two.
INSERT INTO public.results (name, pass, detail)
SELECT 'one bad order refuses the statement even beside a good one', got = 'PT422', got
FROM (SELECT public.try_sql($q$
  INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, order_token) VALUES
    ('00000000-0000-0000-0000-000000000825', 8.25, 0.50, 0, 'pair-good'),
    ('00000000-0000-0000-0000-000000000825', 8.25, 0.49, 0, 'pair-good'),
    ('00000000-0000-0000-0000-000000000825', 8.25, 0.50, 0, 'pair-bad'),
    ('00000000-0000-0000-0000-000000000825', 8.25, 0.50, 0, 'pair-bad')$q$) AS got) x;

-- 6. The inserter still cannot set the price, and a tax that is not a plausible
--    share is replaced rather than trusted.
INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, order_token)
VALUES ('00000000-0000-0000-0000-000000000825', 1.00, 5.00, 1.00, 'forged');
INSERT INTO public.results (name, pass, detail)
SELECT 'a forged price and tax are overwritten', price = 8.25 AND tax_amount = 0.50 AND total_price = 8.75,
       price || ' / ' || tax_amount || ' / ' || total_price
FROM public.tickets WHERE order_token = 'forged';

-- 7. Comps and pass admissions are $0 and outside the check.
INSERT INTO public.results (name, pass, detail)
SELECT 'comp and film_pass rows are zeroed and never refused', got = 'ok', got
FROM (SELECT public.try_sql($q$
  INSERT INTO public.tickets (showing_id, price, tax_amount, total_price, payment_method, order_token) VALUES
    ('00000000-0000-0000-0000-000000000825', 8.25, 0.50, 8.75, 'comp', 'comps'),
    ('00000000-0000-0000-0000-000000000825', 8.25, 0.50, 8.75, 'film_pass', 'comps')$q$) AS got) x;
INSERT INTO public.results (name, pass, detail)
SELECT 'those rows carry no money', SUM(total_price) = 0, '' FROM public.tickets WHERE order_token = 'comps';

SELECT n, CASE WHEN pass THEN 'ok  ' ELSE 'FAIL' END AS verdict, name, detail FROM public.results ORDER BY n;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM public.results;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.results WHERE NOT pass) THEN RAISE EXCEPTION 'order_tax tests failed'; END IF;
END $$;
