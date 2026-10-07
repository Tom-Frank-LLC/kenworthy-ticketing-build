-- qbo_oauth_states: who can touch it, and that consuming a nonce is single-use.
\set ON_ERROR_STOP 1
\pset pager off
\o /dev/null

CREATE TABLE public.t_results (n serial, name text, pass boolean, detail text);
GRANT ALL ON public.t_results TO PUBLIC;
GRANT ALL ON SEQUENCE public.t_results_n_seq TO PUBLIC;
CREATE FUNCTION public.t_try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM; END $$;
CREATE FUNCTION public.t_count(q text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer; BEGIN EXECUTE q INTO n; RETURN n; EXCEPTION WHEN OTHERS THEN RETURN -1; END $$;
CREATE FUNCTION public.t_check(name text, ok boolean, detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.t_results (name, pass, detail) VALUES (name, COALESCE(ok, false), detail) $$;
GRANT EXECUTE ON FUNCTION public.t_try(text), public.t_count(text), public.t_check(text, boolean, text) TO PUBLIC;

-- anon and authenticated: no read, no write (42501, not an empty success).
SET ROLE anon;
SELECT public.t_check('anon cannot read',   public.t_try('SELECT 1 FROM public.qbo_oauth_states') LIKE '42501%');
SELECT public.t_check('anon cannot insert', public.t_try($q$INSERT INTO public.qbo_oauth_states (nonce, user_id, environment, expires_at) VALUES (gen_random_uuid(), gen_random_uuid(), 'sandbox', now() + interval '10 minutes')$q$) LIKE '42501%');
RESET ROLE;
SET ROLE authenticated;
SELECT public.t_check('authenticated cannot read',   public.t_try('SELECT 1 FROM public.qbo_oauth_states') LIKE '42501%');
SELECT public.t_check('authenticated cannot delete', public.t_try('DELETE FROM public.qbo_oauth_states') LIKE '42501%');
RESET ROLE;

-- service_role: oauth_start's insert, then the callback's consume — twice.
SET ROLE service_role;
INSERT INTO public.qbo_oauth_states (nonce, user_id, environment, expires_at) VALUES
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000d1', 'sandbox', now() + interval '10 minutes'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000d1', 'sandbox', now() - interval '1 second');
-- The callback's statement, as PostgREST issues it (DELETE ... RETURNING).
SELECT public.t_check('first consume returns the row', public.t_count($q$
  WITH d AS (DELETE FROM public.qbo_oauth_states WHERE nonce = '11111111-1111-1111-1111-111111111111'
    AND user_id = '00000000-0000-0000-0000-0000000000d1' AND environment = 'sandbox' AND expires_at > now() RETURNING nonce)
  SELECT count(*)::int FROM d $q$) = 1);
SELECT public.t_check('replayed consume returns nothing', public.t_count($q$
  WITH d AS (DELETE FROM public.qbo_oauth_states WHERE nonce = '11111111-1111-1111-1111-111111111111'
    AND user_id = '00000000-0000-0000-0000-0000000000d1' AND environment = 'sandbox' AND expires_at > now() RETURNING nonce)
  SELECT count(*)::int FROM d $q$) = 0);
SELECT public.t_check('expired nonce is not consumable', public.t_count($q$
  WITH d AS (DELETE FROM public.qbo_oauth_states WHERE nonce = '22222222-2222-2222-2222-222222222222'
    AND expires_at > now() RETURNING nonce)
  SELECT count(*)::int FROM d $q$) = 0);
INSERT INTO public.qbo_oauth_states (nonce, user_id, environment, expires_at) VALUES
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-0000000000d1', 'sandbox', now() + interval '10 minutes');
SELECT public.t_check('another user''s id does not consume it', public.t_count($q$
  WITH d AS (DELETE FROM public.qbo_oauth_states WHERE nonce = '33333333-3333-3333-3333-333333333333'
    AND expires_at > now() AND user_id = '00000000-0000-0000-0000-0000000000ff' RETURNING nonce)
  SELECT count(*)::int FROM d $q$) = 0);
-- oauth_start's housekeeping.
SELECT public.t_check('housekeeping removes the expired row', public.t_count($q$
  WITH d AS (DELETE FROM public.qbo_oauth_states WHERE expires_at < now() RETURNING nonce)
  SELECT count(*)::int FROM d $q$) = 1);
RESET ROLE;

SELECT public.t_check('RLS is on', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.qbo_oauth_states'::regclass));

\o
SELECT n, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS result, name, detail FROM public.t_results ORDER BY n;
DO $$ DECLARE f int; t int; BEGIN
  SELECT count(*) FILTER (WHERE NOT pass), count(*) INTO f, t FROM public.t_results;
  RAISE NOTICE '% / % passed', t - f, t;
  IF f > 0 THEN RAISE EXCEPTION '% case(s) failed', f; END IF;
END $$;
