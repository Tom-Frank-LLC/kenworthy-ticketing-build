-- The Square OAuth connection behind the box-office Stand (BRIEF-ios-stand-reader.md).
--
-- Square's Mobile Payments SDK takes payments only with an OAuth access token
-- in production (a personal access token is allowed in the sandbox alone). An
-- admin connects once through square-mobile's connect_start/oauth_callback;
-- the token is refreshed by square-mobile as it nears its 30-day expiry and
-- handed to signed-in staff on the iPad that holds the Stand.
--
-- Modelled on QuickBooks' connection (20260617055253, 20261006233349):
--
-- - square_oauth_states: single-use nonces for the signed OAuth state.
--   connect_start inserts one; oauth_callback deletes it (DELETE ... RETURNING,
--   so of two racing callbacks only one gets it) before acting on the state.
-- - square_mobile_connection: metadata plus Vault secret ids. The tokens
--   themselves are in Supabase Vault, encrypted at rest.
-- - Three SECURITY DEFINER functions, service_role only. Unlike qbo there is
--   no admin-callable RPC: square-mobile checks the admin role itself before
--   it calls any of them, and no browser path needs to.
--
-- Nothing here is reachable by anon or authenticated: RLS is on with no
-- policies, and neither role holds a grant, so PostgREST refuses rather than
-- returning an empty success.

CREATE TABLE IF NOT EXISTS public.square_oauth_states (
  nonce       uuid PRIMARY KEY,
  user_id     uuid NOT NULL,
  environment text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS square_oauth_states_expires_at_idx
  ON public.square_oauth_states (expires_at);

ALTER TABLE public.square_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.square_oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.square_oauth_states TO service_role;

COMMENT ON TABLE public.square_oauth_states IS
  'square-mobile OAuth nonces: inserted by connect_start, consumed (deleted) by oauth_callback. Service role only.';

CREATE TABLE IF NOT EXISTS public.square_mobile_connection (
  environment             text PRIMARY KEY CHECK (environment IN ('sandbox', 'production')),
  merchant_id             text NOT NULL,
  access_token_secret_id  uuid NOT NULL,
  refresh_token_secret_id uuid,
  token_expires_at        timestamptz,
  connected_at            timestamptz NOT NULL DEFAULT now(),
  connected_by            uuid,
  refreshed_at            timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.square_mobile_connection ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.square_mobile_connection FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.square_mobile_connection TO service_role;

COMMENT ON TABLE public.square_mobile_connection IS
  'The Square OAuth connection the box-office Stand takes payments with. Tokens in Vault; service role only (square-mobile).';

-- Save (connect, or a refresh). p_connected_by is null on a refresh, which
-- keeps the original connector. A null p_refresh_token keeps the stored one.
CREATE OR REPLACE FUNCTION public.square_mobile_save_tokens(
  p_environment text,
  p_merchant_id text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_connected_by uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_row public.square_mobile_connection%ROWTYPE;
  v_access uuid;
  v_refresh uuid;
  v_exists boolean;
BEGIN
  IF p_access_token IS NULL OR p_access_token = '' THEN
    RAISE EXCEPTION 'square_mobile_save_tokens: no access token';
  END IF;

  SELECT * INTO v_row FROM public.square_mobile_connection WHERE environment = p_environment FOR UPDATE;
  -- Captured once: FOUND is reset by every PERFORM below.
  v_exists := FOUND;

  IF v_exists THEN
    PERFORM vault.update_secret(v_row.access_token_secret_id, p_access_token);
    v_access := v_row.access_token_secret_id;
    v_refresh := v_row.refresh_token_secret_id;
  ELSE
    v_access := vault.create_secret(p_access_token, 'square_mobile_access_' || p_environment || '_' || gen_random_uuid()::text);
  END IF;

  IF p_refresh_token IS NOT NULL AND p_refresh_token <> '' THEN
    IF v_refresh IS NOT NULL THEN
      PERFORM vault.update_secret(v_refresh, p_refresh_token);
    ELSE
      v_refresh := vault.create_secret(p_refresh_token, 'square_mobile_refresh_' || p_environment || '_' || gen_random_uuid()::text);
    END IF;
  END IF;

  IF v_exists THEN
    UPDATE public.square_mobile_connection
       SET merchant_id = p_merchant_id,
           access_token_secret_id = v_access,
           refresh_token_secret_id = v_refresh,
           token_expires_at = p_expires_at,
           connected_at = CASE WHEN p_connected_by IS NULL THEN connected_at ELSE now() END,
           connected_by = COALESCE(p_connected_by, connected_by),
           refreshed_at = CASE WHEN p_connected_by IS NULL THEN now() ELSE refreshed_at END,
           updated_at = now()
     WHERE environment = p_environment;
  ELSE
    INSERT INTO public.square_mobile_connection (
      environment, merchant_id, access_token_secret_id, refresh_token_secret_id,
      token_expires_at, connected_at, connected_by
    ) VALUES (
      p_environment, p_merchant_id, v_access, v_refresh, p_expires_at, now(), p_connected_by
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.square_mobile_get_tokens(p_environment text)
RETURNS TABLE(
  merchant_id text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  connected_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT c.merchant_id,
         (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = c.access_token_secret_id),
         (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = c.refresh_token_secret_id),
         c.token_expires_at,
         c.connected_at
  FROM public.square_mobile_connection c
  WHERE c.environment = p_environment;
END;
$$;

CREATE OR REPLACE FUNCTION public.square_mobile_disconnect(p_environment text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_row public.square_mobile_connection%ROWTYPE;
BEGIN
  DELETE FROM public.square_mobile_connection WHERE environment = p_environment RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM vault.secrets WHERE id IN (v_row.access_token_secret_id, v_row.refresh_token_secret_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.square_mobile_save_tokens(text, text, text, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.square_mobile_get_tokens(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.square_mobile_disconnect(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.square_mobile_save_tokens(text, text, text, text, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.square_mobile_get_tokens(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.square_mobile_disconnect(text) TO service_role;
