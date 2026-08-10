-- Grant SELECT on all current public tables to anon and authenticated roles.
-- This fixes inconsistent per-table grants from earlier migrations.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
  END LOOP;
END $$;
