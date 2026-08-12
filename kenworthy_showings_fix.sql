-- ============================================================
-- Kenworthy Missing Showings Fix (from MEC 'days' recurrence field)
-- Generated: 2026-08-11T19:30:22.446087
-- Adds showings that the flat start_timestamp import missed.
-- Source: mec.days field (authoritative, fully structured).
-- Idempotent — safe to re-run.
-- ============================================================

-- TIMEZONE: Moscow, Idaho is in the PACIFIC half of Idaho, not Mountain.
-- These files were generated against 'America/Boise' (Mountain), which stored
-- every showtime exactly one hour early. Corrected to America/Los_Angeles on
-- 2026-08-12; see supabase/migrations/20260812180000_showings_pacific_not_mountain.sql
-- for the backfill of the rows the Boise version already wrote.
SET timezone = 'America/Los_Angeles';

-- Teenage Sex and Death at Camp Miasma (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Teenage Sex and Death at Camp Miasma' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Hadestown: The Musical (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Hadestown: The Musical' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-27 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-27 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Cat Video Fest 2026 (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Cat Video Fest 2026' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-23 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-23 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Productions ~ Footloose: Youth Edition (3 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Productions ~ Footloose: Youth Edition' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-16 17:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-16 17:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Train Dreams ~ Roots of a Nation: An Idaho Film Festival (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Train Dreams ~ Roots of a Nation: An Idaho Film Festival' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-26 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-26 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Sacajawea of the Salmon River Valley ~ Roots of a Nation: An Idaho Film Festival (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Sacajawea of the Salmon River Valley ~ Roots of a Nation: An Idaho Film Festival' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-26 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-26 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- 1776 ~ Roots of a Nation: An Idaho Film Festival (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = '1776 ~ Roots of a Nation: An Idaho Film Festival' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-26 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-26 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Dust Bunny with Bryan Fuller (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Dust Bunny with Bryan Fuller' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-19 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-19 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Alien (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Alien' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-26 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-26 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Invite (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Invite' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Renovations (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for Renovations' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Young Washington (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Young Washington' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-19 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-19 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backrooms: Everything Must Go Edition (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Backrooms: Everything Must Go Edition' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Maddie's Secret (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Maddie''s Secret' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-19 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-19 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Disclosure Day (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Disclosure Day' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Furious (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Furious' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- I Love Boosters (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'I Love Boosters' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Jurassic Park (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Jurassic Park' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Obsession (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Obsession' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Awake, My Soul: The Story of the Sacred Harp (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Awake, My Soul: The Story of the Sacred Harp' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Voice of Hind Rajab (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Voice of Hind Rajab' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Obsession (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Obsession' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Renovations (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for Renovations' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Productions: The Sound of Music (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Productions: The Sound of Music' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-14 13:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-14 13:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-18 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-18 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Hokum (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Hokum' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-05-25 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-05-25 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Project Hail Mary (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Project Hail Mary' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-05-25 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-05-25 18:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Renovations (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for Renovations' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Senders (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'The Senders' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-12-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2025-12-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Groove for Good (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Groove for Good' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-12-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2025-12-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Neighborhood Theatre: Our Town (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Neighborhood Theatre: Our Town' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-12-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-12-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Amazing Digital Circus: The Last Act (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Amazing Digital Circus: The Last Act' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-06 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-06 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- EPiC: Elvis Presley in Concert (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'EPiC: Elvis Presley in Concert' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-04-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-04-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Theatre Showcase (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Theatre Showcase' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-04-18 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-04-18 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Community Theatre: A Midsummer Night's Dream (4 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Moscow Community Theatre: A Midsummer Night''s Dream' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-04-04 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-04-04 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-04-10 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-04-10 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-04-11 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-04-11 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-04-12 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-04-12 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Road to Rendezvous (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Road to Rendezvous' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Nirvanna the Band the Show the Movie (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Nirvanna the Band the Show the Movie' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-03-15 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-03-15 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Wuthering Heights (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Wuthering Heights' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-03-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-03-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- No Other Choice (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'No Other Choice' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-02-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-02-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-02-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-02-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Productions: Romantic Rewind (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Productions: Romantic Rewind' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 18.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 18.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Hamnet (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Hamnet' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-02-07 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-02-07 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-02-08 12:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-02-08 12:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Kill Bill: The Whole Bloody Affair (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Kill Bill: The Whole Bloody Affair' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-01-25 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-01-25 18:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Secret Agent (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Secret Agent' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-01-10 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-01-10 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-01-11 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-01-11 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Plague (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Plague' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-01-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-01-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-01-04 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-01-04 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Sentimental Value (3 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Sentimental Value' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-01-02 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-01-02 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-01-03 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-01-03 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-01-04 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-01-04 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Iron Lung (3 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Iron Lung' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-02-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-02-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-02-03 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-02-03 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-02-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-02-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- It's a Wonderful Life (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'It''s a Wonderful Life' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-12-21 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-12-21 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-12-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-12-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Neighborhood: A Sherlock Carol (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Neighborhood: A Sherlock Carol' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-12-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-12-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Christmas (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for Christmas' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Productions ~ A Christmas Carol: The Musical (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Productions ~ A Christmas Carol: The Musical' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-12-06 13:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-12-06 13:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-12-07 13:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-12-07 13:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- One Battle After Another (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'One Battle After Another' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-11-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-11-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Thanksgiving (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for Thanksgiving' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- KPop Demon Hunters A Sing-Along Event (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'KPop Demon Hunters A Sing-Along Event' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-11-01 12:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-11-01 12:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-11-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-11-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Train Dreams (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Train Dreams' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-11-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-11-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-11-23 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-11-23 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Community Theatre: Macbeth (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Moscow Community Theatre: Macbeth' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-11-08 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-11-08 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-11-09 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-11-09 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-11-14 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-11-14 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-11-15 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-11-15 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-11-16 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-11-16 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Sirius Entertainment: The Rocky Horror Picture Show (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Sirius Entertainment: The Rocky Horror Picture Show' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-10-25 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 25.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-10-25 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- New Restorations: Perfect Blue (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'New Restorations: Perfect Blue' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-10-19 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-10-19 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- IRL Movie Club: My Omaha (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'IRL Movie Club: My Omaha' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 5.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Splitsville (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Splitsville' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-09-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-09-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Silent Film Festival: "Told in the Hills" Restoration Premiere (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Silent Film Festival: "Told in the Hills" Restoration Premiere' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-09-27 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-09-27 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Weapons (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Weapons' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-09-06 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-09-06 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-09-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-09-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Ne Zha II (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Ne Zha II' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-08-31 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-08-31 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-09-01 15:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-09-01 15:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Naked Gun (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Naked Gun' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-08-31 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-08-31 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-09-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-09-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- New Restorations: Shin Godzilla (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'New Restorations: Shin Godzilla' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- It's Never Over, Jeff Buckley (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'It''s Never Over, Jeff Buckley' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-08-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-08-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Eddington (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Eddington' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-08-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-08-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-08-17 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-08-17 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- F1 The Movie (4 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'F1 The Movie' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-07-26 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-07-26 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-07-27 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-07-27 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-08-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-08-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-08-02 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-08-02 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Cat Video Fest 2025 (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Cat Video Fest 2025' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-08-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-08-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-08-10 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-08-10 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Mission: Impossible - The Final Reckoning (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Mission: Impossible - The Final Reckoning' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-07-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-07-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-07-20 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-07-20 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Materialists (4 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Materialists' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-07-12 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-07-12 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-07-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-07-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-07-19 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-07-19 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-07-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-07-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Summer Flicks: The Princess Diaries (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Summer Flicks: The Princess Diaries' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-07-06 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-07-06 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Bring Her Back (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Bring Her Back' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-06-29 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-06-29 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Jane Austen Wrecked My Life (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Jane Austen Wrecked My Life' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-06-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-06-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- 20th Anniversary: Brokeback Mountain (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = '20th Anniversary: Brokeback Mountain' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-06-25 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-06-25 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Friendship (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Friendship' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-06-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-06-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Phoenician Scheme (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Phoenician Scheme' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-06-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-06-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-06-29 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-06-29 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-07-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-07-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-07-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-07-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-07-06 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-07-06 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Productions: Fiddler on the Roof (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Productions: Fiddler on the Roof' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-06-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-06-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-06-15 13:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-06-15 13:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-06-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-06-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-06-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-06-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-06-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-06-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Sinners (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Sinners' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-05-24 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-05-24 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-05-25 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-05-25 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Shrouds (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Shrouds' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-05-10 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-05-10 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-05-11 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-05-11 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- 20th Anniversary: Pride & Prejudice (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = '20th Anniversary: Pride & Prejudice' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-05-11 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-05-11 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- When Harry Met Sally (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'When Harry Met Sally' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-04-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-04-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Warfare (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Warfare' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-05-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-05-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Farmers Market Cartoons (15 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Farmers Market Cartoons' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-05-16 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-05-16 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-05-23 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-05-23 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-06 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-06 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-13 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-13 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-20 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-20 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-06-27 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-06-27 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-04 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-04 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-11 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-11 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-18 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-18 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-07-25 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-07-25 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-01 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-01 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-08 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-08 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-15 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-15 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-22 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-22 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2026-08-29 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, true
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2026-08-29 09:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- New Restorations: Princess Mononoke 4K (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'New Restorations: Princess Mononoke 4K' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-04-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-04-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Community Theatre: Twice Upon a Time (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Moscow Community Theatre: Twice Upon a Time' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-04-05 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-04-05 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-04-06 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-04-06 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-04-11 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-04-11 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-04-12 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-04-12 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-04-13 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-04-13 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Becoming Led Zeppelin (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Becoming Led Zeppelin' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-03-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-03-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Rendezvous in the Park Showcase (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Rendezvous in the Park Showcase' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- A Complete Unknown (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'A Complete Unknown' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-02-08 15:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-02-08 15:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-02-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-02-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Last Showgirl (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Last Showgirl' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-02-02 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-02-02 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Nosferatu (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Nosferatu' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-02-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-02-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Productions: Daddy Long Legs (4 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Productions: Daddy Long Legs' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-02-27 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 14.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-02-27 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-02-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 14.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-02-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-03-01 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 14.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-03-01 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-03-02 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 14.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-03-02 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- IRL Movie Club: The Thinking Game (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'IRL Movie Club: The Thinking Game' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 5.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Blue Velvet (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Blue Velvet' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Sing Sing (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Sing Sing' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-01-26 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-01-26 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Backstage Music: The Widow Cameron + Bill Tracy (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Backstage Music: The Widow Cameron + Bill Tracy' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2024-12-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2024-12-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- BookPeople: Book Launch with Buddy Levy | Realm of Ice and Sky (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'BookPeople: Book Launch with Buddy Levy | Realm of Ice and Sky' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2024-12-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2024-12-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Palouse Road Runners: The Trail Running Film Festival (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Palouse Road Runners: The Trail Running Film Festival' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Productions: Romantic Rewind (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Productions: Romantic Rewind' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 40.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 40.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Babygirl (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Babygirl' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-01-18 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-01-18 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-01-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-01-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Queer (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Queer' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-01-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-01-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Grand Kyiv Ballet: Swan Lake (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Grand Kyiv Ballet: Swan Lake' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-02-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 40.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2025-02-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- New Restorations: Se7en (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'New Restorations: Se7en' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Silents Synced: Nosferatu + Radiohead (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Silents Synced: Nosferatu + Radiohead' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-01-10 21:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-01-10 21:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Order (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Order' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-01-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-01-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Flow (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Flow' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-01-01 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-01-01 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2025-01-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2025-01-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Cleaning (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for Cleaning' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Jon & Rand Band (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Jon & Rand Band' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2024-12-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2024-12-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- It's a Wonderful Life (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'It''s a Wonderful Life' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Christmas (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for Christmas' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Productions ~ All is Calm: The Christmas Truce of 1914 (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Productions ~ All is Calm: The Christmas Truce of 1914' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- A Real Pain (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'A Real Pain' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-08 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-08 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Anora (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Anora' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-11-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-11-30 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-12-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-12-01 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Conclave (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Conclave' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-11-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-11-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- New Restorations: The Fall (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'New Restorations: The Fall' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Saturday Night (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Saturday Night' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-11-03 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-11-03 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Community Theatre: An Act of God (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Moscow Community Theatre: An Act of God' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-11-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-11-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-11-10 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-11-10 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-11-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-11-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-11-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-11-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-11-17 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-11-17 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Sirius Entertainment: The Rocky Horror Picture Show (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Sirius Entertainment: The Rocky Horror Picture Show' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-10-26 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-10-26 20:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Substance (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Substance' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-10-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-10-05 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-10-06 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-10-06 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- New Restorations: The Conversation (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'New Restorations: The Conversation' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-09-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Dìdi (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Dìdi' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-09-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-09-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-09-15 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-09-15 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Cuckoo (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Cuckoo' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-08-31 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-08-31 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-09-01 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-09-01 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Summer Blockbuster: Ferris Bueller's Day Off (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Summer Blockbuster: Ferris Bueller''s Day Off' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-08-18 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-08-18 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Cat Video Fest 2024 (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Cat Video Fest 2024' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-08-18 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-08-18 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Janet Planet (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Janet Planet' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-08-11 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-08-11 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- New Restorations: Seven Samurai (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'New Restorations: Seven Samurai' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-08-10 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 6.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-08-10 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Summer Blockbuster: Jaws (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Summer Blockbuster: Jaws' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-08-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-08-04 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Kinds of Kindness (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Kinds of Kindness' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-07-27 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-07-27 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-07-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-07-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Summer Blockbuster: Back to the Future (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Summer Blockbuster: Back to the Future' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-07-28 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-07-28 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Thelma (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Thelma' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-07-06 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-07-06 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-07-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-07-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Renovations (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for Renovations' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Productions: Beauty and the Beast (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Productions: Beauty and the Beast' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-06-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-06-15 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-06-16 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-06-16 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-06-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-06-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-06-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-06-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-06-22 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-06-22 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- I Saw the TV Glow (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'I Saw the TV Glow' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-06-01 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-06-01 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-06-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-06-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Wicked Little Letters (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Wicked Little Letters' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-05-11 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-05-11 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-05-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-05-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Dawn of the Dead (1978) (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Dawn of the Dead (1978)' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-05-17 21:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-05-17 21:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-05-18 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-05-18 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Hundreds of Beavers (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Hundreds of Beavers' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-05-26 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-05-26 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Civil War (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Civil War' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-05-04 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-05-04 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-05-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-05-05 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Late Night with the Devil (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Late Night with the Devil' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-04-13 22:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-04-13 22:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-04-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-04-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Dune: Part Two (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Dune: Part Two' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-04-20 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-04-20 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-04-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-04-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MCT: Sally Cotter and the Quest We Follow (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MCT: Sally Cotter and the Quest We Follow' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-04-06 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-04-06 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-04-07 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-04-07 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-04-12 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-04-12 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-04-13 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-04-13 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-04-14 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-04-14 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- CCUCCC and The United Church of Moscow: God & Country (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'CCUCCC and The United Church of Moscow: God & Country' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Rendezvous in the Park Showcase (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Rendezvous in the Park Showcase' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Community Screening: Chariots of Fire (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Community Screening: Chariots of Fire' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Oscars Recap: Barbie (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Oscars Recap: Barbie' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Oscars Recap: Killers of the Flower Moon (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Oscars Recap: Killers of the Flower Moon' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Oscars Recap: The Holdovers (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Oscars Recap: The Holdovers' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Oscars Recap: The Zone of Interest (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Oscars Recap: The Zone of Interest' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-24 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Oscars Recap: Oppenheimer (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Oscars Recap: Oppenheimer' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-23 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Absolute Anime: The End of Evangelion (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Absolute Anime: The End of Evangelion' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-20 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-20 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Productions: You Can't Take it With You! (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Productions: You Can''t Take it With You!' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-10 14:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-10 14:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-03-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-03-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Oscar Shorts: Documentary (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Oscar Shorts: Documentary' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-02-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-02-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Oscar Shorts: Live Action (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Oscar Shorts: Live Action' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-02-18 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-02-18 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Oscar Shorts: Animation (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Oscar Shorts: Animation' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-02-17 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-02-17 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-02-18 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-02-18 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Heritage Arts Academy: The Pirates of Penzance (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Heritage Arts Academy: The Pirates of Penzance' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-02-08 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-02-08 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Poor Things (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Poor Things' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-01-20 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-01-20 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-01-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-01-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-01-26 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-01-26 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-01-27 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-01-27 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-01-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-01-28 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Family Flicks: The Super Mario Bros. Movie (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Family Flicks: The Super Mario Bros. Movie' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2024-01-29 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2024-01-29 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for New Year's Day (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for New Year''s Day' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Boy and the Heron (11 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Boy and the Heron' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-12-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-12-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-12-10 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-12-10 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-12-12 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-12-12 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-12-13 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-12-13 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-12-14 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-12-14 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-12-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-12-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-12-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-12-16 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-12-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-12-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-12-19 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-12-19 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-12-20 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-12-20 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-12-21 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-12-21 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Killers of the Flower Moon (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Killers of the Flower Moon' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-11-19 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-11-19 12:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Christmas (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for Christmas' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- STAGE Student Theatre: One Act Plays (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'STAGE Student Theatre: One Act Plays' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-12-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-12-02 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Priscilla (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Priscilla' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-11-10 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-11-10 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-11-11 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-11-11 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Killers of the Flower Moon (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Killers of the Flower Moon' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-11-10 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-11-10 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-11-11 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-11-11 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Thanksgiving (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for Thanksgiving' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Family Flicks: Ratatouille (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Family Flicks: Ratatouille' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-11-03 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-11-03 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-11-04 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 8.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-11-04 13:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MCT: Rosencrantz and Guildenstern Are Dead (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MCT: Rosencrantz and Guildenstern Are Dead' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-11-04 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-11-04 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-11-05 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-11-05 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-11-10 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-11-10 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-11-11 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-11-11 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-11-12 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-11-12 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Sirius Entertainment: The Rocky Horror Picture Show (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Sirius Entertainment: The Rocky Horror Picture Show' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-10-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-10-21 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Youth Productions: High School Musical (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Youth Productions: High School Musical' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-08-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-08-17 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Asteroid City (7 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Asteroid City' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-07-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-07-07 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-07-08 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-07-08 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-07-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-07-09 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-07-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-07-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-07-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-07-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-07-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-07-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-07-16 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-07-16 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- APOD Productions: Lionel Bart's Oliver! (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'APOD Productions: Lionel Bart''s Oliver!' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-06-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-06-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Community Theatre: Sally Cotter and the Prisoner of Ala Katraz (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Moscow Community Theatre: Sally Cotter and the Prisoner of Ala Katraz' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-04-21 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-04-21 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Women Talking (4 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Women Talking' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Whale and Virtual Q&A with Sam Hunter (4 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Whale and Virtual Q&A with Sam Hunter' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Black History Month Screening: clusterluck (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Black History Month Screening: clusterluck' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Black History Month Screening: This Is My Black (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Black History Month Screening: This Is My Black' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Whale (4 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Whale' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-14 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-19 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 7.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-20 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- UI Outdoor Program: Backcountry Film Festival (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'UI Outdoor Program: Backcountry Film Festival' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Holiday Break (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for Holiday Break' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Realty: The Polar Express (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Moscow Realty: The Polar Express' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Election Day (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Election Day' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Closed for Thanksgiving (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Closed for Thanksgiving' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-11-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Community Theatre: Dracula - A Comic Thriller (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Moscow Community Theatre: Dracula - A Comic Thriller' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-05 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-11-05 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-11 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-11-11 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Community Theatre: Dracula - A Comic Thriller (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Moscow Community Theatre: Dracula - A Comic Thriller' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-05 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-11-05 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-11 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 15.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-11-11 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Comedy Fest (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'Moscow Comedy Fest' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-09-10 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-09-10 15:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- NT Live: Jack Absolute Flies Again (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'NT Live: Jack Absolute Flies Again' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-06-03 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-06-03 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-06-05 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-06-05 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- NT Live: Frankenstein (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'NT Live: Frankenstein' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-06-03 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-06-03 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-06-05 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-06-05 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- NT Live: Henry V (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'NT Live: Henry V' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-06-03 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-06-03 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-06-05 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-06-05 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- NT Live: Prima Facie (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'NT Live: Prima Facie' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-06-03 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-06-03 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-06-05 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 12.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-06-05 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Don Giovanni (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Don Giovanni' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-05-20 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-05-20 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-05-22 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-05-22 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Champion (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Champion' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-04-29 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-04-29 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-05-01 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-05-01 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Der Rosenkavalier (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Der Rosenkavalier' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-04-15 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-04-15 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-04-17 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-04-17 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Falstaff (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Falstaff' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-04-01 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-04-01 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-04-03 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-04-03 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Lohengrin (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Lohengrin' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-03-18 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-03-18 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-03-20 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-03-20 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Fedora (Canceled) (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Fedora (Canceled)' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-14 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-14 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2023-01-16 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2023-01-16 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: The Hours (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: The Hours' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-12-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-12-10 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-12-12 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-12-12 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: La Traviata (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: La Traviata' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-05 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-11-05 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-11-07 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-11-07 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Hit the Road (Unrated) (6 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Hit the Road (Unrated)' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-07 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-07 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-08 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-08 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-14 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-14 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-15 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-15 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- The Northman (R) (6 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'The Northman (R)' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-07 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-07 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-08 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-08 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-14 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-14 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-15 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-15 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Everything Everywhere All at Once (R) (6 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Everything Everywhere All at Once (R)' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-07 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-07 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-08 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-08 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-14 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-14 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-15 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-15 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Everything Everywhere All at Once (R) (6 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Everything Everywhere All at Once (R)' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-07 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-07 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-08 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-08 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-14 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-14 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-15 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-15 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Everything Everywhere All at Once (R) (6 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Everything Everywhere All at Once (R)' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-07 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-07 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-08 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-08 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-12 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-14 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-14 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-15 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-15 16:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MCT Presents: Sally Cotter and the Censored Stone (5 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'MCT Presents: Sally Cotter and the Censored Stone' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-04-02 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-04-02 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-04-03 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-04-03 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-04-08 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-04-08 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-04-09 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-04-09 19:30:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-04-10 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2022-04-10 14:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Moscow Film Society (6 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'Moscow Film Society' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-04-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-04-13 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-04-27 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-04-27 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-11 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-11 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-25 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-25 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-06-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-06-15 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-06-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-06-22 19:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Hamlet (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Hamlet' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-06-04 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-06-04 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-06-06 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-06-06 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Don Carlos (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Don Carlos' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-03-26 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-03-26 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-04-04 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-04-04 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Lucia Di Lammermoor (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Lucia Di Lammermoor' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-21 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-21 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-23 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-23 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Turandot (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Turandot' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-07 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-07 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-05-09 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-05-09 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Ariadne Auf Naxos (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Ariadne Auf Naxos' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-03-12 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-03-12 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-03-14 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-03-14 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Rigoletto (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Rigoletto' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-01-29 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-01-29 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-01-31 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-01-31 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Cinderella (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Cinderella' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-01-01 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-01-01 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-01-03 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-01-03 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Eurydice (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Eurydice' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2021-12-04 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2021-12-04 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2021-12-06 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2021-12-06 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Fire Shut Up In My Bones (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Fire Shut Up In My Bones' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2021-10-23 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2021-10-23 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2021-10-25 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2021-10-25 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- MET Live in HD: Medea (2 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.movies WHERE title = 'MET Live in HD: Medea' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-10-22 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-10-22 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
    INSERT INTO public.showings (movie_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2022-10-24 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 20.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE movie_id = v_id AND start_time = '2022-10-24 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- In the Heights (1 showing(s) from days field)
DO $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM public.events WHERE title = 'In the Heights' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO public.showings (event_id, start_time, ticket_price, total_seats, is_active)
    SELECT v_id, '2021-08-05 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles', 10.0, 200, false
    WHERE NOT EXISTS (SELECT 1 FROM public.showings WHERE event_id = v_id AND start_time = '2021-08-05 08:00:00'::timestamp AT TIME ZONE 'America/Los_Angeles');
  END IF;
END $$;

-- Summary: 187 films, 26 events, 426 candidate showings
