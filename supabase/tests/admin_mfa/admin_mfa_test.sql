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

-- The host view at aal1 (20261105025356). Two more hosts, to pin the boundary:
--   b2 holds host AND staff: a privileged account, so no aal1 allowance at all;
--   b3 was a host: the assignment row is still there, the role is not.
-- All three are assigned the inactive Draft Film, which has one hidden future
-- showing (so no public policy shows it) with a paid ticket, a comp and a refund.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000b2', 'hoststaff@x.test'),
  ('00000000-0000-0000-0000-0000000000b3', 'exhost@x.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000b2', 'host'),
  ('00000000-0000-0000-0000-0000000000b2', 'staff')
ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id, email)
  SELECT id, email FROM auth.users ON CONFLICT (id) DO NOTHING;
UPDATE public.profiles SET display_name = 'Pat Patron', phone = '+12085550100'
 WHERE id = '00000000-0000-0000-0000-0000000000a1';
INSERT INTO public.host_event_assignments (user_id, movie_id) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-000000000002');
INSERT INTO public.showings (id, movie_id, start_time, ticket_price, total_seats, is_active)
  VALUES ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
          now() + interval '7 days', 10, 100, false);
INSERT INTO public.tickets (id, showing_id, user_id, price, tax_rate, tax_amount, total_price,
                            status, payment_method, qr_code, comp_recipient_name, comp_recipient_email)
  VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000a1', 10, 0.06, 0.60, 10.60, 'confirmed', 'online', 'QR-PAID', NULL, NULL),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000a1', 0, 0, 0, 0, 'confirmed', 'comp', 'QR-COMP', 'Cora Comp', 'cora@x.test'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-0000000000a1', 10, 0.06, 0.60, 10.60, 'confirmed', 'online', 'QR-REFUND', NULL, NULL);
-- The insert trigger confirms every non-pending row; a refund arrives later as an
-- update, so that is how this one is made.
UPDATE public.tickets SET status = 'refunded', refunded_at = now()
 WHERE id = '30000000-0000-0000-0000-000000000003';

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
\set hoststaff '00000000-0000-0000-0000-0000000000b2'
\set exhost '00000000-0000-0000-0000-0000000000b3'
\set assigned '10000000-0000-0000-0000-000000000001'
\set draft '10000000-0000-0000-0000-000000000002'
\set hidden_showing '20000000-0000-0000-0000-000000000002'

-- The host view's reads, and the writes it must not reach.
\set hv_showing 'SELECT count(*) FROM public.showings WHERE id = ''20000000-0000-0000-0000-000000000002'''
\set hv_production 'SELECT count(*) FROM public.movies WHERE id = ''10000000-0000-0000-0000-000000000002'''
\set hv_tickets 'SELECT count(*) FROM public.tickets WHERE showing_id = ''20000000-0000-0000-0000-000000000002'''
\set hv_attendees 'SELECT count(*) FROM public.host_attendees(''20000000-0000-0000-0000-000000000002'')'
\set hv_counts 'SELECT sold || ''/'' || comps || ''/'' || checked_in FROM public.host_ticket_counts(ARRAY[''20000000-0000-0000-0000-000000000002''::uuid])'
\set hv_contacts 'SELECT count(*) FROM public.showing_attendees(ARRAY[''20000000-0000-0000-0000-000000000002''::uuid])'
\set hv_insert_showing 'INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active) VALUES (''10000000-0000-0000-0000-000000000002'', now() + interval ''9 days'', 5, 10, false)'
\set hv_update_showing 'WITH u AS (UPDATE public.showings SET total_seats = total_seats WHERE id = ''20000000-0000-0000-0000-000000000002'' RETURNING 1) SELECT count(*)::text FROM u'
\set hv_delete_showing 'WITH u AS (DELETE FROM public.showings WHERE id = ''20000000-0000-0000-0000-000000000002'' RETURNING 1) SELECT count(*)::text FROM u'
\set hv_update_production 'WITH u AS (UPDATE public.movies SET pass_processing_fee = true WHERE id = ''10000000-0000-0000-0000-000000000002'' RETURNING 1) SELECT count(*)::text FROM u'
\set hv_comp 'SELECT count(*)::text FROM public.create_ticket_order(p_showing_id => ''20000000-0000-0000-0000-000000000002'', p_tickets => ''[{}]''::jsonb, p_payment_method => ''comp'', p_user_id => auth.uid(), p_comp_recipient_name => ''Sneaky'')'
\set hv_scan 'SELECT public.check_in_ticket(''QR-PAID'', NULL) ->> ''verdict'''
\set hv_add_assignment 'INSERT INTO public.host_event_assignments (user_id, movie_id) VALUES (auth.uid(), ''10000000-0000-0000-0000-000000000001'')'
\set hv_drop_assignment 'WITH u AS (DELETE FROM public.host_event_assignments WHERE user_id = auth.uid() RETURNING 1) SELECT count(*)::text FROM u'

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
-- The host view (20261105025356): a host-only account reads its own production
-- at aal1, and changes nothing.
SELECT public.t_check('on: aal1 host-only reads own assignments', public.t_count(:'own_assignments') = 2,
  public.t_count(:'own_assignments')::text);
