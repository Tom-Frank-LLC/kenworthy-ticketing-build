-- Fixture and probe helpers for behaviour.sql. Runs as postgres after every
-- migration has been replayed. Every uuid is fixed so a case can name it.
--   a1 regular_user (a ticket buyer's session)   b1 host of the fixture film
--   c1 staff   d1 admin   e1 superadmin   f1 the buyer of the refunded ticket
\set ON_ERROR_STOP on
INSERT INTO auth.users(id, email) VALUES
 ('00000000-0000-0000-0000-0000000000a1','patron@x.test'),
 ('00000000-0000-0000-0000-0000000000b1','host@x.test'),
 ('00000000-0000-0000-0000-0000000000c1','staff@x.test'),
 ('00000000-0000-0000-0000-0000000000d1','admin@x.test'),
 ('00000000-0000-0000-0000-0000000000e1','super@x.test'),
 ('00000000-0000-0000-0000-0000000000f1','victim@x.test');
INSERT INTO public.profiles(id, email, display_name)
  SELECT id, email, email FROM auth.users ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
DELETE FROM public.user_roles WHERE user_id IN (SELECT id FROM auth.users);
INSERT INTO public.user_roles(user_id, role) VALUES
 ('00000000-0000-0000-0000-0000000000a1','regular_user'),
 ('00000000-0000-0000-0000-0000000000b1','host'),
 ('00000000-0000-0000-0000-0000000000c1','staff'),
 ('00000000-0000-0000-0000-0000000000d1','admin'),
 ('00000000-0000-0000-0000-0000000000e1','superadmin');

-- A film with a sold showing (one refunded ticket) and an unsold one. Terms
-- set, so a leak would show a value rather than a null.
INSERT INTO public.movies(id, title, is_active, distributor, circuit, terms_percent)
  VALUES ('10000000-0000-0000-0000-000000000001','Fixture Film',true,'Fixture Pictures','Fixture Circuit',35);
INSERT INTO public.movies(id, title, is_active)
  VALUES ('10000000-0000-0000-0000-000000000002','Second Film',true);
INSERT INTO public.showings(id, movie_id, start_time, ticket_price, total_seats, is_active) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001', now()+interval '7 days', 10, 100, true),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001', now()+interval '8 days', 10, 100, true),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002', now()+interval '9 days', 10, 100, true);
INSERT INTO public.host_event_assignments(user_id, movie_id)
  VALUES ('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001');
INSERT INTO public.tickets(id, user_id, showing_id, price, tax_rate, tax_amount, total_price, qr_code, status, payment_method, order_token)
  SELECT '30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1',
         '20000000-0000-0000-0000-000000000001', q.price, 0.06, q.tax_amount, q.total_price,
         'QR-VICTIM', 'refunded', 'online', 'tok-victim'
  FROM public.price_ticket_order('20000000-0000-0000-0000-000000000001','[{}]','online') q;

-- One public discount rule and one promo-code rule on the sold showing.
INSERT INTO public.ticket_discounts(showing_id, type, value, label, is_active, code) VALUES
 ('20000000-0000-0000-0000-000000000001','percent',10,'Public rule',true,NULL),
 ('20000000-0000-0000-0000-000000000001','percent',50,'Secret rule',true,'SECRET50');

-- Public content whose staff-id columns are set.
INSERT INTO public.staff_bios(name, title, display_on_about, is_active, user_id)
  VALUES ('Pat Staff','Projectionist',true,true,'00000000-0000-0000-0000-0000000000c1');
INSERT INTO public.featured_slides(title, link_url, is_active, created_by)
  VALUES ('Slide','/films',true,'00000000-0000-0000-0000-0000000000d1');
INSERT INTO public.film_pass_types(id, name, is_active)
  VALUES ('40000000-0000-0000-0000-000000000001','Fixture Pass',true);
INSERT INTO public.pass_type_showings(pass_type_id, showing_id, created_by)
  VALUES ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1');
INSERT INTO public.festival_programs(festival_slug, year, title, file_path, file_type, is_published, uploaded_by)
  SELECT slug, 2026, 'Booklet', '2026/booklet.pdf', 'pdf', true, '00000000-0000-0000-0000-0000000000d1'
  FROM (SELECT coalesce((SELECT slug FROM public.festivals LIMIT 1), 'silent-film-festival') AS slug) s;
