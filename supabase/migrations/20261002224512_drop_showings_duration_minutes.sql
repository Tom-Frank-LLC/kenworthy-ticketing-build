-- Showings no longer carry a runtime. BRIEF-runtime-production-only.
--
-- 20261002222321 moved every per-show value up to its production and made
-- showing_ends_at() read the production alone. Nothing reads this column now:
-- not the database (the only function that did was showing_ends_at; no view
-- depends on it), not the site, the Worker or the edge functions. Applied only
-- after that code was deployed, because the code before it selected the
-- column by name and PostgREST fails a select naming a column that is gone.
--
-- Refuses if a show has been given a runtime that its production does not
-- carry since 20261002222321 ran — an old admin tab still open could do that —
-- rather than silently changing when that show ends.

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.showings s
    LEFT JOIN public.movies m ON m.id = s.movie_id
    LEFT JOIN public.events e ON e.id = s.event_id
    LEFT JOIN public.live_performances l ON l.id = s.live_performance_id
    WHERE s.duration_minutes > 0
      AND s.duration_minutes IS DISTINCT FROM COALESCE(m.duration_minutes, e.duration_minutes, l.duration_minutes)
  ) THEN
    RAISE EXCEPTION 'A show carries a runtime its production does not; move it to the production before dropping showings.duration_minutes';
  END IF;
END
$guard$;

ALTER TABLE public.showings DROP COLUMN duration_minutes;
