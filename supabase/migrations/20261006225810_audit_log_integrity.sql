-- Activity log: who wrote an entry is decided by the database, not the writer;
-- staff actions taken through the service role are attributed; and the tables
-- that grant scope, set prices or hold the books are covered.
-- Security audit 2026-10-06: L14 and M11. BRIEF-sec-staff-boundaries.
--
-- 1. A BEFORE INSERT guard on admin_audit_log.
--
--    Browser inserts. The INSERT policy (20260617072515) pins actor_id to
--    auth.uid() and nothing else, so a staff session could plant an entry with
--    any action, details and actor_email — "tickets.refund by admin@…", say —
--    and the log viewer would show it as fact. The only legitimate browser
--    writer is src/lib/auditClient.ts, which records auth.login and
--    auth.logout about the signed-in user. A direct insert from a session is
--    now held to exactly that: one of those two actions, about the caller,
--    with the caller's email read from auth.users and empty details.
--
--    Everything else (the log_audit_event trigger, the SECURITY DEFINER
--    functions, edge functions inserting as the service role) keeps its row,
--    except that actor_email is always read from auth.users when there is an
--    actor_id. A writer can name an actor; it cannot misspell one.
--
--    Service-role attribution (M11). A staff-gated edge function writes as the
--    service role, so auth.uid() is NULL and log_audit_event recorded refunds,
--    confirms and catalog writes "by nobody". Those functions now send the
--    verified caller's id in an x-kw-actor-id header (_shared/audit.ts,
--    actorHeaders). PostgREST exposes request headers to the transaction as
--    request.headers, so the guard fills a NULL actor from it. It is honoured
--    only when the request's JWT role is service_role: only a holder of the
--    service key can make that claim, and a browser sending the header is
--    ignored.
--
-- 2. log_audit_statement(): one entry per statement, for tables written in bulk.
--    A seat map is a row per seat (hundreds per production or showing), and the
--    financial ledger is imported in slices and cleared wholesale. A row per
--    change would bury a month of real activity under one import. Each entry
--    carries the count and up to 50 of the rows (redacted like every other
--    entry), which for the ordinary small edit is all of them.
--
-- 3. Coverage. Confirmed to exist on a full replay of the migrations:
--      row-level   host_event_assignments  grants a host attendee data
--                  staff_square_links      ties an account to a timecard
--                  production_price_tiers  the price a production's seats sell at
--                  account_mappings, chart_of_accounts, qbo_connection,
--                  payroll_exports         the books and where they post
--                  signing_keys            key rotation; private_key_b64 is
--                                          redacted by audit_is_secret_key
--                                          (`private_key`), asserted in the test
--      statement   production_seat_tiers, showing_seat_tiers, pass_type_showings,
--                  financial_entries
--    qbo_connection holds vault secret ids, not tokens; the ids name a secret
--    without revealing it.

-- ---------------------------------------------------------------------------
-- 1. The guard
-- ---------------------------------------------------------------------------

-- The signed-in caller's own email. Zero-argument on purpose: granting a
-- session "email of any user id" would be a directory of every account.
CREATE OR REPLACE FUNCTION public.audit_caller_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM auth.users WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.audit_caller_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_caller_email() TO authenticated, service_role;