SELECT public.t_check('on: aal1 host-only can_host_read the assigned film', public.can_host_read(:'host', NULL, NULL, :'draft'));
SELECT public.t_check('on: aal1 host-only reads the hidden assigned showing', public.t_count(:'hv_showing') = 1,
  public.t_count(:'hv_showing')::text);
SELECT public.t_check('on: aal1 host-only reads the inactive assigned production', public.t_count(:'hv_production') = 1,
  public.t_count(:'hv_production')::text);
SELECT public.t_expect('on: aal1 host-only counts: 1 sold, 1 comp, 0 in (refund left out)', public.t_text(:'hv_counts'), '1/1/0');
SELECT public.t_check('on: aal1 host-only reads the attendee list', public.t_count(:'hv_attendees') = 2,
  public.t_count(:'hv_attendees')::text);
SELECT public.t_expect('on: attendee list uses the comp name',
  public.t_text('SELECT string_agg(attendee_name, '','' ORDER BY attendee_name) FROM public.host_attendees(''20000000-0000-0000-0000-000000000002'')'),
  'Cora Comp,Pat Patron');
SELECT public.t_check('on: aal1 host-only reads no ticket rows directly (tickets stay behind the code)',
  public.t_count(:'hv_tickets') = 0, public.t_count(:'hv_tickets')::text);
SELECT public.t_check('on: aal1 host-only gets no contact details', public.t_count(:'hv_contacts') = 0,
  public.t_count(:'hv_contacts')::text);
SELECT public.t_check('on: my_mfa_required is false for a host-only account', NOT public.my_mfa_required());
SELECT public.t_check('on: aal1 host-only still is not is_host_of (writes keep the code)',
  NOT public.is_host_of(:'host', NULL, NULL, :'draft'));
SELECT public.t_expect('on: aal1 host-only cannot add a showing', public.t_try(:'hv_insert_showing'), '42501');
SELECT public.t_expect('on: aal1 host-only cannot change a showing', public.t_text(:'hv_update_showing'), '0');
SELECT public.t_expect('on: aal1 host-only cannot delete a showing', public.t_text(:'hv_delete_showing'), '0');
SELECT public.t_expect('on: aal1 host-only cannot change the production or its fee', public.t_text(:'hv_update_production'), '0');
SELECT public.t_check('on: aal1 host-only cannot issue a comp', public.t_text(:'hv_comp') NOT LIKE '1%',
  public.t_text(:'hv_comp'));
SELECT public.t_expect('on: aal1 host-only cannot check a ticket in', public.t_text(:'hv_scan'), 'forbidden');
SELECT public.t_expect('on: aal1 host-only cannot add an assignment', public.t_try(:'hv_add_assignment'), '42501');
SELECT public.t_expect('on: aal1 host-only cannot remove an assignment', public.t_text(:'hv_drop_assignment'), '0');
RESET ROLE;

