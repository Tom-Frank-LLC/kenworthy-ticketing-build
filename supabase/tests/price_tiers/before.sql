\set ON_ERROR_STOP 1
-- Runs BEFORE the migration under test, against the shipped trigger: seeds
-- production's exact damage and proves the mechanism that caused it.
CREATE TABLE public.results (n serial, name text, pass boolean, detail text);
CREATE FUNCTION public.try_sql(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ': ' || SQLERRM; END $$;
CREATE FUNCTION public.expect(name text, got text, want_prefix text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.results (name, pass, detail) VALUES (name, got LIKE want_prefix || '%', got) $$;
CREATE FUNCTION public.check(name text, ok boolean, detail text DEFAULT '') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.results (name, pass, detail) VALUES (name, ok, detail) $$;

-- The Paragon Ragtime showing as production held it on 22 Sep 2026: General
-- Admission ×4 and Preferred Seating ×3, created 31 Aug, 9 Sep, and twice on
-- 22 Sep. A ticket sold against the 31 Aug GA row.
INSERT INTO public.showings (id, ticket_price) VALUES ('00000000-0000-0000-0000-00000000e533', 50);
INSERT INTO public.showing_price_tiers (id, showing_id, tier_name, price, display_order, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e533', 'General Admission', 50, 0, '2026-08-31 15:20+00'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000e533', 'General Admission', 50, 0, '2026-09-09 13:32+00'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000e533', 'General Admission', 50, 0, '2026-09-22 16:43+00'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000e533', 'General Admission', 50, 0, '2026-09-22 16:50+00'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000e533', 'Preferrred Seating', 75, 1, '2026-08-31 15:20+00'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-00000000e533', 'Preferrred Seating', 75, 1, '2026-09-22 16:43+00'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-00000000e533', 'Preferrred Seating', 75, 1, '2026-09-22 16:50+00');
INSERT INTO public.tickets (showing_id, tier_id, price) VALUES
  ('00000000-0000-0000-0000-00000000e533', '00000000-0000-0000-0000-0000000000a1', 50),
  -- and one against the 9 Sep duplicate: a buyer clicked the second "General Admission"
  ('00000000-0000-0000-0000-00000000e533', '00000000-0000-0000-0000-0000000000a2', 50);

-- The mechanism. This is the statement ShowingForm ran and never checked.
SELECT public.expect('delete-all-tiers is refused once a ticket references one (23503)', public.try_sql($q$
  DELETE FROM public.showing_price_tiers WHERE showing_id = '00000000-0000-0000-0000-00000000e533'$q$), '23503');
SELECT public.check('and so nothing was deleted',
  (SELECT count(*) FROM public.showing_price_tiers WHERE showing_id = '00000000-0000-0000-0000-00000000e533') = 7);
-- ...after which the form's insert appended another full set. Reproduced:
INSERT INTO public.showing_price_tiers (showing_id, tier_name, price, display_order) VALUES
  ('00000000-0000-0000-0000-00000000e533', 'General Admission', 50, 0),
  ('00000000-0000-0000-0000-00000000e533', 'Preferrred Seating', 75, 1);
SELECT public.check('the shipped schema accepts the duplicate insert',
  (SELECT count(*) FROM public.showing_price_tiers WHERE showing_id = '00000000-0000-0000-0000-00000000e533') = 9);

-- An assigned-seating showing with duplicates whose seat map points at the
-- NEWEST row (SeatTierEditor remapped seats to what it had just inserted).
INSERT INTO public.showings (id, ticket_price) VALUES ('00000000-0000-0000-0000-00000000c0de', 20);
INSERT INTO public.venue_seats (id) VALUES ('00000000-0000-0000-0000-0000000005e1'), ('00000000-0000-0000-0000-0000000005e2');
INSERT INTO public.showing_price_tiers (id, showing_id, tier_name, price, display_order, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000c0de', 'Front', 30, 0, '2026-09-01'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000c0de', 'Front', 30, 0, '2026-09-10');
INSERT INTO public.showing_seat_tiers (showing_id, venue_seat_id, tier_id) VALUES
  ('00000000-0000-0000-0000-00000000c0de', '00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-00000000c0de', '00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-0000000000c2');
INSERT INTO public.tickets (showing_id, tier_id, price) VALUES
  ('00000000-0000-0000-0000-00000000c0de', '00000000-0000-0000-0000-0000000000c1', 30);

-- A healthy showing, to prove the repair leaves it alone.
INSERT INTO public.showings (id, ticket_price) VALUES ('00000000-0000-0000-0000-00000000f1ee', 8);
INSERT INTO public.showing_price_tiers (showing_id, tier_name, price, display_order) VALUES
  ('00000000-0000-0000-0000-00000000f1ee', 'Adult', 8, 0),
  ('00000000-0000-0000-0000-00000000f1ee', 'Student', 6, 1);

-- A showing that legitimately carries a retired "Adult" beside a live one is
-- NOT a duplicate under the new rule, and the repair must not touch it.
INSERT INTO public.showings (id, ticket_price) VALUES ('00000000-0000-0000-0000-000000000e7d', 8);
INSERT INTO public.showing_price_tiers (id, showing_id, tier_name, price, display_order, is_active, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000e7d', 'Adult', 7, 0, false, '2026-09-01'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000e7d', 'Adult', 8, 0, true,  '2026-09-10');
INSERT INTO public.tickets (showing_id, tier_id, price) VALUES
  ('00000000-0000-0000-0000-000000000e7d', '00000000-0000-0000-0000-0000000000d1', 7);
