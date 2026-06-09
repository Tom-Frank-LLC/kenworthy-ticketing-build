CREATE TABLE public.donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  amount_cents integer NOT NULL CHECK (amount_cents >= 100 AND amount_cents <= 10000000),
  donor_name text NOT NULL,
  donor_email text NOT NULL,
  donor_phone text,
  dedication_type text CHECK (dedication_type IN ('in_honor', 'in_memory')),
  dedicate_to text,
  notify_name text,
  notify_email text,
  message text,
  square_payment_id text,
  square_receipt_url text,
  status text NOT NULL DEFAULT 'pending',
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT ON public.donations TO authenticated;
GRANT ALL ON public.donations TO service_role;

ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all donations"
  ON public.donations FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Donors can view their own donations"
  ON public.donations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_donations_created_at ON public.donations(created_at DESC);
CREATE INDEX idx_donations_user_id ON public.donations(user_id);