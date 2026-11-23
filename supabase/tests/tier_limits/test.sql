-- Per-tier ticket limits, after 20261123060222. Every block raises on failure,
-- so a run that reaches the end passed.
\set ON_ERROR_STOP 1

-- Expect `sql` to be refused with PT409 and a message matching `pattern`.
CREATE FUNCTION pg_temp.refused(sql text, pattern text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    IF SQLERRM !~ pattern THEN
      RAISE EXCEPTION 'refused, but with "%" (wanted /%/)', SQLERRM, pattern;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'expected PT409 for: %', sql;
END $$;

CREATE FUNCTION pg_temp.held(p_tier uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.tickets WHERE tier_id = p_tier $$;

-- §0 Production shapes, no limit anywhere: unchanged ---------------------------
DO $$
DECLARE pref uuid := '00000000-0000-0000-0000-0000000b0001';
BEGIN
  -- the column exists and every existing tier is unlimited
  IF EXISTS (SELECT 1 FROM public.showing_price_tiers WHERE max_tickets IS NOT NULL) THEN
    RAISE EXCEPTION '§0 existing tiers gained a limit';
  END IF;
  -- untiered GA: 3 sell, the 4th is the showing's refusal, as before
  INSERT INTO public.tickets (showing_id) SELECT '00000000-0000-0000-0000-00000000a001' FROM generate_series(1, 3);
  PERFORM pg_temp.refused($q$INSERT INTO public.tickets (showing_id) VALUES ('00000000-0000-0000-0000-00000000a001')$q$,
                          '^Sold out: all 3 seats');
  -- tiered GA, unlimited: Preferred can still take the whole house, as before
  INSERT INTO public.tickets (showing_id, tier_id) SELECT '00000000-0000-0000-0000-00000000b001', pref FROM generate_series(1, 4);
  PERFORM pg_temp.refused(format($q$INSERT INTO public.tickets (showing_id, tier_id) VALUES ('00000000-0000-0000-0000-00000000b001', %L)$q$, pref),
                          '^Sold out: all 4 seats');
  -- old availability columns are byte-identical to the baseline on the baseline's data
  DELETE FROM public.tickets;
  IF EXISTS (
    SELECT s.id, a.total_seats, a.requires_seat_selection, a.held, a.available, a.taken_seat_ids
      FROM public.showings s, LATERAL public.showing_availability(s.id) a
    EXCEPT SELECT * FROM public._baseline_availability
  ) THEN RAISE EXCEPTION '§0 showing_availability''s existing columns changed'; END IF;
  RAISE NOTICE '§0 ok: production shapes unchanged with no limits set';
END $$;

-- §1 A limit holds; the other tier and the showing carry on -------------------
DO $$
DECLARE pref uuid := '00000000-0000-0000-0000-0000000b0001';
        gen  uuid := '00000000-0000-0000-0000-0000000b0002';
        sh   uuid := '00000000-0000-0000-0000-00000000b001';
BEGIN
  UPDATE public.showing_price_tiers SET max_tickets = 2 WHERE id = pref;
  INSERT INTO public.tickets (showing_id, tier_id) VALUES (sh, pref), (sh, pref);
  PERFORM pg_temp.refused(format($q$INSERT INTO public.tickets (showing_id, tier_id) VALUES (%L, %L)$q$, sh, pref),
                          '^Preferred Seating is sold out for this showing\.$');
  -- General Admission still sells the remaining 2 seats, then the house is full
  INSERT INTO public.tickets (showing_id, tier_id) VALUES (sh, gen), (sh, gen);
  PERFORM pg_temp.refused(format($q$INSERT INTO public.tickets (showing_id, tier_id) VALUES (%L, %L)$q$, sh, gen),
                          '^Sold out: all 4 seats');
  -- with both exhausted, a Preferred buyer hears about Preferred
  PERFORM pg_temp.refused(format($q$INSERT INTO public.tickets (showing_id, tier_id) VALUES (%L, %L)$q$, sh, pref),
                          '^Preferred Seating is sold out');
  DELETE FROM public.tickets;
  RAISE NOTICE '§1 ok: tier limit refuses, other tier and showing capacity unaffected';
END $$;

-- §2 One order that does not fit is refused whole -----------------------------
DO $$
DECLARE pref uuid := '00000000-0000-0000-0000-0000000b0001';
        sh   uuid := '00000000-0000-0000-0000-00000000b001';
BEGIN
  INSERT INTO public.tickets (showing_id, tier_id) VALUES (sh, pref);
  PERFORM pg_temp.refused(format($q$INSERT INTO public.tickets (showing_id, tier_id) VALUES (%L, %L), (%L, %L)$q$, sh, pref, sh, pref),
                          'Preferred Seating is sold out');
  IF pg_temp.held(pref) <> 1 THEN RAISE EXCEPTION '§2 partial order landed: % rows', pg_temp.held(pref); END IF;
  DELETE FROM public.tickets;
  RAISE NOTICE '§2 ok: a 2-ticket order into 1 remaining is refused entirely';
END $$;

-- §3 What counts as held -------------------------------------------------------
DO $$
DECLARE pref uuid := '00000000-0000-0000-0000-0000000b0001';
        sh   uuid := '00000000-0000-0000-0000-00000000b001';
BEGIN
  -- an expired hold and a cancelled ticket occupy nothing
  INSERT INTO public.tickets (showing_id, tier_id, status, purchased_at) VALUES
    (sh, pref, 'pending', now() - public.ticket_hold_window() - interval '1 minute'),
    (sh, pref, 'cancelled', now());
  INSERT INTO public.tickets (showing_id, tier_id) VALUES (sh, pref);
  -- a live hold does
  INSERT INTO public.tickets (showing_id, tier_id, status) VALUES (sh, pref, 'pending');
  PERFORM pg_temp.refused(format($q$INSERT INTO public.tickets (showing_id, tier_id) VALUES (%L, %L)$q$, sh, pref),
                          'Preferred Seating is sold out');
  -- a cancelled insert is never refused
  INSERT INTO public.tickets (showing_id, tier_id, status) VALUES (sh, pref, 'cancelled');
  DELETE FROM public.tickets;
  RAISE NOTICE '§3 ok: confirmed + live pending count; expired and cancelled do not';
END $$;

-- §4 Zero closes the tier; null lifts the limit -------------------------------
DO $$
DECLARE pref uuid := '00000000-0000-0000-0000-0000000b0001';
        sh   uuid := '00000000-0000-0000-0000-00000000b001';
BEGIN
  UPDATE public.showing_price_tiers SET max_tickets = 0 WHERE id = pref;
  PERFORM pg_temp.refused(format($q$INSERT INTO public.tickets (showing_id, tier_id) VALUES (%L, %L)$q$, sh, pref),
                          'Preferred Seating is sold out');
  UPDATE public.showing_price_tiers SET max_tickets = NULL WHERE id = pref;
  INSERT INTO public.tickets (showing_id, tier_id) SELECT sh, pref FROM generate_series(1, 4);
  DELETE FROM public.tickets;
  BEGIN
    UPDATE public.showing_price_tiers SET max_tickets = -1 WHERE id = pref;
    RAISE EXCEPTION '§4 a negative limit was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE '§4 ok: 0 closes the tier, NULL is unlimited, negative refused';
END $$;

-- §5 Seated tickets are not the limit's business ------------------------------
DO $$
DECLARE orch uuid := '00000000-0000-0000-0000-0000000c0001';
        sh   uuid := '00000000-0000-0000-0000-00000000c001';
BEGIN
  UPDATE public.showing_price_tiers SET max_tickets = 1 WHERE id = orch;
  INSERT INTO public.tickets (showing_id, tier_id, seat_id) VALUES
    (sh, orch, '00000000-0000-0000-0000-000000000501'),
    (sh, orch, '00000000-0000-0000-0000-000000000502'),
    (sh, orch, '00000000-0000-0000-0000-000000000503');
  UPDATE public.showing_price_tiers SET max_tickets = NULL WHERE id = orch;
  DELETE FROM public.tickets;
  RAISE NOTICE '§5 ok: a seated tier is bounded by its seats, not by max_tickets';
END $$;

-- §6 A showing with no capacity recorded still honours its tier limit ---------
DO $$
DECLARE pref uuid := '00000000-0000-0000-0000-0000000b0001';
        sh   uuid := '00000000-0000-0000-0000-00000000b001';
BEGIN
  UPDATE public.showings SET total_seats = NULL WHERE id = sh;
  UPDATE public.showing_price_tiers SET max_tickets = 1 WHERE id = pref;
  INSERT INTO public.tickets (showing_id, tier_id) VALUES (sh, pref);
  PERFORM pg_temp.refused(format($q$INSERT INTO public.tickets (showing_id, tier_id) VALUES (%L, %L)$q$, sh, pref),
                          'Preferred Seating is sold out');
  UPDATE public.showings SET total_seats = 4 WHERE id = sh;
  DELETE FROM public.tickets;
  RAISE NOTICE '§6 ok: tier limit applies when total_seats is NULL';
END $$;

-- §7 showing_availability reports each tier ------------------------------------
DO $$
DECLARE pref uuid := '00000000-0000-0000-0000-0000000b0001';
        gen  uuid := '00000000-0000-0000-0000-0000000b0002';
        sh   uuid := '00000000-0000-0000-0000-00000000b001';
        a record;
        p jsonb; g jsonb;
BEGIN
  UPDATE public.showing_price_tiers SET max_tickets = 3 WHERE id = pref;
  INSERT INTO public.tickets (showing_id, tier_id) VALUES (sh, pref), (sh, gen);
  SELECT * INTO a FROM public.showing_availability(sh);
  IF a.held <> 2 OR a.available <> 2 THEN RAISE EXCEPTION '§7 showing totals wrong: held % available %', a.held, a.available; END IF;
  IF jsonb_array_length(a.tiers) <> 2 THEN RAISE EXCEPTION '§7 expected 2 tiers, got %', a.tiers; END IF;
  p := a.tiers -> 0; g := a.tiers -> 1;
  IF p ->> 'tier_id' <> pref::text OR (p ->> 'max_tickets')::int <> 3 OR (p ->> 'held')::int <> 1 OR (p ->> 'available')::int <> 2 THEN
    RAISE EXCEPTION '§7 Preferred wrong: %', p; END IF;
  IF g ->> 'tier_id' <> gen::text OR jsonb_typeof(g -> 'max_tickets') <> 'null' OR (g ->> 'held')::int <> 1
     OR jsonb_typeof(g -> 'available') <> 'null' THEN
    RAISE EXCEPTION '§7 General wrong: %', g; END IF;
  -- a limit lowered below what has sold reads as 0 left, never negative
  UPDATE public.showing_price_tiers SET max_tickets = 0 WHERE id = pref;
  SELECT * INTO a FROM public.showing_availability(sh);
  IF (a.tiers -> 0 ->> 'available')::int <> 0 THEN RAISE EXCEPTION '§7 not floored: %', a.tiers; END IF;
  -- a retired tier is not listed; a showing with no tiers gives []
  UPDATE public.showing_price_tiers SET is_active = false WHERE id = gen;
  IF jsonb_array_length((SELECT tiers FROM public.showing_availability(sh))) <> 1 THEN RAISE EXCEPTION '§7 retired tier listed'; END IF;
  UPDATE public.showing_price_tiers SET is_active = true, max_tickets = NULL WHERE id IN (gen, pref);
  IF (SELECT tiers FROM public.showing_availability('00000000-0000-0000-0000-00000000a001')) <> '[]'::jsonb THEN
    RAISE EXCEPTION '§7 untiered showing should give []'; END IF;
  DELETE FROM public.tickets;
  RAISE NOTICE '§7 ok: availability lists each live tier, limit and remainder';
END $$;

-- §8 Grants: anon may read availability, may not write tiers -------------------
DO $$ BEGIN
  IF NOT has_function_privilege('anon', 'public.showing_availability(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '§8 anon lost showing_availability'; END IF;
  IF has_function_privilege('anon', 'public.set_showing_price_tiers(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '§8 anon can write tiers'; END IF;
  RAISE NOTICE '§8 ok: grants as before';
END $$;

-- §9 set_showing_price_tiers writes, keeps and clears the limit ---------------
SELECT set_config('test.role', 'admin', false);
DO $$
DECLARE sh uuid := '00000000-0000-0000-0000-00000000b001';
        lim integer;
BEGIN
  -- set
  PERFORM public.set_showing_price_tiers(sh, '[{"tier_name":"Preferred Seating","price":40,"max_tickets":60},{"tier_name":"General Admission","price":25}]');
  SELECT max_tickets INTO lim FROM public.showing_price_tiers WHERE showing_id = sh AND tier_name = 'Preferred Seating' AND is_active;
  IF lim IS DISTINCT FROM 60 THEN RAISE EXCEPTION '§9 set: %', lim; END IF;
  IF (SELECT max_tickets FROM public.showing_price_tiers WHERE showing_id = sh AND tier_name = 'General Admission') IS NOT NULL THEN
    RAISE EXCEPTION '§9 absent key on a tier with no limit gave it one'; END IF;
  -- absent key keeps (the seat editor's save, which knows nothing of limits)
  PERFORM public.set_showing_price_tiers(sh, '[{"tier_name":"Preferred Seating","price":45,"color":"#123456"},{"tier_name":"General Admission","price":25}]');
  SELECT max_tickets INTO lim FROM public.showing_price_tiers WHERE showing_id = sh AND tier_name = 'Preferred Seating' AND is_active;
  IF lim IS DISTINCT FROM 60 THEN RAISE EXCEPTION '§9 absent key did not keep: %', lim; END IF;
  -- explicit null clears
  PERFORM public.set_showing_price_tiers(sh, '[{"tier_name":"Preferred Seating","price":45,"max_tickets":null},{"tier_name":"General Admission","price":25}]');
  SELECT max_tickets INTO lim FROM public.showing_price_tiers WHERE showing_id = sh AND tier_name = 'Preferred Seating' AND is_active;
  IF lim IS NOT NULL THEN RAISE EXCEPTION '§9 null did not clear: %', lim; END IF;
  -- zero is allowed: it is "close this tier"
  PERFORM public.set_showing_price_tiers(sh, '[{"tier_name":"Preferred Seating","price":45,"max_tickets":0},{"tier_name":"General Admission","price":25}]');
  SELECT max_tickets INTO lim FROM public.showing_price_tiers WHERE showing_id = sh AND tier_name = 'Preferred Seating' AND is_active;
  IF lim IS DISTINCT FROM 0 THEN RAISE EXCEPTION '§9 zero: %', lim; END IF;
  -- the row kept its id throughout, so tickets and seat maps survive
  IF (SELECT id FROM public.showing_price_tiers WHERE showing_id = sh AND tier_name = 'Preferred Seating' AND is_active)
     <> '00000000-0000-0000-0000-0000000b0001' THEN RAISE EXCEPTION '§9 tier id changed'; END IF;
  RAISE NOTICE '§9 ok: writer sets, keeps on absent key, clears on null, accepts 0';
END $$;

-- §10 set_showing_price_tiers refuses a bad limit ------------------------------
DO $$
DECLARE sh uuid := '00000000-0000-0000-0000-00000000b001';
        bad text;
BEGIN
  FOREACH bad IN ARRAY ARRAY['-1', '2.5', '"60"', 'true', '1000001'] LOOP
    BEGIN
      PERFORM public.set_showing_price_tiers(sh, format('[{"tier_name":"Preferred Seating","price":40,"max_tickets":%s}]', bad)::jsonb);
      RAISE EXCEPTION '§10 accepted max_tickets %', bad;
    EXCEPTION WHEN SQLSTATE 'PT400' THEN
      IF SQLERRM !~ 'whole number' THEN RAISE EXCEPTION '§10 wrong message for %: %', bad, SQLERRM; END IF;
    END;
  END LOOP;
  -- the refused saves changed nothing
  IF (SELECT max_tickets FROM public.showing_price_tiers WHERE showing_id = sh AND tier_name = 'Preferred Seating' AND is_active) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '§10 a refused save wrote'; END IF;
  RAISE NOTICE '§10 ok: negative, fractional, string, boolean and absurd limits refused';
END $$;
SELECT set_config('test.role', '', false);

-- Leave the race a clean tier with one seat left.
UPDATE public.showing_price_tiers SET max_tickets = 1 WHERE id = '00000000-0000-0000-0000-0000000b0001';
