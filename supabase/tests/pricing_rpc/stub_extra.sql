-- On top of order_tax/stub.sql and ticket_discounts/stub_extra.sql: what
-- price_ticket_order additionally reads.
ALTER TABLE public.showings
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN no_ticket_required boolean NOT NULL DEFAULT false,
  ADD COLUMN manually_sold_out boolean NOT NULL DEFAULT false,
  ADD COLUMN sold_out_message text,
  ADD COLUMN start_time timestamptz DEFAULT now() + interval '7 days',
  ADD COLUMN duration_minutes integer;
ALTER TABLE public.movies ADD COLUMN pass_processing_fee boolean DEFAULT false, ADD COLUMN duration_minutes integer;
ALTER TABLE public.events ADD COLUMN pass_processing_fee boolean DEFAULT false;
ALTER TABLE public.live_performances ADD COLUMN pass_processing_fee boolean DEFAULT false;
ALTER TABLE public.showing_price_tiers ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.tickets
  ADD COLUMN user_id uuid, ADD COLUMN qr_code text, ADD COLUMN square_payment_id text,
  ADD COLUMN checkout_idempotency_key text, ADD COLUMN sms_consent boolean;
-- Stand-ins for the end-of-show rules (the real ones are in 20260819143722).
CREATE FUNCTION public.showing_ends_at(s public.showings) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT s.start_time + make_interval(mins => COALESCE(s.duration_minutes, 120)) $$;
CREATE FUNCTION public.door_grace_window() RETURNS interval LANGUAGE sql IMMUTABLE AS $$ SELECT interval '30 minutes' $$;
-- auth.role() is driven by a GUC, like auth.uid().
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.authrole', true) $$;
