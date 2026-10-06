-- Staff-boundary cases. Security audit 2026-10-06: L1, L3, L14, M11, RLS-9.
-- Run by run.sh after every migration has been replayed. Exits non-zero if any
-- case fails; with BEFORE=1 (main, without the fix) the fixed cases fail.
\set ON_ERROR_STOP 1
\pset pager off

CREATE TABLE public.t_results (n serial, name text, pass boolean, detail text);
GRANT ALL ON public.t_results TO PUBLIC;
GRANT ALL ON SEQUENCE public.t_results_n_seq TO PUBLIC;

-- Run a statement, return 'ok' or 'SQLSTATE: message'.
CREATE FUNCTION public.t_try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM; END $$;
-- Run a query returning one integer (a count), or -1 on error.
CREATE FUNCTION public.t_count(q text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer; BEGIN EXECUTE q INTO n; RETURN n; EXCEPTION WHEN OTHERS THEN RETURN -1; END $$;
-- Run a query returning one jsonb, or NULL on error.
CREATE FUNCTION public.t_json(q text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE j jsonb; BEGIN EXECUTE q INTO j; RETURN j; EXCEPTION WHEN OTHERS THEN RETURN NULL; END $$;
CREATE FUNCTION public.t_expect(name text, got text, want_prefix text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.t_results (name, pass, detail) VALUES (name, got LIKE want_prefix || '%', got) $$;
CREATE FUNCTION public.t_check(name text, ok boolean, detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.t_results (name, pass, detail) VALUES (name, COALESCE(ok, false), detail) $$;
GRANT EXECUTE ON FUNCTION public.t_try(text), public.t_count(text), public.t_json(text), public.t_expect(text, text, text),
  public.t_check(text, boolean, text) TO PUBLIC;

-- Principals. Two staff, so "your own sale" has someone else to differ from.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'patron@x.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'staff@x.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'staff2@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'admin@x.test');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'regular_user'),
  ('00000000-0000-0000-0000-0000000000c1', 'staff'),
  ('00000000-0000-0000-0000-0000000000c2', 'staff'),
  ('00000000-0000-0000-0000-0000000000d1', 'admin')
ON CONFLICT DO NOTHING;  -- a trigger on auth.users already grants regular_user
INSERT INTO public.movies (id, title, is_active) VALUES ('10000000-0000-0000-0000-000000000001', 'Fixture Film', true);
INSERT INTO public.showings (id, movie_id, start_time, ticket_price, total_seats, is_active)
  VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', now() + interval '7 days', 10, 100, true);

-- Who is asking. Session-level so that SET ROLE and the claims agree.
CREATE FUNCTION public.t_as(p_uid text, p_role text, p_headers text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_uid, ''), false),
         set_config('request.jwt.claim.role', p_role, false),
         set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', p_uid)::text, false),
         set_config('request.headers', COALESCE(p_headers, '{}'), false);
$$;
GRANT EXECUTE ON FUNCTION public.t_as(text, text, text) TO PUBLIC;

\set staff '00000000-0000-0000-0000-0000000000c1'
\set staff2 '00000000-0000-0000-0000-0000000000c2'
\set admin '00000000-0000-0000-0000-0000000000d1'
\set patron '00000000-0000-0000-0000-0000000000a1'
\set showing '20000000-0000-0000-0000-000000000001'

-- =========================================================================
-- L1 · a browser cannot say a card was paid
-- =========================================================================
SELECT public.t_as(:'staff', 'authenticated');
SET ROLE authenticated;

SELECT public.t_expect('L1 staff: confirmed card row refused',
  public.t_try($q$SELECT * FROM public.create_ticket_order('20000000-0000-0000-0000-000000000001', '[{}]', 'card',
    '00000000-0000-0000-0000-0000000000c1', 'tok-card-confirmed', 'confirmed')$q$), '42501');
SELECT public.t_expect('L1 staff: confirmed online row refused',
  public.t_try($q$SELECT * FROM public.create_ticket_order('20000000-0000-0000-0000-000000000001', '[{}]', 'online',
    '00000000-0000-0000-0000-0000000000c1', 'tok-online', 'confirmed')$q$), '42501');
SELECT public.t_expect('L1 staff: a payment id from the browser refused (even on cash)',
  public.t_try($q$SELECT * FROM public.create_ticket_order('20000000-0000-0000-0000-000000000001', '[{}]', 'cash',
    '00000000-0000-0000-0000-0000000000c1', 'tok-cash-pid', 'confirmed', 'SQ-PAY-FORGED')$q$), '42501');
SELECT public.t_check('L1 staff: cash sale still confirms (POS cash path)',
  public.t_count($q$SELECT count(*)::int FROM public.create_ticket_order('20000000-0000-0000-0000-000000000001', '[{},{}]', 'cash',
    '00000000-0000-0000-0000-0000000000c1', 'tok-cash', 'confirmed')$q$) = 2);
SELECT public.t_check('L1 staff: pending card sale still writes (POS card path)',
  public.t_count($q$SELECT count(*)::int FROM public.create_ticket_order('20000000-0000-0000-0000-000000000001', '[{},{}]', 'card',
    '00000000-0000-0000-0000-0000000000c1', 'tok-card-1', 'pending')$q$) = 2);
SELECT public.t_check('L1 staff2: a second pending card sale',
  public.t_count($q$SELECT count(*)::int FROM public.create_ticket_order('20000000-0000-0000-0000-000000000001', '[{}]', 'card',
    '00000000-0000-0000-0000-0000000000c1', 'tok-card-2', 'pending')$q$) = 1);
RESET ROLE;

-- The service role (ticket-checkout, square-terminal) is unchanged.
SELECT public.t_as(NULL, 'service_role');
SET ROLE service_role;
SELECT public.t_check('L1 service: an online order with its payment id',
  public.t_count($q$SELECT count(*)::int FROM public.create_ticket_order('20000000-0000-0000-0000-000000000001', '[{},{}]', 'online',
    '00000000-0000-0000-0000-0000000000a1', 'tok-online-A', 'confirmed', 'SQ-PAY-A')$q$) = 2);
SELECT public.t_expect('L1 service: the same payment id on a different order refused',
  public.t_try($q$SELECT * FROM public.create_ticket_order('20000000-0000-0000-0000-000000000001', '[{}]', 'online',
    '00000000-0000-0000-0000-0000000000a1', 'tok-online-B', 'confirmed', 'SQ-PAY-A')$q$), 'PT423');
-- confirm_sale's write: stamp one swipe's payment onto a second order.
SELECT public.t_expect('L1 confirm_sale: one swipe cannot confirm a second order',
  public.t_try($q$UPDATE public.tickets SET status = 'confirmed', square_payment_id = 'SQ-PAY-A' WHERE order_token = 'tok-card-1'$q$), 'PT423');
SELECT public.t_expect('L1 confirm_sale: its own payment confirms its own order',
  public.t_try($q$UPDATE public.tickets SET status = 'confirmed', square_payment_id = 'SQ-PAY-CARD1' WHERE order_token = 'tok-card-1'$q$), 'ok');
SELECT public.t_expect('L1 a status flip on a stamped order is not a reuse',
  public.t_try($q$UPDATE public.tickets SET status = 'refunded' WHERE order_token = 'tok-online-A'$q$), 'ok');
SELECT public.t_expect('L1 cash-sale stamp: a CASH tender id once per order',
  public.t_try($q$UPDATE public.tickets SET square_payment_id = 'SQ-CASH-1' WHERE order_token = 'tok-cash'$q$), 'ok');
RESET ROLE;
-- A payment that activated a film pass cannot also pay for tickets.
INSERT INTO public.film_pass_types (id, name, price, initial_balance, redemption_price)
  VALUES ('40000000-0000-0000-0000-000000000001', 'Fixture Pass', 60, 60, 6);
INSERT INTO public.user_film_passes (id, pass_type_id, remaining_balance, status, square_payment_id, qr_code)
  VALUES ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 60, 'active', 'SQ-PAY-PASS', 'PASS:FIXTURE-1');
SELECT public.t_as(NULL, 'service_role');
SET ROLE service_role;
SELECT public.t_expect('L1 a film-pass payment cannot confirm tickets',
  public.t_try($q$UPDATE public.tickets SET status = 'confirmed', square_payment_id = 'SQ-PAY-PASS' WHERE order_token = 'tok-card-2'$q$), 'PT423');
RESET ROLE;

-- =========================================================================
-- RLS-9 · releasing a card sale that never happened
-- =========================================================================
SELECT public.t_as(NULL, 'service_role');
SET ROLE service_role;
SELECT count(*) FROM public.create_ticket_order(:'showing', '[{}]', 'card', :'staff2', 'tok-card-staff2', 'pending');
RESET ROLE;

SELECT public.t_as(:'staff', 'authenticated');
SET ROLE authenticated;
-- The old path, kept as the "before": a direct update matches nothing.
SELECT public.t_check('RLS-9 baseline: staff direct UPDATE still matches 0 rows (no blanket policy added)',
  public.t_count($q$WITH u AS (UPDATE public.tickets SET status = 'failed' WHERE order_token = 'tok-card-2' RETURNING 1) SELECT count(*)::int FROM u$q$) = 0);
SELECT public.t_check('RLS-9 staff releases their own pending card sale',
  public.t_count($q$SELECT count(*)::int FROM public.release_pending_card_sale('tok-card-2', 'Canceled on the terminal')$q$) = 1);
SELECT public.t_check('RLS-9 ...and it does not release twice',
  public.t_count($q$SELECT count(*)::int FROM public.release_pending_card_sale('tok-card-2')$q$) = 0);
SELECT public.t_check('RLS-9 staff cannot release another staffer''s sale',
  public.t_count($q$SELECT count(*)::int FROM public.release_pending_card_sale('tok-card-staff2')$q$) = 0);
SELECT public.t_check('RLS-9 a confirmed card order is never released',
  public.t_count($q$SELECT count(*)::int FROM public.release_pending_card_sale('tok-card-1')$q$) = 0);
SELECT public.t_check('RLS-9 a cash order is never released',
  public.t_count($q$SELECT count(*)::int FROM public.release_pending_card_sale('tok-cash')$q$) = 0);
RESET ROLE;
SELECT public.t_check('RLS-9 the released rows read failed, with the reason',
  (SELECT bool_and(status = 'failed' AND payment_error = 'Canceled on the terminal') FROM public.tickets WHERE order_token = 'tok-card-2'));
SELECT public.t_as(:'admin', 'authenticated');
SET ROLE authenticated;
SELECT public.t_check('RLS-9 an admin can release anyone''s',
  public.t_count($q$SELECT count(*)::int FROM public.release_pending_card_sale('tok-card-staff2')$q$) = 1);
RESET ROLE;
SELECT public.t_as(:'patron', 'authenticated');
SET ROLE authenticated;
SELECT public.t_expect('RLS-9 a non-staff session is refused',
  public.t_try($q$SELECT * FROM public.release_pending_card_sale('tok-card-1')$q$), '42501');
RESET ROLE;
SET ROLE anon;
SELECT public.t_expect('RLS-9 anon cannot execute it',
  public.t_try($q$SELECT * FROM public.release_pending_card_sale('tok-card-1')$q$), '42501');
RESET ROLE;

-- =========================================================================
-- L3 · a film-pass refund credits the pass atomically, and not a dead one
-- =========================================================================
-- Three passes, each with one redemption against a real ticket.
SELECT public.t_as(NULL, 'service_role');
INSERT INTO public.user_film_passes (id, pass_type_id, remaining_balance, status, qr_code, expires_at) VALUES
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 0, 'depleted', 'PASS:FIXTURE-2', now() + interval '30 days'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 30, 'void', 'PASS:FIXTURE-3', now() + interval '30 days'),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', 30, 'active', 'PASS:FIXTURE-4', now() - interval '1 day');
INSERT INTO public.film_pass_redemptions (id, pass_id, ticket_id, amount_deducted, showing_id)
SELECT ('60000000-0000-0000-0000-00000000000' || n)::uuid, ('50000000-0000-0000-0000-00000000000' || n)::uuid,
       (SELECT id FROM public.tickets WHERE order_token = 'tok-cash' LIMIT 1 OFFSET (n - 1) % 2), 6, :'showing'
  FROM generate_series(1, 4) n;

SELECT public.t_as(:'staff', 'authenticated');
SET ROLE authenticated;
SELECT public.t_expect('L3 a session cannot call the pass credit',
  public.t_try($q$SELECT public.refund_film_pass_redemption('60000000-0000-0000-0000-000000000001')$q$), '42501');
RESET ROLE;
SELECT public.t_as(NULL, 'service_role');
SET ROLE service_role;
SELECT public.t_check('L3 active pass: credited in place',
  (public.t_json($q$SELECT public.refund_film_pass_redemption('60000000-0000-0000-0000-000000000001')$q$) ->> 'result') = 'credited');
SELECT public.t_check('L3 depleted pass: credited and spendable again',
  (public.t_json($q$SELECT public.refund_film_pass_redemption('60000000-0000-0000-0000-000000000002')$q$) ->> 'status') = 'active');
SELECT public.t_check('L3 void pass: not credited',
  (public.t_json($q$SELECT public.refund_film_pass_redemption('60000000-0000-0000-0000-000000000003')$q$) ->> 'result') = 'pass_not_creditable');
SELECT public.t_check('L3 expired-by-date pass: not credited',
  (public.t_json($q$SELECT public.refund_film_pass_redemption('60000000-0000-0000-0000-000000000004')$q$) ->> 'status') = 'expired');
SELECT public.t_check('L3 a redemption is credited once',
  (public.t_json($q$SELECT public.refund_film_pass_redemption('60000000-0000-0000-0000-000000000001')$q$) ->> 'result') = 'not_found');
RESET ROLE;
SELECT public.t_check('L3 balances: 66 / 6 / 30 (untouched) / 30 (untouched)',
  (SELECT array_agg(remaining_balance::numeric(6,2) ORDER BY id)::text FROM public.user_film_passes
    WHERE id IN ('50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002',
                 '50000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000004'))
  = '{66.00,6.00,30.00,30.00}',
  (SELECT array_agg(remaining_balance ORDER BY id)::text FROM public.user_film_passes WHERE qr_code LIKE 'PASS:FIXTURE-%'));
SELECT public.t_check('L3 the refused redemptions are kept (history matches balance)',
  (SELECT count(*) FROM public.film_pass_redemptions WHERE id IN ('60000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000004')) = 2);

-- =========================================================================
-- L14 · nobody writes an audit entry in someone else's name
-- =========================================================================
SELECT public.t_as(:'staff', 'authenticated');
SET ROLE authenticated;
SELECT public.t_expect('L14 staff cannot plant a non-auth entry',
  public.t_try($q$INSERT INTO public.admin_audit_log (actor_id, actor_email, action, entity_type, details)
    VALUES ('00000000-0000-0000-0000-0000000000c1', 'admin@x.test', 'tickets.refund', 'tickets', '{"amount": 500}')$q$), '42501');
SELECT public.t_expect('L14 staff cannot plant auth.login_failed either',
  public.t_try($q$INSERT INTO public.admin_audit_log (actor_id, action, entity_type)
    VALUES ('00000000-0000-0000-0000-0000000000c1', 'auth.login_failed', 'auth')$q$), '42501');
-- The one legitimate browser writer (src/lib/auditClient.ts), with a forged
-- email and details riding along.
SELECT public.t_expect('L14 auditClient sign-in still records',
  public.t_try($q$INSERT INTO public.admin_audit_log (actor_id, actor_email, action, entity_type, entity_id, details)
    VALUES ('00000000-0000-0000-0000-0000000000c1', 'admin@x.test', 'auth.login', 'auth',
            '00000000-0000-0000-0000-0000000000d1', '{"note": "planted"}')$q$), 'ok');
-- Naming someone else as the actor: the guard runs before the policy's WITH
-- CHECK and rewrites the actor to the caller, so the entry is about the caller.
SELECT public.t_expect('L14 a session naming another actor writes about itself',
  public.t_try($q$INSERT INTO public.admin_audit_log (actor_id, action, entity_type)
    VALUES ('00000000-0000-0000-0000-0000000000d1', 'auth.logout', 'auth')$q$), 'ok');
RESET ROLE;
SELECT public.t_check('L14 ...recorded as the caller, not the admin it named',
  (SELECT actor_id = '00000000-0000-0000-0000-0000000000c1' AND actor_email = 'staff@x.test'
     FROM public.admin_audit_log WHERE action = 'auth.logout' ORDER BY created_at DESC LIMIT 1));
SELECT public.t_check('L14 the sign-in row carries the real email, entity and no planted details',
  (SELECT actor_email = 'staff@x.test' AND entity_id = '00000000-0000-0000-0000-0000000000c1' AND details = '{}'::jsonb
     FROM public.admin_audit_log WHERE action = 'auth.login' ORDER BY created_at DESC LIMIT 1));

-- A server-side writer names an actor; the email comes from auth.users.
SELECT public.t_as(NULL, 'service_role');
SET ROLE service_role;
INSERT INTO public.admin_audit_log (actor_id, actor_email, action, entity_type, details)
  VALUES ('00000000-0000-0000-0000-0000000000c1', 'someone-else@x.test', 'integration.test', 'integration', '{"k": 1}');
RESET ROLE;
SELECT public.t_check('L14 service-role logAudit: email pinned to the actor',
  (SELECT actor_email = 'staff@x.test' AND details = '{"k": 1}'::jsonb FROM public.admin_audit_log WHERE action = 'integration.test'));

-- =========================================================================
-- M11 · a service-role write made for a staff caller names that caller
-- =========================================================================
SELECT public.t_as(NULL, 'service_role', '{"x-kw-actor-id": "00000000-0000-0000-0000-0000000000c1"}');
SET ROLE service_role;
UPDATE public.tickets SET status = 'refunded' WHERE order_token = 'tok-card-1';
RESET ROLE;
SELECT public.t_check('M11 refund write attributed to the verified staff caller',
  (SELECT bool_and(actor_id = '00000000-0000-0000-0000-0000000000c1' AND actor_email = 'staff@x.test')
     FROM public.admin_audit_log WHERE entity_type = 'tickets' AND details -> 'changes' -> 'status' ->> 'new' = 'refunded'
      AND entity_id IN (SELECT id FROM public.tickets WHERE order_token = 'tok-card-1')),
  (SELECT string_agg(COALESCE(actor_email, 'NULL'), ',') FROM public.admin_audit_log WHERE entity_type = 'tickets'
      AND entity_id IN (SELECT id FROM public.tickets WHERE order_token = 'tok-card-1') AND action = 'tickets.update'));
SELECT public.t_as(NULL, 'service_role');
SET ROLE service_role;
UPDATE public.tickets SET payment_error = 'cron' WHERE order_token = 'tok-cash';
RESET ROLE;
SELECT public.t_check('M11 without the header a service write stays "system"',
  (SELECT bool_and(actor_id IS NULL) FROM public.admin_audit_log WHERE entity_type = 'tickets'
      AND details -> 'changes' -> 'payment_error' ->> 'new' = 'cron'));
-- The header is honoured only on a service-role request.
SET ROLE anon;
SELECT public.t_as(NULL, 'anon', '{"x-kw-actor-id": "00000000-0000-0000-0000-0000000000d1"}');
SELECT public.log_failed_staff_login('staff@x.test');
RESET ROLE;
SELECT public.t_check('M11 an anon request carrying the header is not attributed',
  (SELECT actor_id IS NULL FROM public.admin_audit_log WHERE action = 'auth.login_failed' ORDER BY created_at DESC LIMIT 1));
SELECT public.t_as(NULL, 'service_role', '{"x-kw-actor-id": "not-a-uuid"}');
SET ROLE service_role;
SELECT public.t_expect('M11 a malformed header never fails the audited write',
  public.t_try($q$UPDATE public.tickets SET payment_error = 'x' WHERE order_token = 'tok-cash'$q$), 'ok');
RESET ROLE;

-- =========================================================================
-- L14 · coverage
-- =========================================================================
SELECT public.t_as(:'admin', 'authenticated');
INSERT INTO public.host_event_assignments (user_id, movie_id) VALUES (:'patron', '10000000-0000-0000-0000-000000000001');
INSERT INTO public.staff_square_links (user_id, square_team_member_id) VALUES (:'staff', 'TM-STAFF');
SELECT public.t_check('L14 host_event_assignments is audited, with the actor',
  EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'host_event_assignments.create' AND actor_email = 'admin@x.test'));
