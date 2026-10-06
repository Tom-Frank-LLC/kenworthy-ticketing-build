-- Functions anon and authenticated must not call, revoked from them by name.
-- BRIEF-sec-rls-regressions (audit 2026-10-06 M10, L19).
--
-- `REVOKE … FROM PUBLIC` is not enough on a Supabase project carrying the
-- legacy default ACL (`ALTER DEFAULT PRIVILEGES … GRANT ALL ON FUNCTIONS TO
-- anon, authenticated, service_role`): every function created in public also
-- gets a direct grant to anon and authenticated, and a PUBLIC revoke leaves
-- those standing. Staging does not carry those defaults, so a PUBLIC-only
-- revoke tests clean there and fails open on production. And the reverse: a
-- revoke `FROM anon, authenticated` alone leaves PUBLIC's built-in EXECUTE,
-- which is what happened to resolve_account_id. Every revoke here names all
-- three.
--
-- Sweep (replay of every migration under the legacy ACL; every public function
-- anon can execute, against its callers):
--   audit_bulk_begin / audit_bulk_end  service role only (_shared/audit.ts)  -> fixed here
--   resolve_account_id                 no caller at all                       -> fixed here
--   is_protected_user                  user_roles policies, TO authenticated  -> anon revoked
--   is_host_of / is_host_of_showing    host policies; anon only reached them
--                                      through showings' TO-public SELECT     -> fixed here
--   has_role                           SELECT policies on 17 public tables   -> kept, see below
--   get_rental_request_by_token, get_contract_signature,
--   get_public_availability, showing_availability, showing_ends_at,
--   quote_ticket_order, log_failed_staff_login                               -> intended
--   trigger functions                  not callable outside a trigger         -> inert
--   pure invoker helpers (order_tax_cents, audit_redact, …) run with the
--   caller's own rights                                                       -> harmless
-- The allowlist in supabase/tests/anon_surface/surface.sql is the standing
-- form of this table.

-- ---------------------------------------------------------------------------
-- 1. audit_bulk_begin / audit_bulk_end (M10). Both SECURITY DEFINER; begin
--    switches the audit trigger off for any tables for any number of minutes,
--    end writes an audit row with any text, and both take the actor as an
--    argument. Their one caller is supabase/functions/_shared/audit.ts with
--    the service-role key. Now:
--      - EXECUTE for service_role only, revoked from PUBLIC, anon, authenticated;
--      - inside, refuse anything that is not the service role or a direct
--        database session (migrations, the SQL editor, the tests), so a grant
--        restored by accident still does not open them;
--      - the pause is capped at 60 minutes. Callers ask for 10; an edge
--        function cannot run anywhere near an hour.
--    p_actor_id stays: the service role is the only caller left, and it is how
--    an admin who pressed "Pull from Square" is named in the log.
-- ---------------------------------------------------------------------------
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
  v_actor uuid;
  v_email text;
  t text;
BEGIN
  IF NOT (session_user IN ('postgres', 'supabase_admin')
          OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'audit_bulk_begin is service-role only' USING ERRCODE = '42501';
  END IF;

  IF p_tables IS NULL OR array_length(p_tables, 1) IS NULL THEN
    RAISE EXCEPTION 'audit_bulk_begin requires at least one table';
  END IF;

  v_actor := COALESCE(p_actor_id, auth.uid());
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
    VALUES (t, v_run_id, p_action,
            now() + make_interval(mins => least(greatest(coalesce(p_minutes, 10), 1), 60)))
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
  v_actor uuid;
  v_email text;
  v_tables text[];
BEGIN
  IF NOT (session_user IN ('postgres', 'supabase_admin')
          OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'audit_bulk_end is service-role only' USING ERRCODE = '42501';
  END IF;

  SELECT array_agg(table_name) INTO v_tables
    FROM public.audit_suppression WHERE run_id = p_run_id;

  DELETE FROM public.audit_suppression WHERE run_id = p_run_id;

  v_actor := COALESCE(p_actor_id, auth.uid());
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

REVOKE ALL ON FUNCTION public.audit_bulk_begin(text[], text, jsonb, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_bulk_end(uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_bulk_begin(text[], text, jsonb, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_bulk_end(uuid, text, jsonb, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. resolve_account_id (L19). 20260617053243 revoked it from anon and
--    authenticated but not PUBLIC, so both kept it through PUBLIC. Nothing
--    calls it — not the site, not an edge function, not another function.
--    Service role keeps it for the posting paths it was written for.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.resolve_account_id(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_account_id(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. is_protected_user. Only the admin-scoped user_roles policies call it, and
--    they are TO authenticated, so anon never evaluates it.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_protected_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_protected_user(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. is_host_of / is_host_of_showing (L19). A host is a signed-in account, so
--    every host policy belongs to authenticated; they were written without a
--    TO clause and so applied to PUBLIC. anon evaluated only one of them —
--    "Hosts can view assigned showings", on every public showings read — and
--    for anon auth.uid() is NULL and the answer was always false. With the
--    policies scoped to authenticated, anon needs neither function, and loses
--    the "is this uuid a host of that production" oracle.
--    Postgres checks EXECUTE on every function in a policy expression before
--    it runs, so this order matters: policies first, then the revoke.
--    (Hosts can update tickets for assigned showings was dropped in
--    20261006225933.)
-- ---------------------------------------------------------------------------
ALTER POLICY "Hosts can view assigned showings"   ON public.showings TO authenticated;
ALTER POLICY "Hosts can insert showings for assigned" ON public.showings TO authenticated;
ALTER POLICY "Hosts can update assigned showings" ON public.showings TO authenticated;
ALTER POLICY "Hosts can delete assigned showings" ON public.showings TO authenticated;
ALTER POLICY "Hosts can update assigned events"   ON public.events TO authenticated;
ALTER POLICY "Hosts can update assigned live performances" ON public.live_performances TO authenticated;
ALTER POLICY "Hosts can update assigned movies"   ON public.movies TO authenticated;

REVOKE ALL ON FUNCTION public.is_host_of(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_host_of_showing(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_host_of(uuid, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_host_of_showing(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. has_role stays executable by anon, deliberately. The SELECT policies of
--    17 tables anon reads call it (`is_active = true OR has_role(auth.uid(),
--    'staff')` on every public content table), and Postgres refuses the whole query if the
--    reader lacks EXECUTE on any function in the policy — even when the first
--    branch is already true. Revoking it would turn every public page into a
--    permission error. What it leaks is "is this uuid an admin", and with the
--    staff ids removed from public reads (20261006225932) anon has no uuid to
--    ask about.
-- ---------------------------------------------------------------------------
