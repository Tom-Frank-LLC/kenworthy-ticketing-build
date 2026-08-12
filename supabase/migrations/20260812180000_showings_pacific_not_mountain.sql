-- Correct showtimes that were imported as Mountain time but meant Pacific.
--
-- WHAT WENT WRONG
--
-- The Kenworthy is in Moscow, Idaho. Idaho is split across two time zones, and
-- Moscow sits in the northern, *Pacific* half. The three import scripts
-- (kenworthy_import_full.sql, kenworthy_fix.sql, kenworthy_showings_fix.sql)
-- reached for the Idaho-sounding zone instead:
--
--     SET timezone = 'America/Boise';                            -- Mountain
--     ... '2026-08-23 19:00:00'::timestamp AT TIME ZONE 'America/Boise'
--
-- Mountain leads Pacific by exactly one hour, and both observe identical US
-- DST rules, so this is not a twice-a-year edge case -- it is a flat one-hour
-- error on every imported row, which is why every listing read an hour early.
-- A 7:00 PM show was stored as 01:00Z (7 PM Mountain) instead of 02:00Z.
--
-- SCOPE: ALL 1,789 IMPORTED ROWS
--
-- Note for anyone verifying this by hand: querying `showings` with the anon
-- key shows only ~34 rows, because RLS exposes just the active upcoming ones.
-- The table actually holds 1,789 showings back to 2021-06-17, and every one of
-- them came from the Boise imports (three batches, all on 2026-08-10/11).
-- All of them are an hour early, including the historical rows that box office
-- receipts and reporting read.
--
-- CONFIRMATION
--
-- Verified against the venue's own published calendar at kenworthy.org, which
-- is independent of this database. Every upcoming show matches the corrected
-- value and none match the stored one:
--
--     Camp Miasma      Aug 23  published 7:00 PM   stored 6:00 PM
--     Hadestown        Aug 23  published 12:30 PM  stored 11:30 AM
--     Cat Video Fest   Aug 23  published 4:00 PM   stored 3:00 PM
--     Farmers Market   Aug 15  published 9:00 AM   stored 8:00 AM
--     Footloose        Aug 16  published 5:00 PM   stored 4:00 PM
--
-- THE FIX
--
-- Read each instant's wall clock in Mountain -- the time actually advertised --
-- and re-localize that same wall clock as Pacific:
--
--     (start_time AT TIME ZONE 'America/Boise')      -- timestamptz -> naive wall clock
--       AT TIME ZONE 'America/Los_Angeles'           -- naive -> the instant it should have been
--
-- Deliberately not written as `start_time + interval '1 hour'`. The correction
-- is "this wall clock belongs to a different zone"; letting Postgres derive the
-- offset keeps it correct if the two zones' rules ever diverge.
--
-- Note the direction. The mirror image --
--   (start_time AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Denver'
-- -- shifts an hour the wrong way and doubles the error.
--
-- GUARDS
--
-- An earlier draft asserted that every corrected showing lands on a plausible
-- programming slot. That was calibrated on the 34 RLS-visible rows and is wrong
-- for the real table: the historical archive legitimately contains 8:55 AM
-- school screenings, a 5:45 PM, and a midnight show. The invariant checked here
-- is structural instead -- every row moves by exactly one hour, none skipped --
-- plus an anchor on a showtime confirmed against kenworthy.org.

BEGIN;

DO $$
DECLARE
  v_cutoff  CONSTANT timestamptz := '2026-08-12 00:00:00+00';
  -- Camp Miasma, Sunday August 23 2026, published by the venue as 7:00 PM.
  v_anchor  CONSTANT timestamptz := '2026-08-24 01:00:00+00';  -- 6 PM Pacific, wrong
  v_fixed   CONSTANT timestamptz := '2026-08-24 02:00:00+00';  -- 7 PM Pacific, right
  v_rows    int;
  v_bad     int;
BEGIN
  -- Refuse to run against data that is not in the state this migration
  -- describes. If the anchor already reads 7 PM the correction has been
  -- applied and a second pass would push every showing an hour late.
  IF NOT EXISTS (SELECT 1 FROM public.showings WHERE start_time = v_anchor) THEN
    IF EXISTS (SELECT 1 FROM public.showings WHERE start_time = v_fixed) THEN
      RAISE EXCEPTION
        'Showtimes appear already corrected (anchor is at %). Refusing to shift again.', v_fixed;
    END IF;
    RAISE EXCEPTION
      'Anchor showing not found at %. Data does not match this migration; aborting.', v_anchor;
  END IF;

  CREATE TEMP TABLE _showings_pre ON COMMIT DROP AS
    SELECT id, start_time FROM public.showings WHERE created_at < v_cutoff;

  SELECT count(*) INTO v_rows FROM _showings_pre;
  RAISE NOTICE 'Shifting % imported showing(s) from Mountain to Pacific.', v_rows;

  UPDATE public.showings
  SET start_time = (start_time AT TIME ZONE 'America/Boise')
                     AT TIME ZONE 'America/Los_Angeles'
  WHERE created_at < v_cutoff;

  -- Every row moved, and every row moved by exactly one hour.
  SELECT count(*) INTO v_bad
  FROM public.showings s
  JOIN _showings_pre p ON p.id = s.id
  WHERE s.start_time <> p.start_time + interval '1 hour';

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      '% row(s) did not shift by exactly one hour -- rolling back.', v_bad;
  END IF;

  -- And the externally-verified showtime now reads as the venue publishes it.
  IF NOT EXISTS (SELECT 1 FROM public.showings WHERE start_time = v_fixed) THEN
    RAISE EXCEPTION 'Anchor showing did not land at % -- rolling back.', v_fixed;
  END IF;
END $$;

COMMIT;