INSERT INTO public.backstage_photos(file_path, is_published, uploaded_by)
  VALUES ('1/wall.jpg',true,'00000000-0000-0000-0000-0000000000d1');
INSERT INTO public.concession_menus(label, file_path, is_active, notes, uploaded_by)
  VALUES ('Menu','menu.pdf',true,'internal note','00000000-0000-0000-0000-0000000000d1');
INSERT INTO public.sponsorship_opportunities(slug, title, is_active, contact_name, contact_email)
  VALUES ('s','Sponsor',true,'Sam Contact','sam@x.test');

-- A rental with a contract link and staff-only fields.
INSERT INTO public.rental_requests(event_title, applicant_name, email, invite_token, admin_notes)
  VALUES ('Fixture Rental','Rene Renter','rene@x.test','tok-rental','do not show the renter');

-- One object in a public bucket.
INSERT INTO storage.objects(bucket_id, name) VALUES ('posters','movies/unpublished.jpg');

-- ---------------------------------------------------------------------------
-- Probe helpers.
-- test.probe(role, uid, sql) runs one statement as that PostgREST role, with
-- the JWT claims PostgREST would set, inside a subtransaction that is always
-- rolled back. It returns the statement's single text value, or 'ERR <state>:
-- <message>'. The fixture is never changed by a probe.
-- ---------------------------------------------------------------------------
CREATE SCHEMA test;
CREATE TABLE test.results (n serial, name text, expected text, got text, pass boolean);
GRANT USAGE ON SCHEMA test TO authenticator, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA test TO authenticator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA test TO authenticator;

CREATE FUNCTION test.probe(p_role text, p_uid uuid, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    PERFORM set_config('request.jwt.claim.role', p_role, true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('role', p_role, 'sub', p_uid)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql INTO r;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = coalesce(r, '<null>');
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN r := SQLERRM;
    WHEN OTHERS THEN r := 'ERR ' || SQLSTATE || ': ' || SQLERRM;
  END;
  RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION test.probe(text, uuid, text) TO authenticator;

-- Pass when got equals expected, or when expected ends in '*' and got starts
-- with the rest (for error messages).
CREATE FUNCTION test.check(p_name text, p_expected text, p_got text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO test.results(name, expected, got, pass)
  VALUES (p_name, p_expected, p_got,
          CASE WHEN right(p_expected, 1) = '*'
               THEN coalesce(p_got, '') LIKE replace(left(p_expected, -1), '_', '\_') || '%'
               ELSE p_got IS NOT DISTINCT FROM p_expected END);
$$;
GRANT EXECUTE ON FUNCTION test.check(text, text, text) TO authenticator;

-- Calls audit_bulk_begin and reads back what it wrote, in separate
-- statements (one statement cannot see rows its own function call inserted).
-- Returns '<minutes the pause lasts>|<actor email>'. NULL minutes = default.
CREATE FUNCTION test.bulk_begin(p_minutes int, p_actor uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_exp timestamptz; v_who text;
BEGIN
  IF p_minutes IS NULL THEN
    v_id := public.audit_bulk_begin(ARRAY['venues'], 'test.bulk');
  ELSE
    v_id := public.audit_bulk_begin(ARRAY['venues'], 'test.bulk', '{}'::jsonb, p_minutes, p_actor);
  END IF;
  SELECT expires_at INTO v_exp FROM public.audit_suppression WHERE run_id = v_id;
  SELECT actor_email INTO v_who FROM public.admin_audit_log WHERE details->>'run_id' = v_id::text;
  RETURN round(extract(epoch FROM v_exp - now()) / 60)::text || '|' || coalesce(v_who, '');
END $$;
GRANT EXECUTE ON FUNCTION test.bulk_begin(int, uuid) TO service_role;

-- A role that holds EXECUTE on the audit-bulk functions, as anon would if a
-- grant came back by accident. Proves the in-function check holds on its own.
CREATE ROLE leaky NOLOGIN NOINHERIT;
GRANT leaky TO authenticator;
GRANT USAGE ON SCHEMA public TO leaky;
GRANT EXECUTE ON FUNCTION public.audit_bulk_begin(text[], text, jsonb, integer, uuid) TO leaky;