SELECT public.t_check('L14 staff_square_links is audited',
  EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'staff_square_links.create'));

INSERT INTO public.signing_keys (algorithm, private_key_b64, public_key_b64, active)
  VALUES ('ES256', 'PRIVATE-KEY-DO-NOT-LOG', 'public-key-ok', true);
SELECT public.t_check('L14 signing_keys is audited',
  EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'signing_keys.create'));
SELECT public.t_check('L14 ...and the private key never reaches the log',
  NOT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE details::text LIKE '%PRIVATE-KEY-DO-NOT-LOG%'));

-- A seat map: 120 seats in one statement is one entry, not 120.
INSERT INTO public.venues (id, name) VALUES ('70000000-0000-0000-0000-000000000001', 'Fixture Hall');
INSERT INTO public.venue_seats (venue_id, seat_row, seat_number, seat_type, section)
  SELECT '70000000-0000-0000-0000-000000000001', 'R' || (n / 20), n % 20, 'standard', 'main' FROM generate_series(1, 120) n;
INSERT INTO public.production_price_tiers (id, production_type, production_id, tier_name, price)
  VALUES ('80000000-0000-0000-0000-000000000001', 'movie', '10000000-0000-0000-0000-000000000001', 'Fixture Tier', 12);
SELECT public.t_check('L14 production_price_tiers is audited',
  EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'production_price_tiers.create'));
