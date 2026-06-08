
CREATE TYPE public.rental_request_status AS ENUM ('pending', 'reviewing', 'approved', 'declined', 'archived');

CREATE TABLE public.rental_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Contact & Event
  event_title text NOT NULL,
  proposed_date date,
  organization_name text,
  applicant_name text NOT NULL,
  email text NOT NULL,
  phone text,
  secondary_contact_name text,
  secondary_contact_email text,
  secondary_contact_phone text,
  -- Marquee
  marquee_text text,
  -- Concessions
  wants_concessions boolean DEFAULT false,
  wants_beer_wine boolean DEFAULT false,
  -- Setup
  arrival_time text,
  event_start_time text,
  event_end_time text,
  departure_time text,
  venue_area text, -- 'main_auditorium_projection' | 'main_auditorium_no_projection' | 'main_stage' | 'backstage_speakeasy'
  -- Equipment (quantities as JSONB)
  equipment jsonb DEFAULT '{}'::jsonb,
  -- Ticketing
  is_ticketed boolean DEFAULT false,
  is_public boolean DEFAULT false,
  needs_digital_ticketing boolean DEFAULT false,
  -- Guests
  expected_guests integer,
  age_range text,
  special_needs text,
  accessibility_requirements text,
  -- Film/Media
  renter_provides_media boolean DEFAULT false,
  kenworthy_provides_media boolean DEFAULT false,
  media_notes text,
  -- Description
  event_description text,
  activity_order text,
  -- Admin/workflow
  status public.rental_request_status NOT NULL DEFAULT 'pending',
  admin_notes text,
  invite_token text UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  linked_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.rental_requests TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.rental_requests TO authenticated;
GRANT ALL ON public.rental_requests TO service_role;

ALTER TABLE public.rental_requests ENABLE ROW LEVEL SECURITY;

-- Anyone can submit a request
CREATE POLICY "Anyone can submit rental requests"
  ON public.rental_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Admins/staff can view all
CREATE POLICY "Admins view all rental requests"
  ON public.rental_requests FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins update rental requests"
  ON public.rental_requests FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete rental requests"
  ON public.rental_requests FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_rental_requests_updated_at
  BEFORE UPDATE ON public.rental_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_rental_requests_status ON public.rental_requests(status, submitted_at DESC);
