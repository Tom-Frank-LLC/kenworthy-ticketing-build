-- Activity log: wider coverage, plus the guardrails that make wider coverage safe.
--
-- The log already existed (20260617072515 created the table, 20260617072944 the
-- trigger) and 20260814214233 already made reading it admin-only. What was
-- missing was coverage — the money, config and concessions tables were writing
-- nothing — and three properties that only become problems once coverage grows:
--
--   1. Secrets. rental_requests.invite_token is a capability token: whoever
--      holds it can open a rental contract for signing. film_pass_orders
--      .checkout_idempotency_key is a replay token. Copying either into
--      admin_audit_log.details would turn the audit log into a place where
--      credentials are stored in the clear, readable by every admin. The diff
--      now records that such a field CHANGED without recording what it changed
--      to, and it does so by key name at any depth, so a token nested inside a
--      jsonb column (app_config.value) is caught too.
--
--   2. Non-uuid primary keys. app_config is keyed by `key text`, not `id uuid`.
--      The old trigger read (to_jsonb(NEW)->>'id')::uuid, which for app_config
--      is NULL::uuid — no error, but every settings change would have landed in
--      the log with entity_id null, i.e. "a setting changed, we won't say
--      which". The key now goes into details.entity_key. The uuid read is also
--      shape-checked first, so a future table keyed by bigint or text logs with
--      a null entity_id instead of raising and failing the caller's write.
--
--   3. Bulk writes. square-catalog-sync upserts concession_items one row per
--      HTTP request, and Square's catalog is their whole sales history — the
--      August over-pull moved ~998 rows. Per-row logging would have buried the
--      log under a thousand near-identical entries. Suppression is a table and
--      not a session GUC on purpose: PostgREST gives each of those upserts its
--      own transaction, so SET LOCAL would not survive between them.
--
-- Suppression cannot silently blank the log: audit_bulk_begin writes a
-- ".started" row before it suppresses anything, and every suppression carries
-- an expires_at so a sync that dies mid-run un-suppresses itself.

-- ---------------------------------------------------------------------------
-- 1. Redaction
-- ---------------------------------------------------------------------------

