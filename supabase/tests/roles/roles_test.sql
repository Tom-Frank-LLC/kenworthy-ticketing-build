\set ON_ERROR_STOP on
\pset pager off

-- Actors and targets. Every uuid is fixed so a case can name it.
--   S  superadmin              A  admin (the actor under test)   A2 a second admin
--   T  staff-only              H  host-only                      R  regular user
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'super@kenworthy.org'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'admin@kenworthy.org'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'admin2@kenworthy.org'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'staff@kenworthy.org'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'host@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'buyer@example.com');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'superadmin'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'regular_user'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'regular_user'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'admin'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'staff'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'staff'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'regular_user'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'host'),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'regular_user');

\set S 'aaaaaaaa-0000-0000-0000-000000000001'
\set A 'aaaaaaaa-0000-0000-0000-000000000002'
\set A2 'aaaaaaaa-0000-0000-0000-000000000003'
\set T 'aaaaaaaa-0000-0000-0000-000000000004'
\set H 'aaaaaaaa-0000-0000-0000-000000000005'
\set R 'aaaaaaaa-0000-0000-0000-000000000006'

\echo '=== is_protected_user: admin and superadmin are protected, nobody else is ==='
SELECT public.check('protected: superadmin', 'true',  public.is_protected_user(:'S')::text);
SELECT public.check('protected: admin',      'true',  public.is_protected_user(:'A')::text);
SELECT public.check('protected: staff',      'false', public.is_protected_user(:'T')::text);
SELECT public.check('protected: host',       'false', public.is_protected_user(:'H')::text);
SELECT public.check('protected: regular',    'false', public.is_protected_user(:'R')::text);
SELECT public.check('protected: null',       'false', public.is_protected_user(NULL)::text);

-- Everything from here runs as PostgREST would run it.
SET ROLE authenticated;

\echo '=== Admin may grant the lower roles to unprotected users ==='
SELECT public.check('A grants staff to R',         'allowed', public.probe_insert(:'A', :'R', 'staff'));
SELECT public.check('A grants host to R',          'allowed', public.probe_insert(:'A', :'R', 'host'));
SELECT public.check('A grants regular_user to H',  'allowed', public.probe_insert(:'A', :'H', 'regular_user'));
SELECT public.check('A grants staff to H',         'allowed', public.probe_insert(:'A', :'H', 'staff'));

\echo '=== Admin may never mint admin or superadmin, for anyone ==='
SELECT public.check('A grants admin to R',         'denied', public.probe_insert(:'A', :'R', 'admin'));
SELECT public.check('A grants superadmin to R',    'denied', public.probe_insert(:'A', :'R', 'superadmin'));
SELECT public.check('A grants admin to T',         'denied', public.probe_insert(:'A', :'T', 'admin'));
SELECT public.check('A grants superadmin to self', 'denied', public.probe_insert(:'A', :'A', 'superadmin'));

\echo '=== Admin may not touch a protected user, including themselves ==='
SELECT public.check('A grants staff to S',         'denied', public.probe_insert(:'A', :'S', 'staff'));
SELECT public.check('A grants host to A2',         'denied', public.probe_insert(:'A', :'A2', 'host'));
SELECT public.check('A grants staff to self',      'denied', public.probe_insert(:'A', :'A', 'staff'));
SELECT public.check('A grants host to self',       'denied', public.probe_insert(:'A', :'A', 'host'));

\echo '=== Admin may revoke the lower roles from unprotected users ==='
SELECT public.check('A revokes staff from T',        'allowed', public.probe_delete(:'A', :'T', 'staff'));
SELECT public.check('A revokes regular_user from R', 'allowed', public.probe_delete(:'A', :'R', 'regular_user'));
SELECT public.check('A revokes host from H',         'allowed', public.probe_delete(:'A', :'H', 'host'));

