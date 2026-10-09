-- MFA enforcement cases (security audit 2026-10-06, M9). Scope: every signed-in
-- session, whatever its role (Tom, 2026-10-08).
-- Run by run.sh after every migration has been replayed. Exits non-zero if any
-- case fails.
--
-- Every principal is tried at aal1 and aal2, with the switch off and on: the
-- database half of the definition of done (a password-only session is refused,
-- an aal2 session works, anon is unaffected). The last case is structural: no
-- policy may grant on auth.uid() by a route the migration doesn't close.
\set ON_ERROR_STOP 1
\pset pager off

CREATE TABLE public.t_results (n serial, name text, pass boolean, detail text);
GRANT ALL ON public.t_results TO PUBLIC;
GRANT ALL ON SEQUENCE public.t_results_n_seq TO PUBLIC;

CREATE FUNCTION public.t_try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM; END $$;
CREATE FUNCTION public.t_count(q text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer; BEGIN EXECUTE q INTO n; RETURN n; EXCEPTION WHEN OTHERS THEN RETURN -1; END $$;
CREATE FUNCTION public.t_text(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; BEGIN EXECUTE q INTO r; RETURN r; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM; END $$;
CREATE FUNCTION public.t_expect(name text, got text, want_prefix text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.t_results (name, pass, detail) VALUES (name, got LIKE want_prefix || '%', got) $$;
CREATE FUNCTION public.t_check(name text, ok boolean, detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.t_results (name, pass, detail) VALUES (name, COALESCE(ok, false), detail) $$;
GRANT EXECUTE ON FUNCTION public.t_try(text), public.t_count(text), public.t_text(text),
  public.t_expect(text, text, text), public.t_check(text, boolean, text) TO PUBLIC;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'patron@x.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'staff@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'admin@x.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'super@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'host@x.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'regular_user'),
  ('00000000-0000-0000-0000-0000000000c1', 'staff'),
  ('00000000-0000-0000-0000-0000000000d1', 'admin'),
  ('00000000-0000-0000-0000-0000000000e1', 'superadmin'),
  ('00000000-0000-0000-0000-0000000000b1', 'host')
ON CONFLICT DO NOTHING;
-- The signup trigger makes each account's profile; make sure, in case it didn't.
INSERT INTO public.profiles (id, email)
  SELECT id, email FROM auth.users ON CONFLICT (id) DO NOTHING;
INSERT INTO public.movies (id, title, is_active) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Showing Film', true),
  ('10000000-0000-0000-0000-000000000002', 'Draft Film', false);
-- On the active film: an UPDATE needs the row visible too, and only active films
-- are visible to a non-admin.
INSERT INTO public.host_event_assignments (user_id, movie_id)
  VALUES ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001');

-- Who is asking, and at what assurance level. p_aal NULL leaves the claim out,
-- as a token minted before Supabase added it would.
CREATE FUNCTION public.t_as(p_uid text, p_role text, p_aal text DEFAULT 'aal1') RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_uid, ''), false),
         set_config('request.jwt.claim.role', p_role, false),
         set_config('request.jwt.claims',
           (jsonb_build_object('role', p_role, 'sub', p_uid)
             || CASE WHEN p_aal IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('aal', p_aal) END)::text,
           false);
$$;
GRANT EXECUTE ON FUNCTION public.t_as(text, text, text) TO PUBLIC;

CREATE FUNCTION public.t_switch(on_ boolean) RETURNS void LANGUAGE sql AS $$
  UPDATE public.app_config SET value = jsonb_build_object('enabled', on_) WHERE key = 'mfa_required' $$;

\set patron '00000000-0000-0000-0000-0000000000a1'
\set staff '00000000-0000-0000-0000-0000000000c1'
\set admin '00000000-0000-0000-0000-0000000000d1'
\set super '00000000-0000-0000-0000-0000000000e1'
\set host '00000000-0000-0000-0000-0000000000b1'
\set assigned '10000000-0000-0000-0000-000000000001'

-- An admin-only read: app_config rows other than the two public keys. As an
-- admin there are several; refused, there are none.
\set admin_read 'SELECT count(*) FROM public.app_config WHERE key NOT IN (''hiring_enabled'', ''site_theme'')'
-- Role rows: superadmins view everyone's; everyone else sees only their own
-- (the signup trigger gives each account a regular_user row as well).
\set roles_read 'SELECT count(*) FROM public.user_roles'
\set others_roles 'SELECT count(*) FROM public.user_roles WHERE user_id <> auth.uid()'
\set own_tier 'SELECT count(*) FROM public.user_roles WHERE user_id = auth.uid() AND role IN (''admin'', ''superadmin'')'

-- Own-row reads: the profile and the host's assignment.
\set own_profile 'SELECT count(*) FROM public.profiles WHERE id = auth.uid()'
\set own_assignments 'SELECT count(*) FROM public.host_event_assignments WHERE user_id = auth.uid()'
\set host_edit 'WITH u AS (UPDATE public.movies SET title = title WHERE id = ''10000000-0000-0000-0000-000000000001'' RETURNING 1) SELECT count(*)::text FROM u'
\set flip_off 'WITH u AS (UPDATE public.app_config SET value = ''{"enabled": false}'' WHERE key = ''mfa_required'' RETURNING 1) SELECT count(*)::text FROM u'

-- =========================================================================
-- Shipped dark: the switch exists, is off, and changes nothing while off
-- =========================================================================
SELECT public.t_check('switch row seeded off',
  (SELECT value = '{"enabled": false}'::jsonb FROM public.app_config WHERE key = 'mfa_required'));

SELECT public.t_as(:'admin', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('off: aal1 admin has_role admin', public.has_role(:'admin', 'admin'));
SELECT public.t_check('off: aal1 admin reads admin-only config', public.t_count(:'admin_read') > 0);
SELECT public.t_check('off: aal1 admin reads own profile', public.t_count(:'own_profile') = 1);
SELECT public.t_check('off: my_mfa_required is false', NOT public.my_mfa_required());
RESET ROLE;
SELECT public.t_as(:'host', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('off: aal1 host is host of the assigned film', public.is_host_of(:'host', NULL, NULL, :'assigned'));
SELECT public.t_expect('off: aal1 host edits the assigned film', public.t_text(:'host_edit'), '1');
RESET ROLE;

-- =========================================================================
-- Switch on: a password-only session acts as nobody, whatever its role
-- =========================================================================
SELECT public.t_switch(true);

SELECT public.t_as(:'admin', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('on: aal1 admin refused admin', NOT public.has_role(:'admin', 'admin'));
SELECT public.t_check('on: aal1 admin refused staff', NOT public.has_role(:'admin', 'staff'));
SELECT public.t_check('on: aal1 admin reads no admin-only config', public.t_count(:'admin_read') = 0,
  public.t_count(:'admin_read')::text);
SELECT public.t_check('on: aal1 admin reads no own profile', public.t_count(:'own_profile') = 0,
  public.t_count(:'own_profile')::text);
SELECT public.t_check('on: aal1 admin still sees own admin row (the client routes on it)',
  public.t_count(:'own_tier') = 1, public.t_count(:'own_tier')::text);
SELECT public.t_check('on: my_mfa_required is true for an admin', public.my_mfa_required());
SELECT public.t_expect('on: aal1 admin cannot turn the switch off', public.t_text(:'flip_off'), '0');
RESET ROLE;

SELECT public.t_as(:'super', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('on: aal1 superadmin refused superadmin', NOT public.has_role(:'super', 'superadmin'));
SELECT public.t_check('on: aal1 superadmin sees nobody else''s role rows', public.t_count(:'others_roles') = 0,
  public.t_count(:'others_roles')::text);
RESET ROLE;

SELECT public.t_as(:'staff', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('on: aal1 staff refused staff', NOT public.has_role(:'staff', 'staff'));
SELECT public.t_check('on: aal1 staff reads no own profile', public.t_count(:'own_profile') = 0);
SELECT public.t_check('on: my_mfa_required is true for staff', public.my_mfa_required());
RESET ROLE;

SELECT public.t_as(:'host', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('on: aal1 host is no longer host of the assigned film', NOT public.is_host_of(:'host', NULL, NULL, :'assigned'));
SELECT public.t_expect('on: aal1 host cannot edit the assigned film', public.t_text(:'host_edit'), '0');
SELECT public.t_check('on: aal1 host reads no own assignment', public.t_count(:'own_assignments') = 0,
  public.t_count(:'own_assignments')::text);
RESET ROLE;

SELECT public.t_as(:'patron', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('on: aal1 patron reads no own profile', public.t_count(:'own_profile') = 0);
SELECT public.t_check('on: aal1 patron still reads the public film list',
  public.t_count('SELECT count(*) FROM public.movies') = 1, public.t_count('SELECT count(*) FROM public.movies')::text);
SELECT public.t_check('on: my_mfa_required is true for a patron', public.my_mfa_required());
RESET ROLE;

-- A token without an aal claim counts as aal1.
SELECT public.t_as(:'staff', 'authenticated', NULL);
SET ROLE authenticated;
SELECT public.t_check('on: missing aal claim is refused like aal1', NOT public.has_role(:'staff', 'staff'));
RESET ROLE;

-- aal2: everything as before.
SELECT public.t_as(:'admin', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_check('on: aal2 admin has_role admin', public.has_role(:'admin', 'admin'));
SELECT public.t_check('on: aal2 admin reads admin-only config', public.t_count(:'admin_read') > 0);
SELECT public.t_check('on: aal2 admin reads own profile', public.t_count(:'own_profile') = 1);
RESET ROLE;
SELECT public.t_as(:'super', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_check('on: aal2 superadmin sees other people''s role rows', public.t_count(:'others_roles') > 0);
RESET ROLE;
SELECT public.t_as(:'staff', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_check('on: aal2 staff has_role staff', public.has_role(:'staff', 'staff'));
RESET ROLE;
SELECT public.t_as(:'host', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_check('on: aal2 host is host of the assigned film', public.is_host_of(:'host', NULL, NULL, :'assigned'));
SELECT public.t_expect('on: aal2 host edits the assigned film', public.t_text(:'host_edit'), '1');
SELECT public.t_check('on: aal2 host reads own assignment', public.t_count(:'own_assignments') = 1);
RESET ROLE;

-- Anon: public reads unchanged, and none of the new functions reachable.
SELECT public.t_as(NULL, 'anon', NULL);
SET ROLE anon;
SELECT public.t_check('on: anon reads the active film only', public.t_count('SELECT count(*) FROM public.movies') = 1,
  public.t_count('SELECT count(*) FROM public.movies')::text);
SELECT public.t_check('on: anon has_role still answers about others (unchanged)', public.has_role(:'admin', 'admin'));
SELECT public.t_expect('anon cannot call role_gate',
  public.t_try(format('SELECT public.role_gate(%L, ''admin'', ''aal2'')', :'admin')), '42501');
SELECT public.t_expect('anon cannot call session_ok', public.t_try('SELECT public.session_ok()'), '42501');
SELECT public.t_expect('anon cannot call mfa_switch_on', public.t_try('SELECT public.mfa_switch_on()'), '42501');
SELECT public.t_expect('anon cannot call my_mfa_required', public.t_try('SELECT public.my_mfa_required()'), '42501');
RESET ROLE;

SELECT public.t_as(:'staff', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_expect('authenticated cannot call role_gate',
  public.t_try(format('SELECT public.role_gate(%L, ''staff'', ''aal2'')', :'staff')), '42501');
RESET ROLE;

-- The edge functions' gate, as service_role.
SELECT public.t_as(NULL, 'service_role', NULL);
SET ROLE service_role;
SELECT public.t_expect('gate: aal1 admin', public.role_gate(:'admin', 'admin', 'aal1'), 'mfa_required');
SELECT public.t_expect('gate: aal1 staff', public.role_gate(:'staff', 'staff', 'aal1'), 'mfa_required');
SELECT public.t_expect('gate: aal1 host', public.role_gate(:'host', 'host', 'aal1'), 'mfa_required');
SELECT public.t_expect('gate: no aal is aal1', public.role_gate(:'staff', 'staff', NULL), 'mfa_required');
SELECT public.t_expect('gate: aal2 admin', public.role_gate(:'admin', 'admin', 'aal2'), 'ok');
SELECT public.t_expect('gate: aal2 staff', public.role_gate(:'staff', 'staff', 'aal2'), 'ok');
SELECT public.t_expect('gate: staff asking admin is forbidden, not a code prompt',
  public.role_gate(:'staff', 'admin', 'aal1'), 'forbidden');
SELECT public.t_expect('gate: patron', public.role_gate(:'patron', 'staff', 'aal1'), 'forbidden');
SELECT public.t_expect('gate: unknown user', public.role_gate('00000000-0000-0000-0000-00000000ffff', 'staff', 'aal2'), 'forbidden');
SELECT public.t_check('service_role has_role is the plain role test', public.has_role(:'staff', 'staff'));
RESET ROLE;

-- aal2 superadmin can turn it off: the rollback works from the app's own session.
SELECT public.t_as(:'super', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_expect('on: aal2 superadmin can turn the switch off', public.t_text(:'flip_off'), '1');
RESET ROLE;

-- =========================================================================
-- Switched back off: the rollback restores everything at once
-- =========================================================================
SELECT public.t_as(:'staff', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('off again: aal1 staff has_role staff', public.has_role(:'staff', 'staff'));
SELECT public.t_check('off again: aal1 staff reads own profile', public.t_count(:'own_profile') = 1);
RESET ROLE;
SELECT public.t_as(NULL, 'service_role', NULL);
SET ROLE service_role;
SELECT public.t_expect('off again: gate lets an aal1 admin in', public.role_gate(:'admin', 'admin', 'aal1'), 'ok');
RESET ROLE;

-- =========================================================================
-- Structural: every policy that grants on the caller's identity is closed.
-- =========================================================================
-- A permissive policy whose expression still mentions auth.uid() / jwt() /
-- email() once the gated calls (has_role and is_host_of*, both with
-- auth.uid() as subject) are taken out must sit on a table carrying the
-- restrictive "Signed-in sessions need their code" policy, or be one of the
-- two exceptions the migration names. A new policy granting on auth.uid()
-- some other way fails here, not in production.
SELECT public.t_check('every own-row grant is behind the code',
  NOT EXISTS (
    SELECT 1 FROM pg_policies p
     WHERE p.schemaname IN ('public', 'storage')
       AND p.permissive = 'PERMISSIVE'
       AND regexp_replace(regexp_replace(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
             'has_role\(auth\.uid\(\),', 'HR(', 'g'),
             'is_host_of(_showing)?\(auth\.uid\(\),', 'IHO(', 'g') ~ 'auth\.(uid|jwt|email)\(\)'
       AND NOT EXISTS (SELECT 1 FROM pg_policies r
                        WHERE r.schemaname = p.schemaname AND r.tablename = p.tablename
                          AND r.permissive = 'RESTRICTIVE' AND r.policyname = 'Signed-in sessions need their code')
       AND (p.tablename, p.policyname) NOT IN (
             ('user_roles', 'Users can view own roles'),
             ('admin_audit_log', 'Admins and staff can insert audit entries as themselves'))
  ),
  (SELECT string_agg(p.tablename || ': ' || p.policyname, '; ') FROM pg_policies p
    WHERE p.schemaname IN ('public', 'storage') AND p.permissive = 'PERMISSIVE'
      AND regexp_replace(regexp_replace(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
            'has_role\(auth\.uid\(\),', 'HR(', 'g'),
            'is_host_of(_showing)?\(auth\.uid\(\),', 'IHO(', 'g') ~ 'auth\.(uid|jwt|email)\(\)'
      AND NOT EXISTS (SELECT 1 FROM pg_policies r
                       WHERE r.schemaname = p.schemaname AND r.tablename = p.tablename
                         AND r.permissive = 'RESTRICTIVE' AND r.policyname = 'Signed-in sessions need their code')
      AND (p.tablename, p.policyname) NOT IN (
            ('user_roles', 'Users can view own roles'),
            ('admin_audit_log', 'Admins and staff can insert audit entries as themselves'))));

-- The per-row checks call no other function of ours. A nested SECURITY DEFINER
-- call can't be inlined, and in has_role it made an admin's full showings read
-- 14x slower on staging (20261009003240).
SELECT public.t_check('has_role and the host checks inline the guard',
  NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('has_role', 'is_host_of', 'is_host_of_showing')
               AND pronamespace = 'public'::regnamespace
               AND prosrc ~ '(session_ok|mfa_switch_on|mfa_blocks)\('));

-- has_role keeps the shape the rest of the schema depends on.
SELECT public.t_check('has_role is still STABLE SECURITY DEFINER',
  (SELECT provolatile = 's' AND prosecdef FROM pg_proc WHERE oid = 'public.has_role(uuid, app_role)'::regprocedure));

-- =========================================================================
\echo
SELECT n, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS verdict, name, detail FROM public.t_results ORDER BY n;
DO $$
DECLARE f integer; t integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT pass), count(*) INTO f, t FROM public.t_results;
  RAISE NOTICE '% of % MFA cases passed', t - f, t;
  IF f > 0 THEN RAISE EXCEPTION '% case(s) failed', f; END IF;
END $$;