-- Matches by field NAME, never by value — a heuristic on names is stable,
-- whereas sniffing values for things that look like secrets is not. A false
-- positive costs one field of audit detail; a false negative writes a live
-- credential into a table 12,000 rows deep.
CREATE OR REPLACE FUNCTION public.audit_is_secret_key(p_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(coalesce(p_key, '')) ~
    '(secret|token|password|passwd|credential|signature|_key$|api_?key|access_key|private_key)'
    -- `_key$` is what catches api_key, signing_key and secret_key, and erring
    -- towards redaction is right for a credential filter. It also sweeps up
    -- identifiers that merely END in key, and redacting those costs real
    -- information: entity_key is how an app_config entry says WHICH setting
    -- changed. Mirrored in KEY_SUFFIXED_IDENTIFIERS in _shared/audit.ts.
    AND lower(coalesce(p_key, '')) NOT IN ('key', 'entity_key', 'source_key', 'account_source_key');
$$;

COMMENT ON FUNCTION public.audit_is_secret_key(text) IS
  'True when an audit detail field name looks like it holds a credential.';

CREATE OR REPLACE FUNCTION public.audit_redact(p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  k text;
  v jsonb;
  v_out jsonb;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(p_value) = 'object' THEN
    v_out := '{}'::jsonb;
    FOR k, v IN SELECT key, value FROM jsonb_each(p_value) LOOP
      IF public.audit_is_secret_key(k) THEN
        -- A null stays null so "was unset, is now set" is still readable; that
        -- distinction leaks nothing and is often the whole point of the entry.
        v_out := v_out || jsonb_build_object(
          k,
          CASE WHEN v = 'null'::jsonb THEN v ELSE '"[redacted]"'::jsonb END
        );
      ELSE
        v_out := v_out || jsonb_build_object(k, public.audit_redact(v));
      END IF;
    END LOOP;
    RETURN v_out;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    RETURN COALESCE(
      (SELECT jsonb_agg(public.audit_redact(e)) FROM jsonb_array_elements(p_value) e),
      '[]'::jsonb
    );
  ELSE
    RETURN p_value;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.audit_redact(jsonb) IS
  'Replaces credential-shaped fields with "[redacted]" at any depth.';

-- Shape-check before casting. (to_jsonb(NEW)->>''id'')::uuid raises on a table
-- whose id is not a uuid, and a raise inside an AFTER trigger fails the write
-- that triggered it — an audit log that can break the thing it audits.
CREATE OR REPLACE FUNCTION public.audit_uuid_or_null(p_text text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN p_text::uuid
  END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Bulk-write suppression
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_suppression (
  table_name text PRIMARY KEY,
  run_id     uuid        NOT NULL,
  reason     text,
  expires_at timestamptz NOT NULL
);

COMMENT ON TABLE public.audit_suppression IS
  'Tables whose per-row audit trigger is paused for an in-flight bulk import. Rows expire; a crashed importer un-suppresses itself.';

ALTER TABLE public.audit_suppression ENABLE ROW LEVEL SECURITY;
-- No policy and no grant to authenticated: service_role only, reached through
-- audit_bulk_begin/audit_bulk_end. A staff or admin session must not be able to
-- switch off its own audit trail.
GRANT ALL ON public.audit_suppression TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_row jsonb;
  v_entity_id uuid;
  v_entity_key text;
  v_action text;
  v_details jsonb := '{}'::jsonb;
  v_changes jsonb;
BEGIN
  -- A bulk importer holds the floor. It writes its own summary row instead.
  IF EXISTS (
    SELECT 1 FROM public.audit_suppression s
     WHERE s.table_name = TG_TABLE_NAME
       AND s.expires_at > now()
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD);
  ELSE
    v_row := to_jsonb(NEW);
  END IF;

  v_entity_id := public.audit_uuid_or_null(v_row ->> 'id');
  IF v_entity_id IS NULL THEN
    -- Tables keyed by something other than a uuid id (app_config.key). Without
    -- this the entry says only that "a setting" changed.
    v_entity_key := COALESCE(v_row ->> 'id', v_row ->> 'key', v_row ->> 'code', v_row ->> 'slug');
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := TG_TABLE_NAME || '.create';
    v_details := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := TG_TABLE_NAME || '.update';

    IF TG_TABLE_NAME = 'sponsorship_opportunities'
       AND (to_jsonb(NEW) ->> 'is_active') IS DISTINCT FROM (to_jsonb(OLD) ->> 'is_active') THEN
      v_action := CASE WHEN (to_jsonb(NEW) ->> 'is_active')::boolean
                       THEN 'sponsorship_opportunities.publish'
                       ELSE 'sponsorship_opportunities.unpublish' END;
    END IF;

    IF TG_TABLE_NAME = 'tickets'
       AND (to_jsonb(NEW) ->> 'scanned_at') IS DISTINCT FROM (to_jsonb(OLD) ->> 'scanned_at')
       AND (to_jsonb(OLD) ->> 'scanned_at') IS NULL THEN
      v_action := 'tickets.scan';
    END IF;

    SELECT jsonb_object_agg(key, jsonb_build_object('old', o.value, 'new', n.value))
      INTO v_changes
      FROM jsonb_each(to_jsonb(OLD)) o
      JOIN jsonb_each(to_jsonb(NEW)) n USING (key)
     WHERE o.value IS DISTINCT FROM n.value
       AND key NOT IN ('updated_at');
    v_details := jsonb_build_object('changes', COALESCE(v_changes, '{}'::jsonb));
  ELSIF TG_OP = 'DELETE' THEN
    v_action := TG_TABLE_NAME || '.delete';
    v_details := jsonb_build_object('old', to_jsonb(OLD));
  END IF;

  v_details := public.audit_redact(COALESCE(v_details, '{}'::jsonb));
  IF v_entity_key IS NOT NULL THEN
    v_details := v_details || jsonb_build_object('entity_key', v_entity_key);
  END IF;

  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, entity_type, entity_id, details)
  VALUES (v_actor, v_email, v_action, TG_TABLE_NAME, v_entity_id, v_details);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Bulk import API
-- ---------------------------------------------------------------------------

-- Returns the run id. Call audit_bulk_end with it when the import finishes.
-- p_actor_id exists because these are called by edge functions holding the
-- service-role key, where auth.uid() is null and every sync would otherwise be
-- filed under "system". An admin who clicks "Pull from Square" should be named
-- in the log; a webhook or a cron run has no caller and correctly stays system.
CREATE OR REPLACE FUNCTION public.audit_bulk_begin(
  p_tables   text[],
  p_action   text,
  p_details  jsonb DEFAULT '{}'::jsonb,
  p_minutes  integer DEFAULT 10,
  p_actor_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_actor uuid := COALESCE(p_actor_id, auth.uid());
  v_email text;
  t text;
BEGIN
  IF p_tables IS NULL OR array_length(p_tables, 1) IS NULL THEN
    RAISE EXCEPTION 'audit_bulk_begin requires at least one table';
  END IF;

  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  END IF;

  -- Written BEFORE suppression takes effect, so the log always shows where the
  -- gap starts and who opened it. A silent gap would be indistinguishable from
  -- a tampered log.
  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, entity_type, entity_id, details)
  VALUES (
    v_actor, v_email, p_action || '.started', p_tables[1], NULL,
    public.audit_redact(COALESCE(p_details, '{}'::jsonb))
      || jsonb_build_object('run_id', v_run_id, 'tables', to_jsonb(p_tables))
  );

  FOREACH t IN ARRAY p_tables LOOP
    INSERT INTO public.audit_suppression (table_name, run_id, reason, expires_at)
    VALUES (t, v_run_id, p_action, now() + make_interval(mins => greatest(p_minutes, 1)))
    ON CONFLICT (table_name) DO UPDATE
      SET run_id = EXCLUDED.run_id,
          reason = EXCLUDED.reason,
          expires_at = EXCLUDED.expires_at;
  END LOOP;

  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_bulk_end(
  p_run_id   uuid,
  p_action   text,
  p_details  jsonb DEFAULT '{}'::jsonb,
  p_actor_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := COALESCE(p_actor_id, auth.uid());
  v_email text;
  v_tables text[];
BEGIN
  SELECT array_agg(table_name) INTO v_tables
    FROM public.audit_suppression WHERE run_id = p_run_id;

  DELETE FROM public.audit_suppression WHERE run_id = p_run_id;

  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  END IF;

  -- A second row rather than an update of the ".started" one: admin_audit_log
  -- has no UPDATE policy by design (20260814214233) and it should stay that way.
  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, entity_type, entity_id, details)
  VALUES (
    v_actor, v_email, p_action, COALESCE(v_tables[1], 'admin_audit_log'), NULL,
    public.audit_redact(COALESCE(p_details, '{}'::jsonb))
      || jsonb_build_object('run_id', p_run_id)
  );
END;
$$;

-- Earlier signatures, in case a prior revision of this migration was applied.
DROP FUNCTION IF EXISTS public.audit_bulk_begin(text[], text, jsonb, integer);
DROP FUNCTION IF EXISTS public.audit_bulk_end(uuid, text, jsonb);

REVOKE ALL ON FUNCTION public.audit_bulk_begin(text[], text, jsonb, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_bulk_end(uuid, text, jsonb, uuid) FROM PUBLIC;
-- service_role only. Anything reachable from the browser that can pause the
-- audit trigger, or write a row claiming to be someone else, is a hole in the
-- log rather than a feature of it.
GRANT EXECUTE ON FUNCTION public.audit_bulk_begin(text[], text, jsonb, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_bulk_end(uuid, text, jsonb, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Explicit event logging (logins, integration runs, email sends)
-- ---------------------------------------------------------------------------

-- Table triggers only see DB writes. A staff sign-in, a Square pull, an email
-- leaving the building are none of them a row change on an audited table.
--
-- Two callers, two shapes:
--   * service_role edge functions insert directly (RLS does not apply to them).
--   * The browser records its own sign-in and sign-out through the existing
--     INSERT policy, which already demands actor_id = auth.uid() AND a role, so
--     a signed-in staff member can only ever write entries about themselves.

-- Failed sign-ins are the one event the browser cannot record: there is no
-- session, so the INSERT policy rejects it. This runs as definer for anon —
-- and is therefore written so an anonymous caller cannot use it to forge
-- entries. It records nothing unless the address belongs to a real account
-- that actually holds staff or admin, which bounds both the content (an email
-- from auth.users, never caller-supplied text) and the volume (the number of
-- real staff accounts) of what an attacker could push into the log.
CREATE OR REPLACE FUNCTION public.log_failed_staff_login(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
BEGIN
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN;
  END IF;

  SELECT u.id, u.email INTO v_user_id, v_email
    FROM auth.users u
   WHERE lower(u.email) = lower(trim(p_email))
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN;  -- Unknown address. Nothing worth recording, and nothing forgeable.
  END IF;

  IF NOT (public.has_role(v_user_id, 'admin'::app_role)
          OR public.has_role(v_user_id, 'staff'::app_role)) THEN
    RETURN;  -- A member typo is not a security event.
  END IF;

  -- Deliberately rate-limited to one entry per account per minute, so a
  -- password-guessing run against a known staff address cannot itself become a
  -- way to flood the log an admin needs to read.
  IF EXISTS (
    SELECT 1 FROM public.admin_audit_log
     WHERE action = 'auth.login_failed'
       AND entity_id = v_user_id
       AND created_at > now() - interval '1 minute'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, entity_type, entity_id, details)
  VALUES (NULL, v_email, 'auth.login_failed', 'auth', v_user_id, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.log_failed_staff_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_failed_staff_login(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Coverage
-- ---------------------------------------------------------------------------
--
-- Already covered before this migration, left alone: sponsorship_opportunities,
-- showings, movies, events, live_performances, tickets, profiles, user_roles,
-- concession_items, film_pass_types (20260617072944), dvds and dvd_rentals
-- (20260626153407), user_film_passes on UPDATE/DELETE only (20260813000000).
--
-- Not covered, on purpose:
--   * seats — the pre-venue global seat map, superseded by venue_seats and no
--     longer written by anything.
--   * signing_keys — service-role only, and its rows ARE key material.

DO $$
DECLARE
  t text;
  -- Config and money. Every row here is something a person decided.
  full_tables text[] := ARRAY[
    'concession_menus',
    'concession_combo_items',
    'donations',
    'film_pass_orders',
    'rental_requests',
    'rental_invoice_lines',
    'app_config',
    'venues',
    'venue_seats',
    'showing_price_tiers'
  ];
  -- Append-only ledgers: the row IS the record of the sale or the redemption,
  -- and it is written once per transaction at the counter. Logging the inserts
  -- would double the write volume to say what the table already says, and bury
  -- the after-the-fact edit — the one thing here worth an alert — underneath.
  -- Same reasoning as user_film_passes in 20260813000000.
  edit_only_tables text[] := ARRAY[
    'concession_sales',
    'film_pass_redemptions'
  ];
BEGIN
  FOREACH t IN ARRAY full_tables LOOP
    -- Both naming conventions are in use (audit_x from 20260617072944, x_audit
    -- from 20260626153407). Drop both so a table cannot end up double-logged.
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I_audit ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.log_audit_event()',
      t, t
    );
  END LOOP;

  FOREACH t IN ARRAY edit_only_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I_audit ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.log_audit_event()',
      t, t
    );
  END LOOP;
END $$;