INSERT INTO public.production_seat_tiers (production_type, production_id, venue_seat_id, tier_template_id)
  SELECT 'movie', '10000000-0000-0000-0000-000000000001', id, '80000000-0000-0000-0000-000000000001'
    FROM public.venue_seats WHERE venue_id = '70000000-0000-0000-0000-000000000001';
SELECT public.t_check('L14 a 120-seat map is one statement entry: count 120, 50 rows kept',
  (SELECT count(*) = 1 AND min((details ->> 'count')::int) = 120 AND min(jsonb_array_length(details -> 'rows')) = 50
          AND bool_and((details ->> 'truncated')::boolean)
     FROM public.admin_audit_log WHERE action = 'production_seat_tiers.create'));
UPDATE public.production_seat_tiers SET created_at = created_at WHERE false;
SELECT public.t_check('L14 a statement that matches nothing logs nothing',
  NOT EXISTS (SELECT 1 FROM public.admin_audit_log WHERE action = 'production_seat_tiers.update'));
UPDATE public.production_seat_tiers SET tier_template_id = tier_template_id, created_at = created_at + interval '1 second'
  WHERE venue_seat_id = (SELECT id FROM public.venue_seats WHERE seat_row = 'R0' AND seat_number = 1);
SELECT public.t_check('L14 a one-seat update names the seat and the change',
  (SELECT (details -> 'rows' -> 0 -> 'changes') ? 'created_at' AND entity_id IS NOT NULL
     FROM public.admin_audit_log WHERE action = 'production_seat_tiers.update'));
DELETE FROM public.production_seat_tiers;
SELECT public.t_check('L14 clearing the map is one entry',
  (SELECT count(*) = 1 FROM public.admin_audit_log WHERE action = 'production_seat_tiers.delete'));

SELECT public.t_check('L14 every listed table carries a trigger',
  (SELECT count(DISTINCT c.relname) = 12 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND t.tgfoid::regproc::text IN ('log_audit_event', 'log_audit_statement')
      AND c.relname IN ('host_event_assignments', 'staff_square_links', 'production_price_tiers', 'account_mappings',
                        'chart_of_accounts', 'qbo_connection', 'payroll_exports', 'signing_keys',
                        'production_seat_tiers', 'showing_seat_tiers', 'pass_type_showings', 'financial_entries')));

-- =========================================================================
\echo
SELECT n, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS verdict, name, detail FROM public.t_results ORDER BY n;
DO $$
DECLARE f integer; t integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT pass), count(*) INTO f, t FROM public.t_results;
  RAISE NOTICE '% of % staff-boundary cases passed', t - f, t;
  IF f > 0 THEN RAISE EXCEPTION '% case(s) failed', f; END IF;
END $$;
