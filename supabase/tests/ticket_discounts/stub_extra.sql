-- On top of ../order_tax/stub.sql: what the discounts migration additionally
-- touches — the three production tables, the role helpers RLS calls, and the two
-- shared trigger functions it attaches.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TYPE public.app_role AS ENUM ('admin', 'regular_user', 'staff', 'host', 'superadmin');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
-- The test names its actor's role directly; the real has_role is covered by supabase/tests/roles.
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT current_setting('test.role', true) = _role::text $$;
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE FUNCTION public.log_audit_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RETURN NULL; END $$;

CREATE TABLE public.movies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text);
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text);
CREATE TABLE public.live_performances (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text);
ALTER TABLE public.showings
  ADD COLUMN movie_id uuid REFERENCES public.movies(id),
  ADD COLUMN event_id uuid REFERENCES public.events(id),
  ADD COLUMN live_performance_id uuid REFERENCES public.live_performances(id);
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
