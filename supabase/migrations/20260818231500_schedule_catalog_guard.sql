-- Run the catalog guard's check on a schedule.
--
-- Without this the guard only runs when somebody thinks to call it, which is
-- most of the problem it was built to solve: the Aug 14 overwrite went unnoticed
-- for days and the Aug 17 event-block bleed was found by chance. A check nobody
-- runs is a check that does not exist.
--
-- This is the first scheduled job in the project, so it is deliberately
-- conservative:
--
--   * it only ever calls `check`, which writes nothing to Square. `repair`
--     touches the live catalog and is refused to machine callers by the function
--     itself — a person repairs, having read what the check found.
--   * it is a fire-and-forget HTTP post via pg_net. The guard records its own
--     run in square_catalog_guard_runs, so the schedule needs no response
--     handling and a failed call cannot break anything here.
--   * if it is not configured yet it does nothing and says so. An unconfigured
--     job must not raise every night.
--
-- Two values have to exist for it to fire, and neither belongs in git:
--
--   1. app_config['square_catalog_guard_url']  — the function's URL, which
--      differs between staging and production.
--   2. a Vault secret named 'square_catalog_guard_key' holding the project's
--      service role key. The guard accepts it for read-only actions only.
--
-- Set them with public.configure_square_catalog_guard(url, key). Until then this
-- migration is inert, which is why it is safe to apply everywhere.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- One-shot configuration, so the URL and key are supplied at run time rather
-- than committed. Admin-only; the key goes straight into Vault.
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
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
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

-- What the cron job actually runs.
CREATE OR REPLACE FUNCTION public.run_square_catalog_guard_check()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT value ->> 'url' INTO v_url
    FROM app_config WHERE key = 'square_catalog_guard_url';

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'square_catalog_guard_key';

  -- Not configured is a normal state, not a failure. Say so once and stop;
  -- raising here would email somebody every night about a job nobody has
  -- switched on yet.
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'square-catalog-guard not scheduled yet: run configure_square_catalog_guard()';
    RETURN 'unconfigured';
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key),
    body    := jsonb_build_object('action', 'check'),
    timeout_milliseconds := 120000   -- a full catalog walk is ~6s; this is slack
  );

  RETURN 'dispatched';
END;
$$;

REVOKE ALL ON FUNCTION public.run_square_catalog_guard_check() FROM public, anon, authenticated;

-- Daily at 11:17 UTC — mid-morning Pacific, so a finding lands at the start of a
-- working day rather than overnight. Off the hour on purpose: scheduling on :00
-- puts it in the same burst as every other cron on the box.
-- Drop any existing job by name before rescheduling, so re-applying this
-- migration cannot leave two of them running.
--
-- Deliberately an existence check rather than `EXCEPTION WHEN OTHERS THEN NULL`
-- around cron.unschedule(). That handler looked tidier and was actively harmful:
-- it swallows ANY failure, so when unschedule broke for an unrelated reason the
-- migration carried on and scheduled a SECOND job. Caught by re-running this
-- migration against a stubbed postgres, which is the only place a duplicate
-- would have shown up before production started checking the catalog twice a day.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'square-catalog-guard-daily') THEN
    PERFORM cron.unschedule('square-catalog-guard-daily');
  END IF;
END;
$$;

SELECT cron.schedule(
  'square-catalog-guard-daily',
  '17 11 * * *',
  $$SELECT public.run_square_catalog_guard_check()$$
);
