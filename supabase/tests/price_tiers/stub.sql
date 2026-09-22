-- Stand-in for the parts of the real schema showing_price_tiers touches.
-- Column names, defaults and — the point of this test — the foreign-key
-- semantics follow production: tickets.tier_id has NO ON DELETE clause
-- (20260403002353) and showing_seat_tiers.tier_id cascades (20260617060311).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TYPE public.app_role AS ENUM ('admin', 'regular_user', 'staff', 'host', 'superadmin');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
-- The test names its actor's role directly; the real has_role is covered by supabase/tests/roles.
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT current_setting('test.role', true) = _role::text $$;

CREATE TABLE public.showings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_price numeric NOT NULL DEFAULT 8.00,
  no_ticket_required boolean NOT NULL DEFAULT false
);
CREATE TABLE public.showing_price_tiers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  showing_id uuid NOT NULL REFERENCES public.showings(id) ON DELETE CASCADE,
  tier_name text NOT NULL DEFAULT 'Adult',
  price numeric NOT NULL DEFAULT 8.00,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  color text NOT NULL DEFAULT '#9C3FA0'
);
CREATE TABLE public.venue_seats (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.showing_seat_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showing_id uuid NOT NULL REFERENCES public.showings(id) ON DELETE CASCADE,
  venue_seat_id uuid NOT NULL REFERENCES public.venue_seats(id) ON DELETE CASCADE,
  tier_id uuid NOT NULL REFERENCES public.showing_price_tiers(id) ON DELETE CASCADE,
  UNIQUE (showing_id, venue_seat_id)
);
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showing_id uuid NOT NULL REFERENCES public.showings(id),
  tier_id uuid REFERENCES public.showing_price_tiers(id),
  price numeric NOT NULL DEFAULT 0
);
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
