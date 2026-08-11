-- Grant authenticated role the table-level write privileges its RLS policies
-- already gate. Lovable's migrations granted these inconsistently: core content
-- tables (movies, events, showings, etc.) received only SELECT for authenticated,
-- so admin edits (e.g. adding a movie trailer) failed with "permission denied"
-- BEFORE RLS was ever evaluated. Table GRANTs open the door; the existing
-- per-table RLS policies remain the lock (verified: every table below already
-- has admin-gated INSERT/UPDATE/DELETE policies).
--
-- Privileges are matched to each table's existing policy set — we do NOT grant
-- UPDATE/DELETE where no such policy exists.
--
-- Deliberately EXCLUDED (security-sensitive; writes go through service_role /
-- edge functions, not authenticated users directly):
--   user_roles, profiles, tickets, seats, signing_keys, qbo_connection,
--   qbo_sync_jobs, admin_audit_log, account_mappings, chart_of_accounts,
--   dvd_settings, app_config
-- These are left as-is on purpose.

-- Full CRUD (INSERT/UPDATE/DELETE policies all present)
GRANT INSERT, UPDATE, DELETE ON public.movies                 TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.events                 TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.live_performances      TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.showings               TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.showing_price_tiers    TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.venues                 TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.venue_seats            TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.film_pass_types        TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_film_passes       TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.concession_items       TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.concession_menus       TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.concession_combo_items TO authenticated;

-- INSERT + DELETE only (no UPDATE policy)
GRANT INSERT, DELETE ON public.concession_sale_items  TO authenticated;
GRANT INSERT, DELETE ON public.host_event_assignments TO authenticated;

-- INSERT + UPDATE + DELETE for sales header (has all three)
GRANT INSERT, UPDATE, DELETE ON public.concession_sales TO authenticated;

-- INSERT only (only an INSERT policy exists)
GRANT INSERT ON public.donations             TO authenticated;
GRANT INSERT ON public.film_pass_redemptions TO authenticated;
