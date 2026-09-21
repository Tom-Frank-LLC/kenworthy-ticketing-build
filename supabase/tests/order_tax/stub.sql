-- Minimal stand-in for the parts of the real schema enforce_ticket_pricing
-- touches. Column names and types follow production; everything the trigger
-- does not read is left out. run.sh streams in the REAL trigger migrations
-- after this, so the function bodies under test are the shipped ones.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.showings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_price numeric NOT NULL DEFAULT 8.00
);
CREATE TABLE public.showing_price_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showing_id uuid NOT NULL REFERENCES public.showings(id),
  tier_name text NOT NULL,
  price numeric NOT NULL
);
CREATE TABLE public.venue_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_row text, seat_number int, section text
);
CREATE TABLE public.seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seat_row text, seat_number int, section text
);
CREATE TABLE public.showing_seat_tiers (
  showing_id uuid, venue_seat_id uuid, tier_id uuid
);
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showing_id uuid NOT NULL REFERENCES public.showings(id),
  seat_id uuid,
  tier_id uuid,
  price numeric NOT NULL,
  tax_rate numeric NOT NULL DEFAULT 0.06,
  tax_amount numeric NOT NULL,
  total_price numeric NOT NULL,
  processing_fee numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'confirmed',
  payment_method text NOT NULL DEFAULT 'online',
  order_token text NOT NULL DEFAULT gen_random_uuid()::text
);
