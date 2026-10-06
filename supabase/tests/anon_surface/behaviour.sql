-- Behaviour pinned by BRIEF-sec-rls-regressions (audit 2026-10-06 M3, M4,
-- M10, L17, L18, L19), exercised as PostgREST would: this file runs as the
-- `authenticator` login, so session_user is not postgres, and every probe
-- switches to anon / authenticated / service_role with matching JWT claims.
--
-- Each fix is pinned from both sides: what it now refuses, and the reads the
-- site actually makes still working. The select strings for movies, staff
-- bios, slides and discounts are the app's own constants, passed in by run.sh
-- from src/, so a column added to one of them without a grant fails here.
\set ON_ERROR_STOP on
\o /dev/null
\set A1 '00000000-0000-0000-0000-0000000000a1'
\set B1 '00000000-0000-0000-0000-0000000000b1'
\set D1 '00000000-0000-0000-0000-0000000000d1'
\set SOLD '20000000-0000-0000-0000-000000000001'
\set UNSOLD '20000000-0000-0000-0000-000000000002'

\echo '=== M3: movies terms are not public; the public column list still reads ==='
SELECT test.check('anon select MOVIE_PUBLIC_COLUMNS', '2',
  test.probe('anon', NULL, 'SELECT count(*)::text FROM (SELECT ' || :'movie_cols' || ' FROM public.movies WHERE is_active) x'));
SELECT test.check('anon select terms_percent refused', 'ERR 42501*',
  test.probe('anon', NULL, 'SELECT terms_percent::text FROM public.movies LIMIT 1'));
SELECT test.check('anon select distributor refused', 'ERR 42501*',
  test.probe('anon', NULL, 'SELECT distributor FROM public.movies LIMIT 1'));
SELECT test.check('anon select * on movies refused', 'ERR 42501*',
  test.probe('anon', NULL, 'SELECT count(*)::text FROM (SELECT * FROM public.movies) x'));
SELECT test.check('anon embedded movie fields (Worker, festival page)', 'Fixture Film|',
  test.probe('anon', NULL, $$SELECT m.title || '|' || coalesce(m.description, '') || coalesce(m.poster_url, '') FROM public.showings s JOIN public.movies m ON m.id = s.movie_id WHERE s.id = '20000000-0000-0000-0000-000000000001'$$));
SELECT test.check('admin still reads the terms (film form, receipts)', '35',
  test.probe('authenticated', :'D1', 'SELECT terms_percent::int::text FROM public.movies WHERE terms_percent IS NOT NULL'));

\echo '=== Sweep: other restrictions the blanket grant undid ==='
SELECT test.check('anon sponsorship contact_name refused', 'ERR 42501*',
  test.probe('anon', NULL, 'SELECT contact_name FROM public.sponsorship_opportunities LIMIT 1'));
SELECT test.check('anon sponsorship title still reads', 'Sponsor',
  test.probe('anon', NULL, $$SELECT title FROM public.sponsorship_opportunities WHERE slug = 's'$$));
SELECT test.check('admin qbo secret ids refused', 'ERR 42501*',
  test.probe('authenticated', :'D1', 'SELECT access_token_secret_id::text FROM public.qbo_connection LIMIT 1'));
SELECT test.check('admin qbo metadata still reads', '0',
  test.probe('authenticated', :'D1', 'SELECT count(realm_id)::text FROM public.qbo_connection'));
SELECT test.check('anon film_pass_orders refused', 'ERR 42501*',
  test.probe('anon', NULL, 'SELECT count(*)::text FROM public.film_pass_orders'));

\echo '=== L19: staff ids are not public; the public pages still read ==='
SELECT test.check('anon staff_bios with STAFF_BIO_PUBLIC_COLUMNS (About)', '1',
  test.probe('anon', NULL, 'SELECT count(*)::text FROM (SELECT ' || :'staff_cols' || ' FROM public.staff_bios WHERE display_on_about AND is_active ORDER BY sort_order, name) x'));
