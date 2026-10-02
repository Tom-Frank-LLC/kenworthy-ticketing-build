-- A runtime belongs to the production, not to each show. BRIEF-runtime-production-only.
--
-- Every show of a film or an event runs the same length, so a per-show
-- runtime (showings.duration_minutes, "Runs For" in the show form) was only
-- ever a second place for the same number to drift. This file moves the
-- per-show values up to their production and makes showing_ends_at() read the
-- production alone. 20261002224512 then drops the column, once code that no
-- longer reads it is deployed — the code live when this runs still selects it.
--
-- What production held when this was written (2026-10-02, read-only query):
-- 13 shows of 5 productions carried their own runtime, and in every case the
-- production had none usable and its shows agreed on one value —
--   APOD Productions: Bandstand (event)            8 shows at 150
--   Gem State Flyers: Trick or Tease (event)       1 show  at 120
--   Private Rental (event)                         2 shows at 180
--   Stardust: A Night of Magic (event)             1 show  at  75
--   Science on Screen: Wild & Wool + The Sheep
--     Detectives (film, runtime stored as 0)       1 show  at 180
-- so moving them up changes no show's end time. Staging held none.
--
-- The guard below refuses rather than guesses if that stops being true: a
-- production whose shows disagree, or whose shows disagree with a runtime it
-- already has, cannot be collapsed to one number without choosing which show
-- ends at the wrong time. Values <= 0 are ignored, as showing_ends_at() always
-- ignored them.

DO $guard$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s %s (shows: %s; production: %s)', kind, pid, vals, prod_rt), '; ')
    INTO bad
  FROM (
    SELECT
      CASE WHEN s.movie_id IS NOT NULL THEN 'movie' WHEN s.event_id IS NOT NULL THEN 'event' ELSE 'live_performance' END AS kind,
      COALESCE(s.movie_id, s.event_id, s.live_performance_id) AS pid,
      array_agg(DISTINCT s.duration_minutes) AS vals,
      COALESCE(m.duration_minutes, e.duration_minutes, l.duration_minutes) AS prod_rt
    FROM public.showings s
    LEFT JOIN public.movies m ON m.id = s.movie_id
    LEFT JOIN public.events e ON e.id = s.event_id
    LEFT JOIN public.live_performances l ON l.id = s.live_performance_id
    WHERE s.duration_minutes > 0
    GROUP BY 1, 2, 4
  ) p
  WHERE cardinality(vals) > 1
     OR (prod_rt > 0 AND vals <> ARRAY[prod_rt]);

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Per-show runtimes cannot be moved to their production without changing an end time: %', bad;
  END IF;
END
$guard$;

-- The guard has established each production's shows agree, so max() is that value.
UPDATE public.movies m SET duration_minutes = v.d
FROM (SELECT movie_id, max(duration_minutes) d FROM public.showings
      WHERE movie_id IS NOT NULL AND duration_minutes > 0 GROUP BY movie_id) v
WHERE m.id = v.movie_id AND m.duration_minutes <= 0;

UPDATE public.events e SET duration_minutes = v.d
FROM (SELECT event_id, max(duration_minutes) d FROM public.showings
      WHERE event_id IS NOT NULL AND duration_minutes > 0 GROUP BY event_id) v
WHERE e.id = v.event_id AND (e.duration_minutes IS NULL OR e.duration_minutes <= 0);

UPDATE public.live_performances l SET duration_minutes = v.d
FROM (SELECT live_performance_id, max(duration_minutes) d FROM public.showings
      WHERE live_performance_id IS NOT NULL AND duration_minutes > 0 GROUP BY live_performance_id) v
WHERE l.id = v.live_performance_id AND (l.duration_minutes IS NULL OR l.duration_minutes <= 0);

-- The end of a showing is its production's runtime, else two hours.
CREATE OR REPLACE FUNCTION public.showing_ends_at(s public.showings)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.start_time + make_interval(
    mins => COALESCE(
      NULLIF(GREATEST((SELECT m.duration_minutes FROM public.movies m WHERE m.id = s.movie_id), 0), 0),
      NULLIF(GREATEST((SELECT e.duration_minutes FROM public.events e WHERE e.id = s.event_id), 0), 0),
      NULLIF(GREATEST((SELECT l.duration_minutes FROM public.live_performances l WHERE l.id = s.live_performance_id), 0), 0),
      120
    )
  )
$function$;

COMMENT ON FUNCTION public.showing_ends_at(public.showings) IS
  'The instant a showing is over, and with it the last moment it can be sold. Duration is the production''s duration_minutes (movies, events or live_performances) -> 120; showings carry no runtime. Single source of truth for enforce_showing_not_past(); mirrored by showingEndsAt() in src/lib/purchasable.ts and supabase/functions/_shared/purchasable.ts.';
