-- Minimal stand-in for the parts of the real schema the migration touches.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);

CREATE TYPE public.app_role AS ENUM ('superadmin','admin','staff','host','member');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL
);

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- auth.uid() is driven by a GUC here so tests can switch actor.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid;
$$;

CREATE TABLE public.admin_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audited tables (only the columns that matter to the trigger's behaviour).
CREATE TABLE public.concession_menus       (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, updated_at timestamptz DEFAULT now());
CREATE TABLE public.concession_combo_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quantity int);
CREATE TABLE public.donations              (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), amount numeric, donor_email text);
CREATE TABLE public.film_pass_orders       (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, checkout_idempotency_key text);
CREATE TABLE public.rental_requests        (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, invite_token text DEFAULT encode(gen_random_bytes(16),'hex'));
CREATE TABLE public.rental_invoice_lines   (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), description text, amount numeric);
CREATE TABLE public.app_config             (key text PRIMARY KEY, value jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.venues                 (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.venue_seats            (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), seat_row text, seat_number int);
CREATE TABLE public.showing_price_tiers    (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label text, price numeric);
CREATE TABLE public.concession_sales       (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), total numeric);
CREATE TABLE public.film_pass_redemptions  (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pass_id uuid);

-- A table keyed by something that is neither a uuid id nor a known alternate,
-- to prove the trigger degrades instead of raising.
CREATE TABLE public.bigint_keyed (id bigserial PRIMARY KEY, label text);