SELECT test.check('anon staff_bios.user_id refused', 'ERR 42501*',
  test.probe('anon', NULL, 'SELECT user_id::text FROM public.staff_bios LIMIT 1'));
SELECT test.check('anon featured_slides with SLIDE_COLUMNS', '1',
  test.probe('anon', NULL, 'SELECT count(*)::text FROM (SELECT ' || :'slide_cols' || ' FROM public.featured_slides WHERE is_active) x'));
SELECT test.check('anon featured_slides.created_by refused', 'ERR 42501*',
  test.probe('anon', NULL, 'SELECT created_by::text FROM public.featured_slides LIMIT 1'));
SELECT test.check('anon pass eligibility for a showing (passEligibility.ts)', '40000000-0000-0000-0000-000000000001',
  test.probe('anon', NULL, $$SELECT pass_type_id::text FROM public.pass_type_showings WHERE showing_id = '20000000-0000-0000-0000-000000000001'$$));
SELECT test.check('anon showings inner-joined to pass tagging (FilmPassDetail)', '1',
  test.probe('anon', NULL, $$SELECT count(*)::text FROM public.showings s JOIN public.pass_type_showings p ON p.showing_id = s.id WHERE p.pass_type_id = '40000000-0000-0000-0000-000000000001' AND s.is_active$$));
SELECT test.check('anon pass_type_showings.created_by refused', 'ERR 42501*',
  test.probe('anon', NULL, 'SELECT created_by::text FROM public.pass_type_showings LIMIT 1'));
SELECT test.check('anon festival programmes (SilentFilmFestival)', '1',
  test.probe('anon', NULL, 'SELECT count(*)::text FROM (SELECT id, year, title, file_path, file_type, display_order, thumbnail_path FROM public.festival_programs WHERE is_published AND festival_slug IS NOT NULL) x'));
SELECT test.check('anon festival_programs.uploaded_by refused', 'ERR 42501*',
  test.probe('anon', NULL, 'SELECT uploaded_by::text FROM public.festival_programs LIMIT 1'));
SELECT test.check('anon backstage photos (Backstage)', '1',
  test.probe('anon', NULL, 'SELECT count(*)::text FROM (SELECT id, caption, file_path, display_order, created_at FROM public.backstage_photos WHERE is_published) x'));
SELECT test.check('anon backstage_photos.uploaded_by refused', 'ERR 42501*',
  test.probe('anon', NULL, 'SELECT uploaded_by::text FROM public.backstage_photos LIMIT 1'));
SELECT test.check('anon concession menu (Concessions)', 'menu.pdf',
  test.probe('anon', NULL, 'SELECT file_path FROM public.concession_menus WHERE is_active'));
SELECT test.check('anon concession_menus.notes refused', 'ERR 42501*',
  test.probe('anon', NULL, 'SELECT notes FROM public.concession_menus LIMIT 1'));

\echo '=== L19: promo codes are not public; the discount preview still reads ==='
SELECT test.check('anon discounts.ts select returns the public rule only', 'Public rule',
  test.probe('anon', NULL, 'SELECT string_agg(label, '','') FROM (SELECT ' || :'discount_cols' || $$ FROM public.ticket_discounts WHERE showing_id = '20000000-0000-0000-0000-000000000001') x$$));
SELECT test.check('anon sees no code', '0',
  test.probe('anon', NULL, 'SELECT count(*)::text FROM public.ticket_discounts WHERE code IS NOT NULL'));
SELECT test.check('buyer session sees no code', '0',
  test.probe('authenticated', :'A1', 'SELECT count(*)::text FROM public.ticket_discounts WHERE code IS NOT NULL'));
SELECT test.check('admin sees both rules', '2',
  test.probe('authenticated', :'D1', 'SELECT count(*)::text FROM public.ticket_discounts'));
SELECT test.check('quote_ticket_order still applies the public rule as anon', 'Public rule',
  test.probe('anon', NULL, $$SELECT max(discount_label) FROM public.quote_ticket_order('20000000-0000-0000-0000-000000000001', '[{}]', 'online')$$));

