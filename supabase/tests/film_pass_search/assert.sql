\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. The backfill numbered the existing stock in creation order, from 1000.
-- ---------------------------------------------------------------------------
SELECT pass_number, status, qr_code
FROM public.user_film_passes ORDER BY pass_number;

DO $$
DECLARE v_lo integer; v_hi integer; v_n integer;
BEGIN
  SELECT min(pass_number), max(pass_number), count(*) INTO v_lo, v_hi, v_n
  FROM public.user_film_passes;
  IF v_lo <> 1000 THEN RAISE EXCEPTION 'backfill did not start at 1000 (got %)', v_lo; END IF;
  IF v_hi - v_lo + 1 <> v_n THEN RAISE EXCEPTION 'backfill left gaps: % rows spanning %..%', v_n, v_lo, v_hi; END IF;
  -- Oldest row must hold the lowest number.
  IF (SELECT pass_number FROM public.user_film_passes ORDER BY created_at, id LIMIT 1) <> 1000
    THEN RAISE EXCEPTION 'backfill order does not follow created_at'; END IF;
  RAISE NOTICE 'OK  backfill: % rows numbered %..%', v_n, v_lo, v_hi;
END $$;

-- A new sticker continues the run rather than colliding with it.
INSERT INTO public.user_film_passes (pass_type_id, qr_code, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'PASS:new-0000-0000-0000-000000000005', 'unassigned');

DO $$
DECLARE v integer;
BEGIN
  SELECT pass_number INTO v FROM public.user_film_passes
  WHERE qr_code = 'PASS:new-0000-0000-0000-000000000005';
  IF v <> 1004 THEN RAISE EXCEPTION 'minted pass got %, expected 1004', v; END IF;
  RAISE NOTICE 'OK  mint default: new sticker got %', v;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The role gate actually refuses.
-- ---------------------------------------------------------------------------
DELETE FROM auth._who;
INSERT INTO auth._who VALUES ('44444444-4444-4444-4444-444444444444', 'user');
DO $$
BEGIN
  PERFORM public.search_film_passes();
  RAISE EXCEPTION 'FAIL: a plain user was allowed to search';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK  gate: plain user refused';
END $$;

-- Everything below runs as an admin.
DELETE FROM auth._who;
INSERT INTO auth._who VALUES ('44444444-4444-4444-4444-444444444444', 'admin');

-- ---------------------------------------------------------------------------
-- 3. Default view hides blanks; 'all' shows them; a concrete status narrows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r jsonb;
BEGIN
  r := public.search_film_passes();
  IF (r->>'total')::int <> 3 THEN RAISE EXCEPTION 'issued default returned %, expected 3', r->>'total'; END IF;
  IF r->'counts'->>'unassigned' IS NULL THEN RAISE EXCEPTION 'counts should still report blanks'; END IF;
  RAISE NOTICE 'OK  default view: total=%  counts=%', r->>'total', r->'counts';

  r := public.search_film_passes(NULL, 'all');
  IF (r->>'total')::int <> 5 THEN RAISE EXCEPTION 'all returned %, expected 5', r->>'total'; END IF;
  RAISE NOTICE 'OK  all: total=%', r->>'total';

  r := public.search_film_passes(NULL, 'void');
  IF (r->>'total')::int <> 1 THEN RAISE EXCEPTION 'void returned %, expected 1', r->>'total'; END IF;
  IF (r->'passes'->0->>'redemption_count')::int <> 2
    THEN RAISE EXCEPTION 'void pass redemption_count = %, expected 2', r->'passes'->0->>'redemption_count'; END IF;
  RAISE NOTICE 'OK  status filter + redemption_count';
END $$;

-- ---------------------------------------------------------------------------
-- 4. Search reaches each contact source, and phone formatting cannot hide it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r jsonb;
BEGIN
  r := public.search_film_passes('Smith');
  IF (r->>'total')::int <> 1 THEN RAISE EXCEPTION 'name search: %', r->>'total'; END IF;
  RAISE NOTICE 'OK  by holder name';

  r := public.search_film_passes('bob@example.com');
  IF (r->>'total')::int <> 1 THEN RAISE EXCEPTION 'email search: %', r->>'total'; END IF;
  RAISE NOTICE 'OK  by holder email';

  -- Bearer pass, reachable only through the order.
  r := public.search_film_passes('Carol', 'all');
  IF (r->>'total')::int <> 1 THEN RAISE EXCEPTION 'buyer name search: %', r->>'total'; END IF;
  RAISE NOTICE 'OK  by buyer name (bearer pass)';

  -- Stored '(208) 555-1234', typed bare.
  r := public.search_film_passes('2085551234');
  IF (r->>'total')::int <> 1 THEN RAISE EXCEPTION 'phone digits search: %', r->>'total'; END IF;
  RAISE NOTICE 'OK  by phone, formatting stripped';

  -- Stored '+1 (208) 555-7777' on the order, typed with dashes.
  r := public.search_film_passes('208-555-7777', 'all');
  IF (r->>'total')::int <> 1 THEN RAISE EXCEPTION 'buyer phone search: %', r->>'total'; END IF;
  RAISE NOTICE 'OK  by buyer phone';

  -- By number, exact and by prefix.
  r := public.search_film_passes('1002', 'all');
  IF (r->>'total')::int <> 1 THEN RAISE EXCEPTION 'exact number: %', r->>'total'; END IF;
  r := public.search_film_passes('100', 'all');
  IF (r->>'total')::int <> 5 THEN RAISE EXCEPTION 'prefix number: %, expected 5', r->>'total'; END IF;
  RAISE NOTICE 'OK  by pass number, exact and prefix';

  -- By QR code fragment.
  r := public.search_film_passes('aaaa1111-0000-0000-0000-000000000002', 'all');
  IF (r->>'total')::int <> 1 THEN RAISE EXCEPTION 'qr search: %', r->>'total'; END IF;
  RAISE NOTICE 'OK  by qr_code';

  -- A miss is a miss, not a page-one artefact.
  r := public.search_film_passes('nobodyhere', 'all');
  IF (r->>'total')::int <> 0 THEN RAISE EXCEPTION 'miss returned %', r->>'total'; END IF;
  IF r->>'passes' <> '[]' THEN RAISE EXCEPTION 'miss should return []'; END IF;
  RAISE NOTICE 'OK  a miss returns nothing';
