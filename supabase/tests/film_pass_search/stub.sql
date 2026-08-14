-- Minimum surrounding schema so the two migrations run for real.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TYPE public.app_role AS ENUM ('admin', 'staff', 'user');

-- Swappable stand-ins for the Supabase built-ins.
CREATE TABLE auth._who (uid uuid, role_name text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT uid FROM auth._who LIMIT 1 $$;
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
  RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM auth._who w WHERE w.uid = _user_id AND w.role_name = _role::text) $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  display_name text,
  email text,
  phone text
);

CREATE TABLE public.film_pass_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  initial_balance numeric DEFAULT 60,
  redemption_price numeric DEFAULT 6
);

CREATE TABLE public.tickets (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.showings (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

CREATE TABLE public.user_film_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_type_id uuid REFERENCES public.film_pass_types(id),
  qr_code text,
  batch_id uuid,
  status text NOT NULL DEFAULT 'unassigned',
  user_id uuid REFERENCES public.profiles(id),
  remaining_balance numeric,
  payment_method text DEFAULT 'cash',
  purchased_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.film_pass_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id uuid REFERENCES public.user_film_passes(id) ON DELETE SET NULL,
  buyer_name text,
  buyer_email text,
  buyer_phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.film_pass_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id uuid NOT NULL REFERENCES public.user_film_passes(id) ON DELETE CASCADE,
  ticket_id uuid,
  amount_deducted numeric NOT NULL DEFAULT 6,
  redeemed_at timestamptz NOT NULL DEFAULT now()
);

-- Pre-existing stock, so the backfill has something to number.
INSERT INTO public.film_pass_types (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', '10-Film Pass');

INSERT INTO public.profiles (id, display_name, email, phone) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Jane Smith', 'jane@example.com', '(208) 555-1234'),
  ('33333333-3333-3333-3333-333333333333', 'Bob Jones',  'bob@example.com',  '208.555.9876'),
  ('44444444-4444-4444-4444-444444444444', 'Admin User', 'admin@example.com', NULL);

INSERT INTO public.user_film_passes
  (id, pass_type_id, qr_code, status, user_id, remaining_balance, purchased_at, created_at, expires_at)
VALUES
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'PASS:aaaa1111-0000-0000-0000-000000000001', 'active',
   '22222222-2222-2222-2222-222222222222', 42, now() - interval '3 days', now() - interval '3 days',
   now() + interval '300 days'),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'PASS:aaaa1111-0000-0000-0000-000000000002', 'depleted',
   '33333333-3333-3333-3333-333333333333', 0, now() - interval '2 days', now() - interval '2 days',
   now() + interval '100 days'),
  -- Bearer pass: no account at all, contact exists only on the order.
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'PASS:aaaa1111-0000-0000-0000-000000000003', 'void',
   NULL, 18, now() - interval '1 day', now() - interval '1 day', now() + interval '50 days'),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'PASS:aaaa1111-0000-0000-0000-000000000004', 'unassigned',
   NULL, NULL, now(), now(), NULL);

INSERT INTO public.film_pass_orders (pass_id, buyer_name, buyer_email, buyer_phone) VALUES
  ('a0000000-0000-0000-0000-000000000003', 'Carol Bearer', 'carol@example.com', '+1 (208) 555-7777');

INSERT INTO public.film_pass_redemptions (pass_id) VALUES
  ('a0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000002');
