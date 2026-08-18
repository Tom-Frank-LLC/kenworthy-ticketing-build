-- Let the schedule be configured from the SQL editor, not only through PostgREST.
--
-- 20260818231500 gated configure_square_catalog_guard() on
-- has_role(auth.uid(), 'admin'). That is right for a call arriving through
-- PostgREST with a user's JWT, and wrong everywhere else: in Supabase's SQL
-- editor there is no JWT, so auth.uid() is NULL, has_role(NULL, …) is false, and
-- the one obvious way to configure the job raised 'Admin only'.
--
-- The SQL editor is also the only convenient place to paste a service role key,
-- which is the second argument. So as merged, the function could not practically
-- be called at all.
--
-- Fixed by accepting either identity:
--
--   * a PostgREST caller carrying an admin JWT, exactly as before; or
--   * a privileged DIRECT connection — the SQL editor, psql as postgres, a
--     migration.
--
-- session_user is deliberately used rather than current_user: this is
-- SECURITY DEFINER, so current_user is always the owner and a check on it would
-- pass for everyone. session_user is the role that actually connected, and a
-- PostgREST request connects as `authenticator`, so a web caller cannot reach
-- the privileged branch by accident.

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
BEGIN
  v_privileged := session_user IN ('postgres', 'supabase_admin');

  IF NOT (v_privileged OR has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  INSERT INTO app_config (key, value)
  VALUES ('square_catalog_guard_url', jsonb_build_object('url', p_url))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  SELECT id INTO v_existing FROM vault.secrets
   WHERE name = 'square_catalog_guard_key';

  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(p_service_key, 'square_catalog_guard_key');
  ELSE
    PERFORM vault.update_secret(v_existing, p_service_key);
  END IF;

  RETURN 'configured';
END;
$$;

REVOKE ALL ON FUNCTION public.configure_square_catalog_guard(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.configure_square_catalog_guard(text, text) TO authenticated;
