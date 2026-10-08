-- Admin MFA enforcement cases (security audit 2026-10-06, M9).
-- Run by run.sh after every migration has been replayed. Exits non-zero if any
-- case fails.
--
-- Every principal is tried at aal1 and aal2, with the switch off and on: the
-- database half of the brief's definition of done ("an aal1 admin token is
-- refused, an aal2 token works, staff and anon unaffected").
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
  ('00000000-0000-0000-0000-0000000000e1', 'super@x.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'regular_user'),
  ('00000000-0000-0000-0000-0000000000c1', 'staff'),
  ('00000000-0000-0000-0000-0000000000d1', 'admin'),
  ('00000000-0000-0000-0000-0000000000e1', 'superadmin')
ON CONFLICT DO NOTHING;
INSERT INTO public.movies (id, title, is_active) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Showing Film', true),
  ('10000000-0000-0000-0000-000000000002', 'Draft Film', false);

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
  UPDATE public.app_config SET value = jsonb_build_object('enabled', on_) WHERE key = 'mfa_required_for_admins' $$;

\set patron '00000000-0000-0000-0000-0000000000a1'
\set staff '00000000-0000-0000-0000-0000000000c1'
\set admin '00000000-0000-0000-0000-0000000000d1'
\set super '00000000-0000-0000-0000-0000000000e1'

-- An admin-only read: app_config rows other than the two public keys. As an
-- admin there are several; refused, there are none.
\set admin_read 'SELECT count(*) FROM public.app_config WHERE key NOT IN (''hiring_enabled'', ''site_theme'')'
-- Role rows: superadmins view everyone's; everyone else sees only their own
-- (the signup trigger gives each account a regular_user row as well).
\set roles_read 'SELECT count(*) FROM public.user_roles'
\set others_roles 'SELECT count(*) FROM public.user_roles WHERE user_id <> auth.uid()'
\set own_tier 'SELECT count(*) FROM public.user_roles WHERE user_id = auth.uid() AND role IN (''admin'', ''superadmin'')'

-- =========================================================================
-- Shipped dark: the switch exists, is off, and changes nothing while off
-- =========================================================================
SELECT public.t_check('switch row seeded off',
  (SELECT value = '{"enabled": false}'::jsonb FROM public.app_config WHERE key = 'mfa_required_for_admins'));

SELECT public.t_as(:'admin', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('off: aal1 admin has_role admin', public.has_role(:'admin', 'admin'));
SELECT public.t_check('off: aal1 admin has_role staff', public.has_role(:'admin', 'staff'));
SELECT public.t_check('off: aal1 admin reads admin-only config', public.t_count(:'admin_read') > 0);
SELECT public.t_check('off: my_mfa_required is false', NOT public.my_mfa_required());
RESET ROLE;

-- =========================================================================
-- Switch on
-- =========================================================================
SELECT public.t_switch(true);

-- aal1 admin: refused at every level, staff included (all-or-nothing).
SELECT public.t_as(:'admin', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('on: aal1 admin refused admin', NOT public.has_role(:'admin', 'admin'));
SELECT public.t_check('on: aal1 admin refused staff too', NOT public.has_role(:'admin', 'staff'));
SELECT public.t_check('on: aal1 admin reads no admin-only config', public.t_count(:'admin_read') = 0,
  public.t_count(:'admin_read')::text);
SELECT public.t_check('on: aal1 admin still sees own admin row (the client needs it to route)',
  public.t_count(:'own_tier') = 1, public.t_count(:'own_tier')::text);
SELECT public.t_check('on: my_mfa_required is true for an admin', public.my_mfa_required());
SELECT public.t_expect('on: aal1 admin cannot turn the switch off',
  public.t_text($q$WITH u AS (UPDATE public.app_config SET value = '{"enabled": false}' WHERE key = 'mfa_required_for_admins' RETURNING 1) SELECT count(*)::text FROM u$q$),
  '0');
RESET ROLE;

-- aal1 superadmin: refused too, and cannot read every role row.
SELECT public.t_as(:'super', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('on: aal1 superadmin refused superadmin', NOT public.has_role(:'super', 'superadmin'));
SELECT public.t_check('on: aal1 superadmin refused staff', NOT public.has_role(:'super', 'staff'));
SELECT public.t_check('on: aal1 superadmin sees nobody else''s role rows', public.t_count(:'others_roles') = 0,
  public.t_count(:'others_roles')::text);
SELECT public.t_check('on: aal1 superadmin still sees own superadmin row', public.t_count(:'own_tier') = 1,
  public.t_count(:'own_tier')::text);
RESET ROLE;

-- A token without an aal claim counts as aal1.
SELECT public.t_as(:'admin', 'authenticated', NULL);
SET ROLE authenticated;
SELECT public.t_check('on: missing aal claim is refused like aal1', NOT public.has_role(:'admin', 'admin'));
RESET ROLE;

-- aal2 admin and superadmin: everything as before.
SELECT public.t_as(:'admin', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_check('on: aal2 admin has_role admin', public.has_role(:'admin', 'admin'));
SELECT public.t_check('on: aal2 admin has_role staff', public.has_role(:'admin', 'staff'));
SELECT public.t_check('on: aal2 admin reads admin-only config', public.t_count(:'admin_read') > 0);
RESET ROLE;
SELECT public.t_as(:'super', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_check('on: aal2 superadmin has_role superadmin', public.has_role(:'super', 'superadmin'));
SELECT public.t_check('on: aal2 superadmin sees other people''s role rows', public.t_count(:'others_roles') > 0,
  public.t_count(:'others_roles')::text);
RESET ROLE;

-- Staff at aal1: out of scope, unaffected.
SELECT public.t_as(:'staff', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('on: aal1 staff has_role staff', public.has_role(:'staff', 'staff'));
SELECT public.t_check('on: aal1 staff still not admin', NOT public.has_role(:'staff', 'admin'));
SELECT public.t_check('on: my_mfa_required is false for staff', NOT public.my_mfa_required());
RESET ROLE;

-- A patron session: unaffected.
SELECT public.t_as(:'patron', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('on: patron reads the active film', public.t_count('SELECT count(*) FROM public.movies') = 1,
  public.t_count('SELECT count(*) FROM public.movies')::text);
SELECT public.t_check('on: my_mfa_required is false for a patron', NOT public.my_mfa_required());
RESET ROLE;

-- Anon: public reads unchanged, and none of the new functions reachable.
SELECT public.t_as(NULL, 'anon', NULL);
SET ROLE anon;
SELECT public.t_check('on: anon reads the active film only', public.t_count('SELECT count(*) FROM public.movies') = 1,
  public.t_count('SELECT count(*) FROM public.movies')::text);
SELECT public.t_check('on: anon has_role still answers about others (unchanged)', public.has_role(:'admin', 'admin'));
SELECT public.t_expect('anon cannot call role_gate',
  public.t_try(format('SELECT public.role_gate(%L, ''admin'', ''aal2'')', :'admin')), '42501');
SELECT public.t_expect('anon cannot call mfa_blocks',
  public.t_try(format('SELECT public.mfa_blocks(%L, ''aal1'')', :'admin')), '42501');
SELECT public.t_expect('anon cannot call my_mfa_required', public.t_try('SELECT public.my_mfa_required()'), '42501');
RESET ROLE;

-- Signed in, but not the server: role_gate and mfa_blocks stay out of reach.
SELECT public.t_as(:'staff', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_expect('authenticated cannot call role_gate',
  public.t_try(format('SELECT public.role_gate(%L, ''staff'', ''aal2'')', :'staff')), '42501');
SELECT public.t_expect('authenticated cannot call mfa_blocks',
  public.t_try(format('SELECT public.mfa_blocks(%L, ''aal1'')', :'admin')), '42501');
RESET ROLE;

-- The edge functions' gate, as service_role.
SELECT public.t_as(NULL, 'service_role', NULL);
SET ROLE service_role;
SELECT public.t_expect('gate: aal1 admin asking admin', public.role_gate(:'admin', 'admin', 'aal1'), 'mfa_required');
SELECT public.t_expect('gate: aal1 admin asking staff', public.role_gate(:'admin', 'staff', 'aal1'), 'mfa_required');
SELECT public.t_expect('gate: no aal is aal1', public.role_gate(:'admin', 'admin', NULL), 'mfa_required');
SELECT public.t_expect('gate: aal2 admin', public.role_gate(:'admin', 'admin', 'aal2'), 'ok');
SELECT public.t_expect('gate: aal1 superadmin', public.role_gate(:'super', 'superadmin', 'aal1'), 'mfa_required');
SELECT public.t_expect('gate: aal2 superadmin', public.role_gate(:'super', 'superadmin', 'aal2'), 'ok');
SELECT public.t_expect('gate: aal1 staff asking staff', public.role_gate(:'staff', 'staff', 'aal1'), 'ok');
SELECT public.t_expect('gate: staff asking admin is forbidden, not a code prompt',
  public.role_gate(:'staff', 'admin', 'aal1'), 'forbidden');
SELECT public.t_expect('gate: aal1 admin asking superadmin is forbidden first',
  public.role_gate(:'admin', 'superadmin', 'aal1'), 'forbidden');
SELECT public.t_expect('gate: patron', public.role_gate(:'patron', 'staff', 'aal2'), 'forbidden');
SELECT public.t_expect('gate: unknown user', public.role_gate('00000000-0000-0000-0000-00000000ffff', 'staff', 'aal2'), 'forbidden');
SELECT public.t_check('service_role has_role is the plain role test', public.has_role(:'admin', 'admin'));
RESET ROLE;

-- aal2 superadmin can turn it off: the rollback works from the app's own session.
SELECT public.t_as(:'super', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_expect('on: aal2 superadmin can turn the switch off',
  public.t_text($q$WITH u AS (UPDATE public.app_config SET value = '{"enabled": false}' WHERE key = 'mfa_required_for_admins' RETURNING 1) SELECT count(*)::text FROM u$q$),
  '1');
RESET ROLE;

-- =========================================================================
-- Switched back off: the rollback restores everything at once
-- =========================================================================
SELECT public.t_as(:'admin', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('off again: aal1 admin has_role admin', public.has_role(:'admin', 'admin'));
RESET ROLE;
SELECT public.t_as(NULL, 'service_role', NULL);
SET ROLE service_role;
SELECT public.t_expect('off again: gate lets an aal1 admin in', public.role_gate(:'admin', 'admin', 'aal1'), 'ok');
RESET ROLE;

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
  RAISE NOTICE '% of % admin-MFA cases passed', t - f, t;
  IF f > 0 THEN RAISE EXCEPTION '% case(s) failed', f; END IF;
END $$;
