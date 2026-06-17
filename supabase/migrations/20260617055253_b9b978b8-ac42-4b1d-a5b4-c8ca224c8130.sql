
-- Vault-style encryption for QBO connection tokens.
-- Tokens are stored in Supabase Vault (vault.secrets, encrypted at rest with pgsodium).
-- The qbo_connection table only retains metadata + opaque secret IDs.
-- Plaintext tokens are only retrievable inside SECURITY DEFINER functions callable by service_role.

-- 1. Add secret-id columns
ALTER TABLE public.qbo_connection
  ADD COLUMN IF NOT EXISTS access_token_secret_id uuid,
  ADD COLUMN IF NOT EXISTS refresh_token_secret_id uuid;

-- 2. Drop plaintext token columns (no production data yet — Phase 5 scaffolding)
ALTER TABLE public.qbo_connection
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token;

-- 3. Lock down direct table access. Admins may read metadata via RLS,
--    but never see secret IDs (which, while opaque, shouldn't leak).
REVOKE ALL ON public.qbo_connection FROM anon, authenticated;
GRANT SELECT (id, realm_id, token_expires_at, environment, connected_at, connected_by, is_active, created_at, updated_at)
  ON public.qbo_connection TO authenticated;
GRANT ALL ON public.qbo_connection TO service_role;

-- 4. Admin-only setter: stores tokens in Vault, upserts the connection row.
CREATE OR REPLACE FUNCTION public.qbo_save_tokens(
  p_realm_id text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_environment text DEFAULT 'sandbox'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_access_id uuid;
  v_refresh_id uuid;
  v_row_id uuid;
  v_existing_access uuid;
  v_existing_refresh uuid;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'Only admins can save QBO tokens';
  END IF;

  -- Reuse / rotate vault entries if a row for this environment already exists
  SELECT id, access_token_secret_id, refresh_token_secret_id
    INTO v_row_id, v_existing_access, v_existing_refresh
  FROM public.qbo_connection
  WHERE environment = p_environment AND is_active = true
  LIMIT 1;

  IF v_existing_access IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_access, p_access_token);
    v_access_id := v_existing_access;
  ELSE
    v_access_id := vault.create_secret(p_access_token, 'qbo_access_token_' || p_environment || '_' || gen_random_uuid()::text);
  END IF;

  IF v_existing_refresh IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_refresh, p_refresh_token);
    v_refresh_id := v_existing_refresh;
  ELSE
    v_refresh_id := vault.create_secret(p_refresh_token, 'qbo_refresh_token_' || p_environment || '_' || gen_random_uuid()::text);
  END IF;

  IF v_row_id IS NULL THEN
    INSERT INTO public.qbo_connection (
      realm_id, access_token_secret_id, refresh_token_secret_id,
      token_expires_at, environment, connected_at, connected_by, is_active
    ) VALUES (
      p_realm_id, v_access_id, v_refresh_id,
      p_expires_at, p_environment, now(), v_caller, true
    ) RETURNING id INTO v_row_id;
  ELSE
    UPDATE public.qbo_connection
       SET realm_id = p_realm_id,
           access_token_secret_id = v_access_id,
           refresh_token_secret_id = v_refresh_id,
           token_expires_at = p_expires_at,
           connected_at = now(),
           connected_by = v_caller,
           updated_at = now()
     WHERE id = v_row_id;
  END IF;

  RETURN v_row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.qbo_save_tokens(text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qbo_save_tokens(text, text, text, timestamptz, text) TO authenticated;
-- Authenticated is needed for admin RPC; the function itself enforces has_role('admin').

-- 5. Service-role-only getter: returns decrypted tokens for the edge function.
CREATE OR REPLACE FUNCTION public.qbo_get_active_tokens(p_environment text DEFAULT 'sandbox')
RETURNS TABLE(
  connection_id uuid,
  realm_id text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.realm_id,
         (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = c.access_token_secret_id),
         (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = c.refresh_token_secret_id),
         c.token_expires_at
  FROM public.qbo_connection c
  WHERE c.environment = p_environment AND c.is_active = true
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.qbo_get_active_tokens(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qbo_get_active_tokens(text) TO service_role;

-- 6. Admin disconnect: removes vault secrets and deactivates the row.
CREATE OR REPLACE FUNCTION public.qbo_disconnect(p_environment text DEFAULT 'sandbox')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_access uuid;
  v_refresh uuid;
  v_row_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can disconnect QBO';
  END IF;

  SELECT id, access_token_secret_id, refresh_token_secret_id
    INTO v_row_id, v_access, v_refresh
  FROM public.qbo_connection
  WHERE environment = p_environment AND is_active = true
  LIMIT 1;

  IF v_row_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.qbo_connection
     SET is_active = false,
         access_token_secret_id = NULL,
         refresh_token_secret_id = NULL,
         updated_at = now()
   WHERE id = v_row_id;

  IF v_access IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_access;
  END IF;
  IF v_refresh IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_refresh;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.qbo_disconnect(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qbo_disconnect(text) TO authenticated;
