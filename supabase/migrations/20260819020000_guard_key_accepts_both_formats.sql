-- Stop asserting which key FORMAT is valid, because the assertion was wrong.
--
-- 20260819001500 rejected any key starting 'sb_', on the reasoning that the edge
-- function gateway rejects a non-JWT bearer so only the legacy service_role JWT
-- could work. That reasoning was inferred from a 401 whose actual cause was the
-- runbook's placeholder text being submitted verbatim — a string that is not a
-- JWT and not an sb_ key either. The 401 proved the placeholder was invalid. It
-- proved nothing about sb_ keys, and it was read as though it had.
--
-- It then blocked the real thing: this project's platform injects
-- SUPABASE_SERVICE_ROLE_KEY into edge functions in the NEW sb_secret_ format, so
-- the guard's install_schedule action was refused its own key.
--
-- Two changes:
--
--   1. Accept both shapes — a JWT (three dot-separated segments starting eyJ) or
--      an sb_secret_ key. Still reject whitespace, placeholder text and anything
--      implausibly short, which is what actually went wrong twice.
--
--   2. Stop treating shape as proof at all. install_schedule now performs a real
--      HTTP round trip with the key before storing it, against the same URL
--      pg_net will call every morning. That tests both gates this function
--      cannot see — the platform gateway and the guard's own machine check —
--      and it is the only check that could have caught this class of error.
--
-- The pattern this keeps re-teaching: a value being well-formed is not evidence
-- that it works. Same lesson as 'a 2xx is not evidence of a write'.

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
  v_jwt_role text;
  v_key text;
  v_url text;
  v_is_jwt boolean;
  v_is_secret boolean;
BEGIN
  v_privileged := session_user IN ('postgres', 'supabase_admin');

  -- Guarded cast: a malformed claim must deny, not raise a JSON error out of an
  -- authorization check. Fails closed — '' matches no branch.
  BEGIN
    v_jwt_role := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    );
  EXCEPTION WHEN others THEN
    v_jwt_role := '';
  END;

  IF NOT (
    v_privileged
    OR v_jwt_role = 'service_role'
    OR has_role(auth.uid(), 'admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  v_key := btrim(coalesce(p_service_key, ''), E' \t\n\r\f');
  v_url := btrim(coalesce(p_url, ''),        E' \t\n\r\f');

  IF v_key ~ '\s' THEN
    RAISE EXCEPTION 'The service key contains whitespace, so it is not a key.';
  END IF;

  v_is_jwt    := v_key ~ '^eyJ' AND array_length(string_to_array(v_key, '.'), 1) = 3;
  v_is_secret := v_key ~ '^sb_secret_' AND length(v_key) >= 20;

  IF NOT (v_is_jwt OR v_is_secret) THEN
    RAISE EXCEPTION 'That is not a service role key (expected a JWT starting eyJ '
                    'with three dot-separated segments, or an sb_secret_ key; '
                    'got % chars starting "%").', length(v_key), left(v_key, 3);
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

  RETURN 'configured';
END;
$$;

REVOKE ALL ON FUNCTION public.configure_square_catalog_guard(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.configure_square_catalog_guard(text, text) TO authenticated, service_role;
