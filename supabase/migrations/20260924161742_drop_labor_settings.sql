-- Drop labor_settings.
--
-- The table held the Wage & Tip Rules screen's one row (overtime threshold,
-- tip method, per-role wage defaults). That screen is removed with this
-- migration's PR, and nothing else ever read the table: the payroll export,
-- the timecards and the QBO sync all take hours and wages from Square Labor
-- directly, so the rules here were written to and never consulted. Dropping
-- it removes a dormant admin-writable table rather than leaving it to be
-- rediscovered as "settings that do not do anything".
--
-- CASCADE takes the RLS policy and the updated_at trigger with it. Nothing
-- references the table by foreign key (its only FK points outward, to
-- auth.users), so nothing else is affected.

DROP TABLE IF EXISTS public.labor_settings CASCADE;
