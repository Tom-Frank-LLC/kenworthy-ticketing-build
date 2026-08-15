\set ON_ERROR_STOP on
\pset pager off

-- Actors
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@kenworthy.org'),
  ('22222222-2222-2222-2222-222222222222', 'staff@kenworthy.org'),
  ('33333333-3333-3333-3333-333333333333', 'member@example.com');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'staff'),
  ('33333333-3333-3333-3333-333333333333', 'member');

SET test.uid = '11111111-1111-1111-1111-111111111111';

\echo '=== T1: app_config has no id column -> entity_key must name the setting ==='
INSERT INTO public.app_config (key, value) VALUES ('hiring_enabled', '{"enabled": true}'::jsonb);
UPDATE public.app_config SET value = '{"enabled": false}'::jsonb WHERE key = 'hiring_enabled';
SELECT action, entity_id, details ->> 'entity_key' AS entity_key, details -> 'changes' AS changes
  FROM public.admin_audit_log WHERE entity_type = 'app_config' ORDER BY created_at;

\echo '=== T2: a capability token must never reach the log ==='
INSERT INTO public.rental_requests (status) VALUES ('pending');
UPDATE public.rental_requests SET invite_token = 'BRAND-NEW-SECRET-VALUE', status = 'sent';
SELECT action,
       details -> 'new' ->> 'invite_token'              AS insert_token,
       details -> 'changes' -> 'invite_token'           AS update_token,
       details -> 'changes' -> 'status'                 AS status_change
  FROM public.admin_audit_log WHERE entity_type = 'rental_requests' ORDER BY created_at;
\echo '--- the literal secret must appear nowhere in the whole log ---'
SELECT count(*) AS leaked_rows FROM public.admin_audit_log WHERE details::text LIKE '%BRAND-NEW-SECRET-VALUE%';

\echo '=== T3: redaction reaches inside a jsonb column ==='
INSERT INTO public.app_config (key, value)
  VALUES ('mailchimp', '{"audience_id": "abc123", "api_key": "mc-live-DO-NOT-LOG", "nested": {"access_token": "tok-DO-NOT-LOG"}}'::jsonb);
SELECT details -> 'new' -> 'value' AS logged_value
  FROM public.admin_audit_log WHERE details ->> 'entity_key' = 'mailchimp';
SELECT count(*) AS leaked_rows FROM public.admin_audit_log WHERE details::text LIKE '%DO-NOT-LOG%';

\echo '=== T4: append-only ledgers log edits, not the sale itself ==='
INSERT INTO public.concession_sales (total) VALUES (12.50);
SELECT count(*) AS should_be_0 FROM public.admin_audit_log WHERE entity_type = 'concession_sales';
UPDATE public.concession_sales SET total = 1.00;
SELECT action, details -> 'changes' -> 'total' AS change
  FROM public.admin_audit_log WHERE entity_type = 'concession_sales';
DELETE FROM public.concession_sales;
SELECT action FROM public.admin_audit_log WHERE entity_type = 'concession_sales' ORDER BY created_at;

\echo '=== T5: bulk suppression ==='
-- Stand in for square-catalog-sync pulling the catalog.
SELECT public.audit_bulk_begin(
  ARRAY['venue_seats'], 'venue_seats.bulk_sync',
  jsonb_build_object('source', 'test'), 10) AS run_id \gset
\echo '--- a ".started" row is written BEFORE anything is suppressed ---'
SELECT action, entity_type, details ->> 'source' AS source, details -> 'tables' AS tables
  FROM public.admin_audit_log WHERE action = 'venue_seats.bulk_sync.started';
\echo '--- 500 writes during suppression produce zero per-row entries ---'
DO $$ BEGIN
  FOR i IN 1..500 LOOP
    INSERT INTO public.venue_seats (seat_row, seat_number) VALUES ('A', i);
  END LOOP;
END $$;
SELECT count(*) AS per_row_entries FROM public.admin_audit_log WHERE action = 'venue_seats.create';
SELECT public.audit_bulk_end(:'run_id'::uuid, 'venue_seats.bulk_sync', jsonb_build_object('pulled', 500));
SELECT action, details ->> 'pulled' AS pulled FROM public.admin_audit_log WHERE action = 'venue_seats.bulk_sync';
SELECT count(*) AS suppressions_left FROM public.audit_suppression;
\echo '--- and logging resumes afterwards ---'
INSERT INTO public.venue_seats (seat_row, seat_number) VALUES ('B', 1);
SELECT count(*) AS per_row_entries_after FROM public.admin_audit_log WHERE action = 'venue_seats.create';