-- Any user's email, for the server-side paths only.
CREATE OR REPLACE FUNCTION public.audit_user_email(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM auth.users WHERE id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.audit_user_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_user_email(uuid) TO service_role;

-- SECURITY INVOKER, deliberately: current_user is how a browser's own INSERT
-- (anon / authenticated) is told apart from one made inside a SECURITY DEFINER
-- function or by the service role. A definer guard would always see its owner.
CREATE OR REPLACE FUNCTION public.admin_audit_log_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_header text;
  v_actor uuid;
  v_email text;
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF NEW.action NOT IN ('auth.login', 'auth.logout') THEN
      RAISE EXCEPTION 'A signed-in session may record only its own sign-in and sign-out'
        USING ERRCODE = '42501';
    END IF;
    NEW.actor_id    := auth.uid();
    NEW.actor_email := public.audit_caller_email();
    NEW.entity_type := 'auth';
    NEW.entity_id   := auth.uid();
    NEW.details     := '{}'::jsonb;
    RETURN NEW;
  END IF;

  -- Server side. Attribute a service-role write to the staff member the edge
  -- function verified, when it said who that was.
  IF NEW.actor_id IS NULL AND auth.role() = 'service_role' THEN
    BEGIN
      v_header := NULLIF(current_setting('request.headers', true), '')::json ->> 'x-kw-actor-id';
    EXCEPTION WHEN others THEN
      v_header := NULL;  -- unparseable headers never fail the audited write
    END;
    v_actor := public.audit_uuid_or_null(v_header);
    IF v_actor IS NOT NULL AND public.audit_user_email(v_actor) IS NOT NULL THEN
      NEW.actor_id := v_actor;
    END IF;
  END IF;

  IF NEW.actor_id IS NOT NULL THEN
    v_email := public.audit_user_email(NEW.actor_id);
    IF v_email IS NOT NULL THEN
      NEW.actor_email := v_email;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.admin_audit_log_guard() IS
  'Browser inserts: auth.login/auth.logout about the caller only. Server inserts: actor_email from auth.users; a NULL actor on a service-role request is taken from the x-kw-actor-id header. Security audit 2026-10-06, L14/M11.';

DROP TRIGGER IF EXISTS admin_audit_log_guard ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_guard
  BEFORE INSERT ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_guard();

-- ---------------------------------------------------------------------------
-- 2. Statement-level entries for bulk-written tables
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_audit_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer;
  v_rows jsonb;
  v_action text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.audit_suppression s
     WHERE s.table_name = TG_TABLE_NAME AND s.expires_at > now()
  ) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO v_count FROM new_rows;
    SELECT jsonb_agg(public.audit_redact(to_jsonb(x))) INTO v_rows
      FROM (SELECT * FROM new_rows LIMIT 50) x;
    v_action := TG_TABLE_NAME || '.create';
  ELSIF TG_OP = 'DELETE' THEN
    SELECT count(*) INTO v_count FROM old_rows;
    SELECT jsonb_agg(public.audit_redact(to_jsonb(x))) INTO v_rows
      FROM (SELECT * FROM old_rows LIMIT 50) x;
    v_action := TG_TABLE_NAME || '.delete';
  ELSE
    -- Updates: the changed keys of each row, old and new, joined on id.
    SELECT count(*) INTO v_count FROM new_rows;
    SELECT jsonb_agg(c) INTO v_rows FROM (
      SELECT jsonb_build_object(
               'id', n.id,
               'changes', public.audit_redact(COALESCE((
                 SELECT jsonb_object_agg(k.key, jsonb_build_object('old', k.oval, 'new', k.nval))
                   FROM (
                     SELECT o2.key, o2.value AS oval, n2.value AS nval
                       FROM jsonb_each(to_jsonb(o)) o2
                       JOIN jsonb_each(to_jsonb(n)) n2 USING (key)
                      WHERE o2.value IS DISTINCT FROM n2.value AND o2.key <> 'updated_at'
                   ) k), '{}'::jsonb))) AS c
        FROM new_rows n JOIN old_rows o ON o.id = n.id
       LIMIT 50
    ) s;
    v_action := TG_TABLE_NAME || '.update';
  END IF;

  IF COALESCE(v_count, 0) = 0 THEN
    RETURN NULL;  -- a statement that matched nothing changed nothing
  END IF;

  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, entity_type, entity_id, details)
  VALUES (
    v_actor, NULL, v_action, TG_TABLE_NAME,
    CASE WHEN v_count = 1 THEN public.audit_uuid_or_null(v_rows -> 0 ->> 'id') END,
    jsonb_build_object('statement', true, 'count', v_count, 'rows', COALESCE(v_rows, '[]'::jsonb),
                       'truncated', v_count > 50)
  );
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.log_audit_statement() IS
  'Audit trigger, one entry per statement with the row count and up to 50 rows. For tables written in bulk (seat maps, the financial ledger).';

REVOKE ALL ON FUNCTION public.log_audit_statement() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Coverage
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  row_tables text[] := ARRAY[
    'host_event_assignments',
    'staff_square_links',
    'production_price_tiers',
    'account_mappings',
    'chart_of_accounts',
    'qbo_connection',
    'payroll_exports',
    'signing_keys'
  ];
  statement_tables text[] := ARRAY[
    'production_seat_tiers',
    'showing_seat_tiers',
    'pass_type_showings',
    'financial_entries'
  ];
BEGIN
  FOREACH t IN ARRAY row_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'audit coverage: table public.% does not exist', t;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I_audit ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.log_audit_event()',
      t, t
    );
  END LOOP;

  -- Transition tables allow one event per trigger, hence three.
  FOREACH t IN ARRAY statement_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'audit coverage: table public.% does not exist', t;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I_audit ON public.%I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I_ins ON public.%I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I_upd ON public.%I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I_del ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER audit_%I_ins AFTER INSERT ON public.%I '
      'REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.log_audit_statement()',
      t, t
    );
    EXECUTE format(
      'CREATE TRIGGER audit_%I_upd AFTER UPDATE ON public.%I '
      'REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.log_audit_statement()',
      t, t
    );
    EXECUTE format(
      'CREATE TRIGGER audit_%I_del AFTER DELETE ON public.%I '
      'REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.log_audit_statement()',
      t, t
    );
  END LOOP;
END $$;
