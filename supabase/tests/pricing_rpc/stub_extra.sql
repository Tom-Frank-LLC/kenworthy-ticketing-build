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
-- How people get in (the real enum is in 20260402031617; movies gain the
-- columns in 20260922203433, which the harness applies).
CREATE TYPE public.event_ticket_type AS ENUM ('ticketed', 'rsvp', 'info_only');
ALTER TABLE public.events ADD COLUMN ticket_type public.event_ticket_type NOT NULL DEFAULT 'ticketed', ADD COLUMN rsvp_url text;
ALTER TABLE public.live_performances ADD COLUMN ticket_type public.event_ticket_type NOT NULL DEFAULT 'ticketed', ADD COLUMN rsvp_url text;
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
-- Hosts (for comps through create_ticket_order): a stand-in for the real
-- is_host_of_showing, driven by a table the test fills.
CREATE TABLE public.host_assignments (user_id uuid, showing_id uuid);
CREATE FUNCTION public.is_host_of_showing(_user_id uuid, _showing_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.host_assignments WHERE user_id = _user_id AND showing_id = _showing_id) $$;
ALTER TABLE public.tickets ADD COLUMN comp_recipient_name text, ADD COLUMN comp_recipient_email text, ADD COLUMN issued_by_user_id uuid;