\echo '=== L19: role helpers ==='
-- Still answers for any uuid: the policies need it (see the migration). What
-- closes the oracle is that anon no longer has a staff uuid to ask about.
SELECT test.check('anon has_role still executes (policies need it)', 'true',
  test.probe('anon', NULL, $$SELECT public.has_role('00000000-0000-0000-0000-0000000000d1', 'admin')::text$$));
SELECT test.check('anon is_host_of refused', 'ERR 42501*',
  test.probe('anon', NULL, $$SELECT public.is_host_of('00000000-0000-0000-0000-0000000000b1', NULL, NULL, '10000000-0000-0000-0000-000000000001')::text$$));
SELECT test.check('anon is_host_of_showing refused', 'ERR 42501*',
  test.probe('anon', NULL, $$SELECT public.is_host_of_showing('00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001')::text$$));
SELECT test.check('anon is_protected_user refused', 'ERR 42501*',
  test.probe('anon', NULL, $$SELECT public.is_protected_user('00000000-0000-0000-0000-0000000000d1')::text$$));
SELECT test.check('anon resolve_account_id refused', 'ERR 42501*',
  test.probe('anon', NULL, $$SELECT public.resolve_account_id('x', 'y')::text$$));
SELECT test.check('buyer resolve_account_id refused', 'ERR 42501*',
  test.probe('authenticated', :'A1', $$SELECT public.resolve_account_id('x', 'y')::text$$));
SELECT test.check('anon showings read (policy no longer calls is_host_of for anon)', '3',
  test.probe('anon', NULL, 'SELECT count(*)::text FROM public.showings'));
SELECT test.check('host still sees own showings', '2',
  test.probe('authenticated', :'B1', $$SELECT count(*)::text FROM public.showings WHERE movie_id = '10000000-0000-0000-0000-000000000001'$$));

\echo '=== M10: audit_bulk_* are service-role only ==='
SELECT test.check('anon audit_bulk_begin refused', 'ERR 42501*',
  test.probe('anon', NULL, $$SELECT public.audit_bulk_begin(ARRAY['tickets'], 'x', '{}', 525600)::text$$));
SELECT test.check('authenticated audit_bulk_begin refused', 'ERR 42501*',
  test.probe('authenticated', :'D1', $$SELECT public.audit_bulk_begin(ARRAY['tickets'], 'x', '{}', 525600)::text$$));
SELECT test.check('anon audit_bulk_end refused', 'ERR 42501*',
  test.probe('anon', NULL, $$SELECT public.audit_bulk_end(gen_random_uuid(), 'forged', '{}')::text$$));
SELECT test.check('a stray grant still cannot call it (in-function check)', 'ERR 42501: audit_bulk_begin is service-role only',
  test.probe('leaky', NULL, $$SELECT public.audit_bulk_begin(ARRAY['tickets'], 'x', '{}', 525600)::text$$));
SELECT test.check('service role: works, pause capped at 60 minutes', '60|',
  test.probe('service_role', NULL, 'SELECT test.bulk_begin(525600, NULL)'));
SELECT test.check('service role: default 10 minutes unchanged', '10|',
  test.probe('service_role', NULL, 'SELECT test.bulk_begin(NULL, NULL)'));
SELECT test.check('service role: actor id still names the admin', '10|admin@x.test',
  test.probe('service_role', NULL, $$SELECT test.bulk_begin(10, '00000000-0000-0000-0000-0000000000d1')$$));

