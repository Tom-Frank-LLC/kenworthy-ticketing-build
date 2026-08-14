-- Point the existing showings at the room they were always in, and stop
-- claiming it holds 200 people.
--
-- ---------------------------------------------------------------------------
-- Why every showing has a null venue
-- ---------------------------------------------------------------------------
-- Until 20260814000000 there was no venue row to point at, so nothing ever set
-- showings.venue_id. The Kenworthy has one room. Every showing in the table
-- happened in it, so a null here is missing data rather than a meaningful
-- "no venue" — and it is why the admin list shows no venue badge on any of
-- roughly 1,789 showings.
--
-- ---------------------------------------------------------------------------
-- Why capacity is wrong, and the rule used to fix it
-- ---------------------------------------------------------------------------
-- showings.total_seats has DEFAULT 200 (20260217193113). The auditorium seats
-- 265. Nothing in the admin ever exposed the field, so every showing carries
-- the default — a number that has never been true of this building. For a GA
-- showing that number is the sold-out ceiling: enforce_showing_capacity()
-- refuses the 201st ticket, and showing_availability() reports the remainder
-- the customer page prints as "N available". So the house has been selling 200
-- seats out of 265 and calling itself full 65 seats early.
--
-- The update is deliberately scoped to rows still holding exactly 200. A row
-- set to anything else was set by somebody — a limited-capacity rental, a
-- restricted event — and this migration has no business overriding that
-- judgement. 200 is indistinguishable from "never chosen", and given that it
-- is the schema default and was never editable in the UI, treating it as unset
-- is the honest reading.
--
-- Raising a ceiling cannot invalidate a sale that already happened: every
-- existing ticket stays valid, and no showing becomes retroactively oversold.
-- Lowering one could, which is the other reason this only ever moves 200 up to
-- 265 and never touches a larger value.
--
-- Past showings are included. 200 was not true of them either; the archive is
-- more accurate with the real room size than with a default nobody chose, and
-- the dashboard's sold/capacity badge reads correctly for them afterwards.

DO $$
DECLARE
  v_venue_id  uuid;
  v_seats     integer;
  v_venues    integer;
  v_venue_backfilled integer;
  v_seats_fixed      integer;
BEGIN
  SELECT count(*) INTO v_venues FROM public.venues;

  SELECT id, total_seats INTO v_venue_id, v_seats
  FROM public.venues
  WHERE name = 'Main Theater'
  ORDER BY created_at
  LIMIT 1;

  -- Nothing to attach to. Better to stop loudly than to leave the operator
  -- believing 1,789 rows were backfilled when the venue seed never ran.
  IF v_venue_id IS NULL THEN
    RAISE EXCEPTION
      'No venue named "Main Theater" — run 20260814000000_seed_main_theater_venue.sql first.';
  END IF;

  -- One room is the assumption behind "every null venue_id means this venue".
  -- If a second venue has appeared since, that assumption no longer holds and
  -- guessing would silently file showings in the wrong room.
  IF v_venues > 1 THEN
    RAISE EXCEPTION
      'Expected a single venue, found % — the blanket venue_id backfill below assumes there is only one room to assign. Resolve by hand.',
      v_venues;
  END IF;

  UPDATE public.showings
  SET venue_id = v_venue_id
  WHERE venue_id IS NULL;
  GET DIAGNOSTICS v_venue_backfilled = ROW_COUNT;

  UPDATE public.showings
  SET total_seats = v_seats
  WHERE total_seats = 200
    AND total_seats <> v_seats;
  GET DIAGNOSTICS v_seats_fixed = ROW_COUNT;

  RAISE NOTICE 'Backfilled venue_id on % showings; corrected capacity 200 -> % on % showings.',
    v_venue_backfilled, v_seats, v_seats_fixed;
END $$;
