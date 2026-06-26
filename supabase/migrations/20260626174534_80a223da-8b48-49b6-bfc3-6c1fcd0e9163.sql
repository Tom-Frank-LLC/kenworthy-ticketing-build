
CREATE OR REPLACE FUNCTION public.qbo_save_tokens_service(
  p_user_id uuid,
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
  v_access_id uuid;
  v_refresh_id uuid;
  v_row_id uuid;
  v_existing_access uuid;
  v_existing_refresh uuid;
BEGIN
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
      p_expires_at, p_environment, now(), p_user_id, true
    ) RETURNING id INTO v_row_id;
  ELSE
    UPDATE public.qbo_connection
       SET realm_id = p_realm_id,
           access_token_secret_id = v_access_id,
           refresh_token_secret_id = v_refresh_id,
           token_expires_at = p_expires_at,
           connected_at = now(),
           connected_by = COALESCE(p_user_id, connected_by),
           is_active = true,
           updated_at = now()
     WHERE id = v_row_id;
  END IF;

  RETURN v_row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.qbo_save_tokens_service(uuid, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qbo_save_tokens_service(uuid, text, text, text, timestamptz, text) TO service_role;