-- The boundary: host AND staff is a privileged account. No aal1 allowance.
SELECT public.t_as(:'hoststaff', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('on: aal1 host+staff reads no own assignment', public.t_count(:'own_assignments') = 0,
  public.t_count(:'own_assignments')::text);
SELECT public.t_check('on: aal1 host+staff is refused can_host_read', NOT public.can_host_read(:'hoststaff', NULL, NULL, :'draft'));
SELECT public.t_check('on: aal1 host+staff reads no hidden showing', public.t_count(:'hv_showing') = 0,
  public.t_count(:'hv_showing')::text);
SELECT public.t_check('on: aal1 host+staff reads no inactive production', public.t_count(:'hv_production') = 0,
  public.t_count(:'hv_production')::text);
SELECT public.t_check('on: aal1 host+staff reads no attendees', public.t_count(:'hv_attendees') = 0,
  public.t_count(:'hv_attendees')::text);
SELECT public.t_check('on: my_mfa_required is true for host+staff', public.my_mfa_required());
SELECT public.t_expect('on: aal1 host+staff cannot change a showing', public.t_text(:'hv_update_showing'), '0');
RESET ROLE;

-- Revocation: the assignment row outlived the role. Nothing to read.
SELECT public.t_as(:'exhost', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('on: aal1 ex-host reads no assignment', public.t_count(:'own_assignments') = 0,
  public.t_count(:'own_assignments')::text);
SELECT public.t_check('on: aal1 ex-host reads no hidden showing', public.t_count(:'hv_showing') = 0);
SELECT public.t_check('on: aal1 ex-host reads no attendees', public.t_count(:'hv_attendees') = 0);
RESET ROLE;

-- A patron with no assignment: nothing, however the functions are called.
SELECT public.t_as(:'patron', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_check('on: aal2 patron reads no attendees of a show they hold tickets to',
  public.t_count(:'hv_attendees') = 0, public.t_count(:'hv_attendees')::text);
SELECT public.t_check('on: aal2 patron gets no counts', public.t_count('SELECT count(*) FROM public.host_ticket_counts(ARRAY[''20000000-0000-0000-0000-000000000002''::uuid])') = 0);
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
SELECT public.t_check('on: aal2 host reads own assignment', public.t_count(:'own_assignments') = 2);
SELECT public.t_check('on: aal2 host still gets no contact details (staff only)', public.t_count(:'hv_contacts') = 0,
  public.t_count(:'hv_contacts')::text);
SELECT public.t_check('on: aal2 host reads the attendee list', public.t_count(:'hv_attendees') = 2);
RESET ROLE;
SELECT public.t_as(:'hoststaff', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_check('on: aal2 host+staff reads the attendee list', public.t_count(:'hv_attendees') = 2);
SELECT public.t_check('on: aal2 host+staff gets contact details', public.t_count(:'hv_contacts') = 3,
  public.t_count(:'hv_contacts')::text);
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
SELECT public.t_expect('anon cannot call host_view_session', public.t_try('SELECT public.host_view_session()'), '42501');
SELECT public.t_expect('anon cannot call can_host_read',
  public.t_try(format('SELECT public.can_host_read(%L, NULL, NULL, %L)', :'host', :'draft')), '42501');
SELECT public.t_expect('anon cannot call host_attendees', public.t_try(:'hv_attendees'), '42501');
SELECT public.t_expect('anon cannot call host_ticket_counts', public.t_try(:'hv_counts'), '42501');
SELECT public.t_check('on: anon reads no hidden showing', public.t_count(:'hv_showing') = 0);
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
-- The production's contract (20261105073034), switch on.
-- =========================================================================
-- Two signed requests with archived PDFs. r1 gets linked to the Draft Film,
-- which host, hoststaff and exhost are all assigned; r2 is someone else's.
INSERT INTO public.rental_requests (id, applicant_name, email, phone, event_title, status,
                                    signed_at, signed_by_name, signed_pdf_sha256, signed_pdf_path, admin_notes)
VALUES
  ('40000000-0000-0000-0000-000000000001', 'Rita Renter', 'rita@x.test', '+12085550111', 'Draft Film night', 'approved',
   now(), 'Rita Renter', 'aa11', 'r1/signed.pdf', 'internal note'),
  ('40000000-0000-0000-0000-000000000002', 'Otto Other', 'otto@x.test', NULL, 'Other rental', 'approved',
   now(), 'Otto Other', 'bb22', 'r2/signed.pdf', NULL);
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('signed-contracts', 'r1/signed.pdf'), ('signed-contracts', 'r2/signed.pdf');
SELECT public.t_switch(true);

\set link_r1 'SELECT public.set_production_contract(''movie'', ''10000000-0000-0000-0000-000000000002'', ''40000000-0000-0000-0000-000000000001'')'
\set link_r2 'SELECT public.set_production_contract(''movie'', ''10000000-0000-0000-0000-000000000002'', ''40000000-0000-0000-0000-000000000002'')'
\set unlink 'SELECT public.set_production_contract(''movie'', ''10000000-0000-0000-0000-000000000002'', NULL)'
\set my_contracts 'SELECT count(*) FROM public.host_production_contracts() WHERE movie_id = ''10000000-0000-0000-0000-000000000002'''
\set my_contract_path 'SELECT signed_pdf_path || ''/'' || signed::text || ''/'' || signed_by_name FROM public.host_production_contracts() WHERE movie_id = ''10000000-0000-0000-0000-000000000002'''
\set contract_files 'SELECT string_agg(name, '','' ORDER BY name) FROM storage.objects WHERE bucket_id = ''signed-contracts'''
\set contract_file_count 'SELECT count(*) FROM storage.objects WHERE bucket_id = ''signed-contracts'''
\set request_rows 'SELECT count(*) FROM public.rental_requests'

-- Linking is admin work, at aal2.
SELECT public.t_as(:'staff', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_expect('contract: aal2 staff cannot link a contract', public.t_try(:'link_r1'), '42501');
RESET ROLE;
SELECT public.t_as(:'admin', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_expect('contract: aal1 admin cannot link a contract', public.t_try(:'link_r1'), '42501');
RESET ROLE;
SELECT public.t_as(:'admin', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_expect('contract: aal2 admin links r1 to the Draft Film', public.t_try(:'link_r1'), 'ok');
SELECT public.t_check('contract: aal2 admin reads the link back', public.t_count(:'my_contracts') = 1);
SELECT public.t_expect('contract: an unknown kind is refused',
  public.t_try('SELECT public.set_production_contract(''show'', ''10000000-0000-0000-0000-000000000002'', NULL)'), '22023');
SELECT public.t_expect('contract: an unknown request is reported, not silently skipped',
  public.t_try('SELECT public.set_production_contract(''movie'', ''10000000-0000-0000-0000-000000000002'', ''40000000-0000-0000-0000-00000000ffff'')'), 'P0002');
RESET ROLE;
SELECT public.t_check('contract: the failed call rolled back, r1 is still linked',
  (SELECT linked_movie_id = '10000000-0000-0000-0000-000000000002' FROM public.rental_requests
    WHERE id = '40000000-0000-0000-0000-000000000001'));

-- The host's emailed-link session: its own contract, and nothing else.
SELECT public.t_as(:'host', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_expect('contract: aal1 host-only reads its signed contract',
  public.t_text(:'my_contract_path'), 'r1/signed.pdf/true/Rita Renter');
SELECT public.t_check('contract: aal1 host-only reads only its own production''s',
  public.t_count('SELECT count(*) FROM public.host_production_contracts()') = 1);
SELECT public.t_expect('contract: aal1 host-only reads its own PDF and no other', public.t_text(:'contract_files'), 'r1/signed.pdf');
SELECT public.t_check('contract: aal1 host-only reads no rental request row (contacts, notes, token)',
  public.t_count(:'request_rows') = 0, public.t_count(:'request_rows')::text);
SELECT public.t_expect('contract: aal1 host-only cannot link a contract', public.t_try(:'link_r2'), '42501');
RESET ROLE;

-- Host + staff at aal1, the ex-host and a patron: nothing.
SELECT public.t_as(:'hoststaff', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('contract: aal1 host+staff reads no contract', public.t_count(:'my_contracts') = 0);
SELECT public.t_check('contract: aal1 host+staff reads no PDF', public.t_count(:'contract_file_count') = 0);
RESET ROLE;
SELECT public.t_as(:'exhost', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('contract: aal1 ex-host reads no contract', public.t_count(:'my_contracts') = 0);
SELECT public.t_check('contract: aal1 ex-host reads no PDF', public.t_count(:'contract_file_count') = 0);
RESET ROLE;
SELECT public.t_as(:'patron', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_check('contract: aal2 patron reads no contract', public.t_count(:'my_contracts') = 0);
SELECT public.t_check('contract: aal2 patron reads no PDF', public.t_count(:'contract_file_count') = 0);
RESET ROLE;
SELECT public.t_as(:'hoststaff', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_check('contract: aal2 host+staff reads every PDF (staff)', public.t_count(:'contract_file_count') = 2);
RESET ROLE;

-- Relinking moves the link: the production has one contract, and the host's
-- access follows it.
SELECT public.t_as(:'admin', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_expect('contract: aal2 admin relinks the Draft Film to r2', public.t_try(:'link_r2'), 'ok');
RESET ROLE;
SELECT public.t_check('contract: relinking cleared r1',
  (SELECT linked_movie_id IS NULL FROM public.rental_requests WHERE id = '40000000-0000-0000-0000-000000000001'));
SELECT public.t_as(:'host', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_expect('contract: after relinking the host reads r2''s PDF only', public.t_text(:'contract_files'), 'r2/signed.pdf');
RESET ROLE;
SELECT public.t_as(:'admin', 'authenticated', 'aal2');
SET ROLE authenticated;
SELECT public.t_expect('contract: aal2 admin unlinks', public.t_try(:'unlink'), 'ok');
RESET ROLE;
SELECT public.t_as(:'host', 'authenticated', 'aal1');
SET ROLE authenticated;
SELECT public.t_check('contract: unlinked, the host reads no contract', public.t_count(:'my_contracts') = 0);
SELECT public.t_check('contract: unlinked, the host reads no PDF', public.t_count(:'contract_file_count') = 0);
RESET ROLE;

-- The shape of the link, enforced by the table.
UPDATE public.rental_requests SET linked_movie_id = '10000000-0000-0000-0000-000000000001'
 WHERE id = '40000000-0000-0000-0000-000000000001';
SELECT public.t_expect('contract: a production links to one request at most',
  public.t_try('UPDATE public.rental_requests SET linked_movie_id = ''10000000-0000-0000-0000-000000000001''
                 WHERE id = ''40000000-0000-0000-0000-000000000002'''), '23505');
SELECT public.t_check('contract: a request links to one production at most (CHECK present)',
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_requests_one_linked_production'));
UPDATE public.rental_requests SET linked_movie_id = NULL WHERE id = '40000000-0000-0000-0000-000000000001';

SELECT public.t_as(NULL, 'anon', NULL);
SET ROLE anon;
SELECT public.t_expect('anon cannot call host_production_contracts', public.t_try('SELECT * FROM public.host_production_contracts()'), '42501');
SELECT public.t_expect('anon cannot call set_production_contract', public.t_try(:'unlink'), '42501');
SELECT public.t_expect('anon cannot call can_host_read_signed_contract',
  public.t_try('SELECT public.can_host_read_signed_contract(''r1/signed.pdf'')'), '42501');
RESET ROLE;
SELECT public.t_switch(false);

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
             '(is_host_of|can_host_read)(_showing)?\(auth\.uid\(\),', 'IHO(', 'g') ~ 'auth\.(uid|jwt|email)\(\)'
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
            '(is_host_of|can_host_read)(_showing)?\(auth\.uid\(\),', 'IHO(', 'g') ~ 'auth\.(uid|jwt|email)\(\)'
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
  NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('has_role', 'is_host_of', 'is_host_of_showing', 'can_host_read', 'can_host_read_showing')
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
