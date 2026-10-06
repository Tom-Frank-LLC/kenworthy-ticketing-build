-- The smallest schema activate_film_pass touches, with the columns and
-- constraints production has (20260403005941, 20260813000000). run.sh then
-- installs the OLD function straight out of 20260813000000, records what it
-- does, and applies the real new migration on top.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;

CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.film_pass_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price numeric NOT NULL DEFAULT 60,
  initial_balance numeric NOT NULL DEFAULT 60,
  redemption_price numeric(10,2) NOT NULL DEFAULT 6.00,
  expiration_days integer
);
CREATE TABLE public.user_film_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  pass_type_id uuid NOT NULL REFERENCES public.film_pass_types(id),
  remaining_balance numeric,
  payment_method text NOT NULL DEFAULT 'online',
  purchased_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'unassigned'
    CHECK (status IN ('unassigned', 'active', 'depleted', 'expired', 'void', 'refunded')),
  price_paid numeric,
  square_payment_id text,
  qr_code text UNIQUE,
  activated_at timestamptz,
  activated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE TABLE public.film_pass_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  pass_type_id uuid NOT NULL REFERENCES public.film_pass_types(id),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  fulfillment text NOT NULL DEFAULT 'pickup',
  amount_paid numeric(10,2),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'fulfilled', 'failed', 'void')),
  pass_id uuid REFERENCES public.user_film_passes(id) ON DELETE SET NULL,
  fulfilled_at timestamptz,
  fulfilled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.profiles (id) VALUES
  ('00000000-0000-0000-0000-0000000000a1'),  -- the buyer
  ('00000000-0000-0000-0000-0000000000a2'),  -- second buyer
  ('00000000-0000-0000-0000-0000000000f0');  -- box office staff
INSERT INTO public.film_pass_types (id, name, price, initial_balance, redemption_price, expiration_days)
  VALUES ('00000000-0000-0000-0000-0000000000b1', '10-Film Pass', 60, 60, 6, 365);
-- Ten blank stickers.
INSERT INTO public.user_film_passes (pass_type_id, qr_code)
  SELECT '00000000-0000-0000-0000-0000000000b1', 'PASS:' || lpad(g::text, 4, '0') FROM generate_series(1, 10) g;
-- Orders: three passes, one pass, and (for the old function) one more three.
INSERT INTO public.film_pass_orders (id, user_id, pass_type_id, quantity, amount_paid, status) VALUES
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 3, 190.80, 'paid'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', 1, 63.60, 'paid'),
  ('00000000-0000-0000-0000-0000000000c0', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', 3, 190.80, 'paid');
