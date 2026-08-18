-- Let the guard configure its own schedule, so nobody hand-copies a key.
--
-- Configuring the schedule needed a service role key pasted into the SQL editor.
-- That went wrong twice in a row — the placeholder text was submitted verbatim
-- both times — and it was never a good design: it asks a person to transcribe a
-- credential by hand into a query, and the only thing that could catch a mistake
-- was the validation added in 20260819001500.
--
-- The edge function already HAS the service role key in its environment, and a
-- service-role client to call this function with. So the key never needs to
-- leave the platform: an admin calls the guard's `install_schedule` action, and
-- the function passes its own key straight through to here.
--
-- That requires accepting a third caller identity: a service-role JWT arriving
-- through PostgREST. It reaches this function as session_user = 'authenticator'
-- with auth.uid() NULL, so neither existing branch matches. Read the role out of
-- the request's JWT claims instead — the same claims PostgREST uses for RLS.

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
BEGIN
  -- A direct privileged connection: the SQL editor, or psql as postgres.
  v_privileged := session_user IN ('postgres', 'supabase_admin');

  -- The role claim on a PostgREST request. NULL for a direct connection, which
  -- is why the check is separate rather than folded into the one above.
  --
  -- The cast is guarded because current_setting() returns whatever is there, and
  -- a malformed value raised 'invalid input syntax for type json' out of an
  -- authorization check — a confusing 500 where a clean refusal belonged.
  --
  -- A narrow handler is warranted here, unlike the blanket one removed from the
  -- scheduling migration: it wraps a single expression, and its fallback is the
  -- SAFE direction. An unparseable claim yields '', which matches no branch and
  -- denies. It cannot let anybody in.
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

  IF v_key LIKE 'sb_%' THEN
    RAISE EXCEPTION 'That is the new-format API key. The edge function gateway '
                    'rejects a non-JWT bearer before the function runs, so this '
                    'needs the LEGACY service_role JWT (starts eyJ).';
  END IF;

  IF v_key !~ '^eyJ' OR array_length(string_to_array(v_key, '.'), 1) <> 3 THEN
    RAISE EXCEPTION 'That does not look like a service role JWT (expected three '
                    'dot-separated segments starting eyJ, got % chars starting "%").',
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

  RETURN 'configured';
END;
$$;

REVOKE ALL ON FUNCTION public.configure_square_catalog_guard(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.configure_square_catalog_guard(text, text) TO authenticated, service_role;