\echo '=== Admin may not revoke anything from a protected user ==='
SELECT public.check('A revokes superadmin from S',    'denied', public.probe_delete(:'A', :'S', 'superadmin'));
SELECT public.check('A revokes regular_user from S',  'denied', public.probe_delete(:'A', :'S', 'regular_user'));
SELECT public.check('A revokes admin from A2',        'denied', public.probe_delete(:'A', :'A2', 'admin'));
SELECT public.check('A revokes staff from A2',        'denied', public.probe_delete(:'A', :'A2', 'staff'));
SELECT public.check('A revokes admin from self',      'denied', public.probe_delete(:'A', :'A', 'admin'));
SELECT public.check('A revokes regular_user from self','denied', public.probe_delete(:'A', :'A', 'regular_user'));

\echo '=== UPDATE: the host upsert works for admins; rewriting a row upward does not ==='
SELECT public.check('A upserts host for H (conflict path)', 'allowed', public.probe_upsert_host(:'A', :'H'));
SELECT public.check('A upserts host for R (insert path)',   'allowed', public.probe_upsert_host(:'A', :'R'));
SELECT public.check('A upserts host for A2',                'denied',  public.probe_upsert_host(:'A', :'A2'));
SELECT public.check('A upserts host for self',              'denied',  public.probe_upsert_host(:'A', :'A'));
SELECT public.check('A rewrites T staff -> admin',          'denied',  public.probe_update(:'A', :'T', 'staff', :'T', 'admin'));
SELECT public.check('A rewrites T staff -> S staff',        'denied',  public.probe_update(:'A', :'T', 'staff', :'S', 'staff'));
SELECT public.check('A rewrites A2 staff -> host',          'denied',  public.probe_update(:'A', :'A2', 'staff', :'A2', 'host'));
SELECT public.check('A rewrites T staff -> host',           'allowed', public.probe_update(:'A', :'T', 'staff', :'T', 'host'));

\echo '=== Staff and regular users still get nothing ==='
SELECT public.check('T grants staff to R',    'denied', public.probe_insert(:'T', :'R', 'staff'));
SELECT public.check('T grants admin to self', 'denied', public.probe_insert(:'T', :'T', 'admin'));
SELECT public.check('T revokes staff from R', 'denied', public.probe_delete(:'T', :'H', 'host'));
SELECT public.check('R grants admin to self', 'denied', public.probe_insert(:'R', :'R', 'admin'));
SELECT public.check('R grants staff to self', 'denied', public.probe_insert(:'R', :'R', 'staff'));
SELECT public.check('R revokes own regular_user', 'denied', public.probe_delete(:'R', :'R', 'regular_user'));

\echo '=== Superadmin is unchanged ==='
SELECT public.check('S grants admin to R',        'allowed', public.probe_insert(:'S', :'R', 'admin'));
SELECT public.check('S grants superadmin to R',   'allowed', public.probe_insert(:'S', :'R', 'superadmin'));
SELECT public.check('S grants staff to A',        'allowed', public.probe_insert(:'S', :'A', 'staff'));
SELECT public.check('S revokes admin from A2',    'allowed', public.probe_delete(:'S', :'A2', 'admin'));
SELECT public.check('S revokes staff from A2',    'allowed', public.probe_delete(:'S', :'A2', 'staff'));
SELECT public.check('S upserts host for A2',      'allowed', public.probe_upsert_host(:'S', :'A2'));

\echo '=== Visibility: admins see every row, staff see only their own ==='
SELECT public.check('A sees all 10 rows', '10', public.visible_count(:'A')::text);
SELECT public.check('S sees all 10 rows', '10', public.visible_count(:'S')::text);
SELECT public.check('T sees own 2 rows',  '2',  public.visible_count(:'T')::text);
SELECT public.check('R sees own 1 row',   '1',  public.visible_count(:'R')::text);

RESET ROLE;

\echo '=== Fixture untouched by the probes ==='
SELECT public.check('fixture still has 10 rows', '10', (SELECT count(*) FROM public.user_roles)::text);

\echo '=== Results ==='
SELECT n, name, expected, got, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS verdict FROM public.results ORDER BY n;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM public.results;

DO $$
DECLARE f int;
BEGIN
  SELECT count(*) INTO f FROM public.results WHERE NOT pass;
  IF f > 0 THEN RAISE EXCEPTION '% case(s) failed', f; END IF;
END $$;