\echo '=== T6: a crashed importer un-suppresses itself when expires_at passes ==='
SELECT public.audit_bulk_begin(ARRAY['venues'], 'venues.bulk', '{}'::jsonb, 10) AS r2 \gset
UPDATE public.audit_suppression SET expires_at = now() - interval '1 second' WHERE table_name = 'venues';
INSERT INTO public.venues (name) VALUES ('Main Auditorium');
SELECT count(*) AS logged_after_expiry FROM public.admin_audit_log WHERE action = 'venues.create';

\echo '=== T7: a non-uuid primary key must not break the write it audits ==='
CREATE TRIGGER audit_bigint_keyed AFTER INSERT OR UPDATE OR DELETE ON public.bigint_keyed
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
INSERT INTO public.bigint_keyed (label) VALUES ('survives');
SELECT count(*) AS row_written FROM public.bigint_keyed WHERE label = 'survives';
SELECT action, entity_id, details ->> 'entity_key' AS entity_key
  FROM public.admin_audit_log WHERE entity_type = 'bigint_keyed';

\echo '=== T8: failed sign-ins ==='
SET test.uid = '';
SELECT public.log_failed_staff_login('nobody@nowhere.test');   -- unknown address
SELECT public.log_failed_staff_login('member@example.com');    -- real, but not staff
SELECT public.log_failed_staff_login('STAFF@KENWORTHY.ORG');   -- staff, case-insensitive
SELECT public.log_failed_staff_login('staff@kenworthy.org');   -- immediate retry, rate-limited
SELECT actor_id, actor_email, action, entity_type, entity_id
  FROM public.admin_audit_log WHERE action = 'auth.login_failed';
\echo '--- expected: exactly one row, for the staff account only ---'
SELECT count(*) AS failed_login_rows FROM public.admin_audit_log WHERE action = 'auth.login_failed';

\echo '=== T9: the actor is still resolved from auth.uid() ==='
SET test.uid = '22222222-2222-2222-2222-222222222222';
UPDATE public.venues SET name = 'Renamed by staff';
SELECT actor_email, action FROM public.admin_audit_log WHERE action = 'venues.update';

\echo '=== T10: the SQL rule must classify exactly as the Deno rule does ==='
-- Same key list as supabase/functions/_shared/audit_test.ts. Any row where
-- sql_says <> ts_expects is the two copies of the rule drifting apart.
WITH cases(k, ts_expects) AS (VALUES
  ('invite_token', true), ('access_token', true), ('refresh_token', true),
  ('checkout_idempotency_key', true), ('api_key', true), ('apiKey', true),
  ('RESEND_API_KEY', true), ('square_access_token', true), ('webhook_secret', true),
  ('password', true), ('signature', true), ('private_key', true),
  ('name', false), ('price', false), ('status', false), ('square_catalog_id', false),
  ('audience_id', false), ('entity_key', false), ('created_at', false), ('email', false),
  ('key', false), ('KEY', false), ('source_key', false), ('account_source_key', false)
)
SELECT k, ts_expects, public.audit_is_secret_key(k) AS sql_says
  FROM cases WHERE public.audit_is_secret_key(k) IS DISTINCT FROM ts_expects;
\echo '--- expected: 0 rows above ---'

\echo '=== T11: actor pass-through for admin-triggered syncs ==='
SET test.uid = '';   -- service_role: auth.uid() is null, as in an edge function
SELECT public.audit_bulk_begin(
  ARRAY['donations'], 'donations.lgl_sync', '{}'::jsonb, 10,
  '11111111-1111-1111-1111-111111111111'::uuid) AS r3 \gset
SELECT public.audit_bulk_end(:'r3'::uuid, 'donations.lgl_sync',
  jsonb_build_object('synced', 3), '11111111-1111-1111-1111-111111111111'::uuid);
SELECT action, actor_email FROM public.admin_audit_log
 WHERE action LIKE 'donations.lgl_sync%' ORDER BY created_at;
\echo '--- and a webhook run with no caller stays system ---'
SELECT public.audit_bulk_begin(ARRAY['donations'], 'donations.webhook', '{}'::jsonb, 10) AS r4 \gset
SELECT action, actor_id, actor_email FROM public.admin_audit_log
 WHERE action = 'donations.webhook.started';
