-- Contracts cases: who can reach blank_contracts / contract_versions / the
-- signed-contracts bucket, and that every change of terms and every signing
-- leaves exactly one version. Run by run.sh after the full replay.
\set ON_ERROR_STOP 1
\pset pager off

CREATE TABLE public.t_results (n serial, name text, pass boolean, detail text);
GRANT ALL ON public.t_results TO PUBLIC;
GRANT ALL ON SEQUENCE public.t_results_n_seq TO PUBLIC;
CREATE FUNCTION public.t_try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM; END $$;
CREATE FUNCTION public.t_count(q text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer; BEGIN EXECUTE q INTO n; RETURN n; EXCEPTION WHEN OTHERS THEN RETURN -1; END $$;
CREATE FUNCTION public.t_expect(name text, got text, want_prefix text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.t_results (name, pass, detail) VALUES (name, got LIKE want_prefix || '%', got) $$;
CREATE FUNCTION public.t_check(name text, ok boolean, detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.t_results (name, pass, detail) VALUES (name, COALESCE(ok, false), detail) $$;
GRANT EXECUTE ON FUNCTION public.t_try(text), public.t_count(text), public.t_expect(text, text, text),
  public.t_check(text, boolean, text) TO PUBLIC;
CREATE FUNCTION public.t_as(p_uid text, p_role text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_uid, ''), false),
         set_config('request.jwt.claim.role', p_role, false),
         set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', p_uid)::text, false);
$$;
GRANT EXECUTE ON FUNCTION public.t_as(text, text) TO PUBLIC;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'patron@x.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'staff@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'admin@x.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'staff'),
  ('00000000-0000-0000-0000-0000000000d1', 'admin')
ON CONFLICT DO NOTHING;
INSERT INTO public.rental_requests (id, event_title, applicant_name, email, proposed_date)
  VALUES ('30000000-0000-0000-0000-000000000001', 'Harvest Gala', 'Ada Lovelace', 'ada@x.test', '2026-11-14');
INSERT INTO storage.objects (bucket_id, name)
  VALUES ('signed-contracts', '30000000-0000-0000-0000-000000000001/abc.pdf');

\set patron '00000000-0000-0000-0000-0000000000a1'
\set staff '00000000-0000-0000-0000-0000000000c1'
\set admin '00000000-0000-0000-0000-0000000000d1'

-- =========================================================================
-- Admin writes: a blank, and a request's terms
-- =========================================================================
SELECT public.t_as(:'admin', 'authenticated');
SET ROLE authenticated;

SELECT public.t_expect('admin: creates a blank contract',
  public.t_try($q$INSERT INTO public.blank_contracts (id, title, event_date, fields)
    VALUES ('40000000-0000-0000-0000-000000000001', 'Recital', '2026-11-20', '{"name":"Jane"}')$q$), 'ok');
SELECT public.t_expect('admin: changes its fields',
  public.t_try($q$UPDATE public.blank_contracts SET fields = '{"name":"Jane Doe"}' WHERE id = '40000000-0000-0000-0000-000000000001'$q$), 'ok');
SELECT public.t_expect('admin: renames it, fields unchanged',
  public.t_try($q$UPDATE public.blank_contracts SET title = 'Piano recital', fields = '{"name":"Jane Doe"}' WHERE id = '40000000-0000-0000-0000-000000000001'$q$), 'ok');
SELECT public.t_expect('admin: saves a request contract',
  public.t_try($q$UPDATE public.rental_requests SET contract_data = '{"hourly_rate":180}' WHERE id = '30000000-0000-0000-0000-000000000001'$q$), 'ok');
SELECT public.t_expect('admin: saves it again unchanged',
  public.t_try($q$UPDATE public.rental_requests SET contract_data = '{"hourly_rate":180}' WHERE id = '30000000-0000-0000-0000-000000000001'$q$), 'ok');
SELECT public.t_expect('admin: changes only the request status',
  public.t_try($q$UPDATE public.rental_requests SET status = 'approved' WHERE id = '30000000-0000-0000-0000-000000000001'$q$), 'ok');
SELECT public.t_expect('admin: cannot write a version directly',
  public.t_try($q$INSERT INTO public.contract_versions (blank_contract_id, event) VALUES ('40000000-0000-0000-0000-000000000001', 'saved')$q$), '42501');
SELECT public.t_expect('admin: cannot rewrite history',
  public.t_try($q$UPDATE public.contract_versions SET contract_data = '{}'$q$), '42501');
SELECT public.t_expect('admin: cannot erase history',
  public.t_try($q$DELETE FROM public.contract_versions$q$), '42501');
RESET ROLE;

-- sign-contract: the service role, after uploading the file.
SELECT public.t_as(NULL, 'service_role');
SET ROLE service_role;
SELECT public.t_expect('service role: records a signing',
  public.t_try($q$UPDATE public.rental_requests SET signed_at = now(), signed_by = '00000000-0000-0000-0000-0000000000d1',
    signed_pdf_sha256 = 'abc', signed_pdf_path = '30000000-0000-0000-0000-000000000001/abc.pdf', contract_status = 'signed'
    WHERE id = '30000000-0000-0000-0000-000000000001'$q$), 'ok');
RESET ROLE;

-- =========================================================================
-- What history holds
-- =========================================================================
SELECT public.t_check('blank: one version per change of fields (insert + 1 change; a rename is not one)',
  (SELECT count(*) FROM public.contract_versions WHERE blank_contract_id = '40000000-0000-0000-0000-000000000001') = 2);
SELECT public.t_check('blank: versions name the admin and carry the fields',
  (SELECT bool_and(saved_by = '00000000-0000-0000-0000-0000000000d1' AND event = 'saved' AND contract_data ? 'name')
     FROM public.contract_versions WHERE blank_contract_id = '40000000-0000-0000-0000-000000000001'));
SELECT public.t_check('request: one saved + one signed (unchanged save and status change write none)',
  (SELECT array_agg(event ORDER BY saved_at, event DESC) FROM public.contract_versions
    WHERE rental_request_id = '30000000-0000-0000-0000-000000000001') = ARRAY['saved', 'signed'],
  (SELECT array_agg(event ORDER BY saved_at)::text FROM public.contract_versions WHERE rental_request_id = '30000000-0000-0000-0000-000000000001'));
SELECT public.t_check('request: the saved version snapshots what the contract prints from the request',
  (SELECT request_snapshot->>'applicant_name' = 'Ada Lovelace' AND request_snapshot->>'proposed_date' = '2026-11-14'
          AND NOT request_snapshot ? 'invite_token' AND saved_by = '00000000-0000-0000-0000-0000000000d1'
     FROM public.contract_versions WHERE rental_request_id = '30000000-0000-0000-0000-000000000001' AND event = 'saved'));
SELECT public.t_check('request: the signed version ties hash, file, terms and signer together',
  (SELECT signed_pdf_sha256 = 'abc' AND signed_pdf_path = '30000000-0000-0000-0000-000000000001/abc.pdf'
          AND contract_data->>'hourly_rate' = '180' AND saved_by = '00000000-0000-0000-0000-0000000000d1'
     FROM public.contract_versions WHERE rental_request_id = '30000000-0000-0000-0000-000000000001' AND event = 'signed'));

-- =========================================================================
-- Staff read, never write
-- =========================================================================
SELECT public.t_as(:'staff', 'authenticated');
SET ROLE authenticated;
SELECT public.t_check('staff: sees the blank', public.t_count('SELECT count(*)::int FROM public.blank_contracts') = 1);
SELECT public.t_check('staff: sees its history', public.t_count('SELECT count(*)::int FROM public.contract_versions') = 4);
SELECT public.t_check('staff: can read the signed PDF',
  public.t_count($q$SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'signed-contracts'$q$) = 1);
SELECT public.t_expect('staff: cannot create a blank',
  public.t_try($q$INSERT INTO public.blank_contracts (title) VALUES ('x')$q$), '42501');
SELECT public.t_check('staff: an update touches nothing',
  public.t_count($q$WITH u AS (UPDATE public.blank_contracts SET title = 'x' RETURNING 1) SELECT count(*)::int FROM u$q$) = 0);
RESET ROLE;

-- =========================================================================
-- A ticket buyer holds a session and no role; anon holds neither
-- =========================================================================
SELECT public.t_as(:'patron', 'authenticated');
SET ROLE authenticated;
SELECT public.t_check('patron: sees no blank', public.t_count('SELECT count(*)::int FROM public.blank_contracts') = 0);
SELECT public.t_check('patron: sees no history', public.t_count('SELECT count(*)::int FROM public.contract_versions') = 0);
SELECT public.t_check('patron: cannot read the signed PDF',
  public.t_count($q$SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'signed-contracts'$q$) = 0);
SELECT public.t_expect('patron: cannot create a blank',
  public.t_try($q$INSERT INTO public.blank_contracts (title) VALUES ('x')$q$), '42501');
RESET ROLE;

SELECT public.t_as(NULL, 'anon');
SET ROLE anon;
SELECT public.t_expect('anon: no blank contracts at all', public.t_try('SELECT 1 FROM public.blank_contracts'), '42501');
SELECT public.t_expect('anon: no history at all', public.t_try('SELECT 1 FROM public.contract_versions'), '42501');
SELECT public.t_check('anon: cannot read the signed PDF',
  public.t_count($q$SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'signed-contracts'$q$) = 0);
RESET ROLE;

-- =========================================================================
-- Deleting a blank takes its history with it
-- =========================================================================
SELECT public.t_as(:'admin', 'authenticated');
SET ROLE authenticated;
SELECT public.t_check('admin: deletes the blank',
  public.t_count($q$WITH d AS (DELETE FROM public.blank_contracts WHERE id = '40000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::int FROM d$q$) = 1);
RESET ROLE;
SELECT public.t_check('its versions went with it',
  (SELECT count(*) FROM public.contract_versions WHERE blank_contract_id IS NOT NULL) = 0);
SELECT public.t_check('the delete is in the audit log',
  (SELECT count(*) FROM public.admin_audit_log WHERE entity_type = 'blank_contracts' AND action ILIKE '%delete%') = 1);

-- =========================================================================
\echo
SELECT n, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS verdict, name, detail FROM public.t_results ORDER BY n;
DO $$
DECLARE f integer; t integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT pass), count(*) INTO f, t FROM public.t_results;
  RAISE NOTICE '% of % contracts cases passed', t - f, t;
  IF f > 0 THEN RAISE EXCEPTION '% case(s) failed', f; END IF;
END $$;