END $$;

-- ---------------------------------------------------------------------------
-- 5. Counts describe the search, before the status filter.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r jsonb;
BEGIN
  r := public.search_film_passes(NULL, 'void');
  IF (r->'counts'->>'active')::int <> 1 THEN RAISE EXCEPTION 'counts lost active under a void filter'; END IF;
  IF (r->'counts'->>'unassigned')::int <> 2 THEN RAISE EXCEPTION 'counts lost blanks: %', r->'counts'; END IF;
  RAISE NOTICE 'OK  counts survive the status filter: %', r->'counts';
END $$;

-- ---------------------------------------------------------------------------
-- 6. Every sort key orders, and paging is stable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r jsonb; k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['newest','oldest','expiring','balance_desc','balance_asc','name','number'] LOOP
    r := public.search_film_passes(NULL, 'all', k);
    IF jsonb_array_length(r->'passes') <> 5 THEN RAISE EXCEPTION 'sort % lost rows', k; END IF;
  END LOOP;
  RAISE NOTICE 'OK  every sort key returns the full set';

  r := public.search_film_passes(NULL, 'all', 'number');
  IF (r->'passes'->0->>'pass_number')::int <> 1000 THEN RAISE EXCEPTION 'number sort wrong'; END IF;

  r := public.search_film_passes(NULL, 'all', 'balance_desc');
  IF (r->'passes'->0->>'remaining_balance')::numeric <> 42 THEN RAISE EXCEPTION 'balance_desc wrong'; END IF;

  r := public.search_film_passes(NULL, 'all', 'balance_asc');
  IF (r->'passes'->0->>'remaining_balance')::numeric <> 0 THEN RAISE EXCEPTION 'balance_asc wrong: %', r->'passes'->0; END IF;

  r := public.search_film_passes(NULL, 'all', 'expiring');
  IF (r->'passes'->0->>'pass_number')::int <> 1002 THEN RAISE EXCEPTION 'expiring wrong'; END IF;

  r := public.search_film_passes(NULL, 'all', 'name');
  IF (r->'passes'->0->>'holder_name') <> 'Bob Jones' THEN RAISE EXCEPTION 'name sort wrong: %', r->'passes'->0->>'holder_name'; END IF;
  RAISE NOTICE 'OK  sort keys order correctly';

  -- Paging: two pages of 2 plus a remainder, no row seen twice or skipped.
  IF (
    SELECT count(DISTINCT v) FROM (
      SELECT jsonb_array_elements(public.search_film_passes(NULL,'all','number',2,0)->'passes')->>'id' AS v
      UNION ALL
      SELECT jsonb_array_elements(public.search_film_passes(NULL,'all','number',2,2)->'passes')->>'id'
      UNION ALL
      SELECT jsonb_array_elements(public.search_film_passes(NULL,'all','number',2,4)->'passes')->>'id'
    ) s
  ) <> 5 THEN RAISE EXCEPTION 'paging duplicated or dropped rows'; END IF;
  RAISE NOTICE 'OK  paging covers the set exactly once';
END $$;

-- ---------------------------------------------------------------------------
-- 7. Deleting a pass cascades its redemptions and spares its order.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_orders integer; v_redemptions integer;
BEGIN
  DELETE FROM public.user_film_passes WHERE id = 'a0000000-0000-0000-0000-000000000003';
  SELECT count(*) INTO v_redemptions FROM public.film_pass_redemptions
    WHERE pass_id = 'a0000000-0000-0000-0000-000000000003';
  SELECT count(*) INTO v_orders FROM public.film_pass_orders WHERE buyer_name = 'Carol Bearer';
  IF v_redemptions <> 0 THEN RAISE EXCEPTION 'redemptions did not cascade'; END IF;
  IF v_orders <> 1 THEN RAISE EXCEPTION 'the order was destroyed with the pass'; END IF;
  RAISE NOTICE 'OK  delete: redemptions cascade, the purchase record survives';
END $$;

\echo '=== all assertions passed ==='
