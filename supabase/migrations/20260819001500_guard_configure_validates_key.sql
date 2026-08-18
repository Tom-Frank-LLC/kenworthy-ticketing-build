-- Make configure_square_catalog_guard() refuse a key that cannot possibly work.
--
-- As shipped it stored whatever text it was given. Someone pasted the runbook's
-- own placeholder — the literal string '<prod service role key>' — and the
-- function answered 'configured'. Everything downstream then looked healthy:
-- the cron job existed and was active, run_square_catalog_guard_check() returned
-- 'dispatched', and app_config held the right URL. The only evidence of failure
-- was a 401 UNAUTHORIZED_INVALID_JWT_FORMAT buried in net._http_response, a
-- table nobody has any reason to read.
--
-- That is this project's recurring failure shape, arriving one more time: a
-- write is accepted, everything reports success, and nothing is actually
-- working. The same lesson as 'a 2xx is not evidence' — so validate at the point
-- of configuration, where a person is present to read the error, instead of
-- failing silently at 11:17 every morning.
--
-- What is checked:
--   * the key is a JWT in shape — three dot-separated segments starting 'eyJ'.
--     Supabase projects also expose a newer 'sb_secret_…' key, but the edge
--     function gateway rejects a non-JWT bearer before our code runs, so the
--     LEGACY service_role JWT is the only thing that works here.
--   * no surrounding whitespace, which a paste often carries and which corrupts
--     the Authorization header.
--   * the URL is https and actually points at this function.
--
-- Deliberately NOT checked: that the key belongs to this project, or that it is
-- service_role rather than anon. Neither is knowable from inside Postgres. The
-- end-to-end proof stays what it always was — run
-- run_square_catalog_guard_check() and confirm a new row lands in
-- square_catalog_guard_runs.

CREATE OR REPLACE FUNCTION public.configure_square_catalog_guard(
  p_url text,
  p_service_key text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_existing uuid;
  v_privileged boolean;
  v_key text;
  v_url text;
BEGIN
  v_privileged := session_user IN ('postgres', 'supabase_admin');

  IF NOT (v_privileged OR has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Trim first: a trailing newline from a paste is the most common corruption
  -- and it is harmless once removed, so fix it rather than complain about it.
  --
  -- The character set is explicit because one-argument btrim() strips SPACES
  -- ONLY. Written as btrim(x) this silently left a pasted newline in place, and
  -- the whitespace check below then rejected a perfectly good key with a message
  -- about whitespace the user could not see.
  v_key := btrim(coalesce(p_service_key, ''), E' \t\n\r\f');
  v_url := btrim(coalesce(p_url, ''),        E' \t\n\r\f');

  IF v_key ~ '\s' THEN
    RAISE EXCEPTION 'The service key contains whitespace, so it is not a key. '
                    'Copy it from Settings -> API without line breaks.';
  END IF;

  IF v_key LIKE 'sb_%' THEN
    RAISE EXCEPTION 'That is the new-format API key. The edge function gateway '
                    'rejects a non-JWT bearer before the function runs, so this '
                    'needs the LEGACY service_role JWT (starts eyJ).';
  END IF;

  IF v_key !~ '^eyJ' OR array_length(string_to_array(v_key, '.'), 1) <> 3 THEN
    RAISE EXCEPTION 'That does not look like a service role JWT (expected three '
                    'dot-separated segments starting eyJ, got % chars starting "%"). '
                    'Placeholder text from the runbook will land here too.',
                    length(v_key), left(v_key, 3);
  END IF;

  IF v_url !~ '^https://' OR v_url NOT LIKE '%/square-catalog-guard' THEN
    RAISE EXCEPTION 'The URL should be https://<project-ref>.supabase.co/'
                    'functions/v1/square-catalog-guard, got "%"', v_url;
  END IF;

  INSERT INTO app_config (key, value)
  VALUES ('square_catalog_guard_url', jsonb_build_object('url', v_url))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  SELECT id INTO v_existing FROM vault.secrets
   WHERE name = 'square_catalog_guard_key';

  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(v_key, 'square_catalog_guard_key');
  ELSE
    PERFORM vault.update_secret(v_existing, v_key);
  END IF;

  RETURN 'configured — now prove it: select public.run_square_catalog_guard_check(); '
      || 'then confirm a new row in square_catalog_guard_runs';
END;
$$;

REVOKE ALL ON FUNCTION public.configure_square_catalog_guard(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.configure_square_catalog_guard(text, text) TO authenticated;
