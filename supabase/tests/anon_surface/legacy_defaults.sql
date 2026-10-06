-- Supabase's legacy default privileges: every table, function and sequence a
-- migration creates in public is granted to anon and authenticated directly,
-- not only through PUBLIC. Production carries these (the 2026-08-14 audit
-- found anon holding INSERT/UPDATE/DELETE there); staging does not. Under
-- them, `REVOKE … FROM PUBLIC` leaves anon's own grant standing, which is the
-- hole a PUBLIC-only revoke tests clean on staging and leaves open on
-- production. run.sh replays once with this file and once without.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
