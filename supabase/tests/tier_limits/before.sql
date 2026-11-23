-- Production's shapes, written BEFORE the migration, against the shipped
-- trigger. Most showings here have no tiers at all; tiered GA showings have no
-- limit, because there was no such thing. test.sql §0 re-runs these exact
-- shapes after the migration and requires identical outcomes.
--
--   a001  untiered GA, 3 seats
--   b001  tiered GA (Preferred / General), 4 seats — the ballet's shape today
--   c001  assigned seating, a tier on seats
\set ON_ERROR_STOP 1

INSERT INTO public.showings (id, total_seats) VALUES
  ('00000000-0000-0000-0000-00000000a001', 3),
  ('00000000-0000-0000-0000-00000000b001', 4);
INSERT INTO public.showings (id, total_seats, requires_seat_selection) VALUES
  ('00000000-0000-0000-0000-00000000c001', 200, true);
INSERT INTO public.showing_price_tiers (id, showing_id, tier_name, price, display_order) VALUES
  ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-00000000b001', 'Preferred Seating', 40, 0),
  ('00000000-0000-0000-0000-0000000b0002', '00000000-0000-0000-0000-00000000b001', 'General Admission', 25, 1),
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-00000000c001', 'Orchestra', 30, 0);
INSERT INTO public.venue_seats (id) SELECT ('00000000-0000-0000-0000-0000000005' || lpad(g::text, 2, '0'))::uuid FROM generate_series(1, 10) g;

-- The defect being fixed, shown on the shipped code: Preferred can take the
-- whole house. All four inserts succeed.
INSERT INTO public.tickets (showing_id, tier_id)
  SELECT '00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000b0001' FROM generate_series(1, 4);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.tickets WHERE tier_id = '00000000-0000-0000-0000-0000000b0001') <> 4 THEN
    RAISE EXCEPTION 'baseline: expected Preferred to take all 4 seats on the shipped trigger';
  END IF;
  RAISE NOTICE 'baseline ok: shipped trigger lets one GA tier take the whole house';
END $$;
DELETE FROM public.tickets;

-- Baseline availability rows, to compare after.
CREATE TABLE public._baseline_availability AS
  SELECT s.id, a.total_seats, a.requires_seat_selection, a.held, a.available, a.taken_seat_ids
    FROM public.showings s, LATERAL public.showing_availability(s.id) a;