\echo '=== M4: hosts cannot edit tickets; sold showings cannot be deleted ==='
SELECT test.check('host cannot resurrect a refunded ticket', '0',
  test.probe('authenticated', :'B1', $$WITH u AS (UPDATE public.tickets SET status = 'confirmed' WHERE id = '30000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM u$$));
SELECT test.check('admin can still update a ticket', '1',
  test.probe('authenticated', :'D1', $$WITH u AS (UPDATE public.tickets SET payment_error = 'x' WHERE id = '30000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM u$$));
SELECT test.check('host cannot delete a sold showing', 'ERR 23503: This showing has tickets*',
  test.probe('authenticated', :'B1', $$WITH d AS (DELETE FROM public.showings WHERE id = '20000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM d$$));
SELECT test.check('admin cannot delete a sold showing', 'ERR 23503: This showing has tickets*',
  test.probe('authenticated', :'D1', $$WITH d AS (DELETE FROM public.showings WHERE id = '20000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM d$$));
SELECT test.check('admin cannot delete a film whose showing sold (cascade)', 'ERR 23503: This showing has tickets*',
  test.probe('authenticated', :'D1', $$WITH d AS (DELETE FROM public.movies WHERE id = '10000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM d$$));
SELECT test.check('service role cannot either', 'ERR 23503: This showing has tickets*',
  test.probe('service_role', NULL, $$WITH d AS (DELETE FROM public.showings WHERE id = '20000000-0000-0000-0000-000000000001' RETURNING 1) SELECT count(*)::text FROM d$$));
SELECT test.check('host can still remove an unsold showing', '1',
  test.probe('authenticated', :'B1', $$WITH d AS (DELETE FROM public.showings WHERE id = '20000000-0000-0000-0000-000000000002' RETURNING 1) SELECT count(*)::text FROM d$$));
SELECT test.check('admin can still delete a film with no sales', '1',
  test.probe('authenticated', :'D1', $$WITH d AS (DELETE FROM public.movies WHERE id = '10000000-0000-0000-0000-000000000002' RETURNING 1) SELECT count(*)::text FROM d$$));

\echo '=== L17: the contract link returns only what the page renders ==='
SELECT test.check('anon token read returns the rental', 'Fixture Rental',
  test.probe('anon', NULL, $$SELECT event_title FROM public.get_rental_request_by_token('tok-rental')$$));
SELECT test.check('admin_notes is not in the result', 'ERR 42703*',
  test.probe('anon', NULL, $$SELECT admin_notes FROM public.get_rental_request_by_token('tok-rental')$$));
SELECT test.check('result has exactly the 15 rendered columns', '15',
  test.probe('anon', NULL, $$SELECT count(*)::text FROM json_object_keys((SELECT row_to_json(r) FROM public.get_rental_request_by_token('tok-rental') r))$$));
SELECT test.check('wrong token returns nothing', '0',
  test.probe('anon', NULL, $$SELECT count(*)::text FROM public.get_rental_request_by_token('nope')$$));

\echo '=== L18: public buckets are not listable ==='
SELECT test.check('anon lists no storage objects', '0',
  test.probe('anon', NULL, 'SELECT count(*)::text FROM storage.objects'));
SELECT test.check('buyer session lists no storage objects', '0',
  test.probe('authenticated', :'A1', 'SELECT count(*)::text FROM storage.objects'));
SELECT test.check('admin still reads objects (remove() needs SELECT)', '1',
  test.probe('authenticated', :'D1', $$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'posters'$$));
SELECT test.check('admin remove still deletes', '1',
  test.probe('authenticated', :'D1', $$WITH d AS (DELETE FROM storage.objects WHERE bucket_id = 'posters' RETURNING 1) SELECT count(*)::text FROM d$$));
SELECT test.check('the six media buckets are still public', '6',
  test.probe('service_role', NULL, $$SELECT count(*)::text FROM storage.buckets WHERE public AND id IN
     ('posters','pass-images','festival-programs','backstage-photos','concession-menus','featured-slides')$$));

\o
\echo '=== Results ==='
SELECT n, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS verdict, name,
       CASE WHEN pass THEN '' ELSE 'expected ' || expected || ' / got ' || coalesce(got, '<null>') END AS detail
FROM test.results ORDER BY n;
SELECT count(*) FILTER (WHERE pass) AS passed, count(*) FILTER (WHERE NOT pass) AS failed FROM test.results;
DO $$
DECLARE f int;
BEGIN
  SELECT count(*) INTO f FROM test.results WHERE NOT pass;
  IF f > 0 THEN RAISE EXCEPTION '% case(s) failed', f; END IF;
END $$;
