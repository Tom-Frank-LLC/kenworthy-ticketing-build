-- Grant full table access to service_role on all public tables.
-- service_role is used by edge functions and must bypass RLS with full CRUD.
-- Earlier migrations granted permissions inconsistently, leaving service_role
-- with only TRUNCATE/REFERENCES/TRIGGER on many tables (missing SELECT/INSERT/UPDATE/DELETE).
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- Also ensure future tables created by migrations get the same grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
