-- A production's runtime: set once on the title, shown or hidden on the public
-- page. BRIEF-production-runtime.
--
-- Two changes, both about the same number.
--
-- 1. show_runtime (movies, events, live_performances). Display only.
--    duration_minutes still decides when a showing ends — isPast, the "has
--    this passed" refusal in price_ticket_order (via showing_ends_at below),
--    the showtime filters and the JSON-LD endDate — whatever this says. A
--    hidden runtime must still end the show on time and still stop selling a
--    finished one, so nothing that computes an end time reads this column.
--    Default true: every existing title looks exactly as it does now.
--
-- 2. duration_minutes on events and live_performances. Until now only a film
--    had a runtime of its own; an event's lived on each show ("Runs For" in
--    the show form), so a run of twelve performances needed it typed twelve
--    times and anything left blank fell to the two-hour default. Now the event
--    carries it and every show inherits it, exactly as a film's shows already
--    did. Nullable, unlike movies: blank still means the two-hour default.
--    A show's own duration_minutes is still the override and still wins, so
--    no existing show's end time moves.

ALTER TABLE public.movies
  ADD COLUMN show_runtime boolean NOT NULL DEFAULT true;

ALTER TABLE public.events
  ADD COLUMN duration_minutes integer CHECK (duration_minutes > 0),
  ADD COLUMN show_runtime boolean NOT NULL DEFAULT true;

ALTER TABLE public.live_performances
  ADD COLUMN duration_minutes integer CHECK (duration_minutes > 0),
  ADD COLUMN show_runtime boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.movies.show_runtime IS
  'Whether the public badge row shows the runtime. Display only: end-time math uses duration_minutes regardless.';
COMMENT ON COLUMN public.events.show_runtime IS
  'Whether the public badge row shows the runtime. Display only: end-time math uses duration_minutes regardless.';
COMMENT ON COLUMN public.live_performances.show_runtime IS
  'Whether the public badge row shows the runtime. Display only: end-time math uses duration_minutes regardless.';
COMMENT ON COLUMN public.events.duration_minutes IS
  'Runtime of every show of this event, unless a show sets its own. NULL: the two-hour default (showing_ends_at).';
COMMENT ON COLUMN public.live_performances.duration_minutes IS
  'Runtime of every show of this performance, unless a show sets its own. NULL: the two-hour default (showing_ends_at).';

-- Movies are read by the public through a column-level grant (20260701020754),
-- so a new public column is invisible to the site until it is named here.
-- Without it the public select names a column anon cannot read and fails.
-- Events and live_performances carry a table-level grant and need nothing.
GRANT SELECT (show_runtime) ON public.movies TO anon;

-- The end of a showing now falls through to whichever production it belongs
-- to, not only a film. Same chain as resolveDurationMinutes() in both
-- purchasable.ts twins: the show's own → the production's → 120. A show has
-- exactly one of movie_id / event_id / live_performance_id, so at most one of
-- the three lookups finds a row.
CREATE OR REPLACE FUNCTION public.showing_ends_at(s public.showings)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.start_time + make_interval(
    mins => COALESCE(
      NULLIF(GREATEST(s.duration_minutes, 0), 0),
      NULLIF(GREATEST((SELECT m.duration_minutes FROM public.movies m WHERE m.id = s.movie_id), 0), 0),
      NULLIF(GREATEST((SELECT e.duration_minutes FROM public.events e WHERE e.id = s.event_id), 0), 0),
      NULLIF(GREATEST((SELECT l.duration_minutes FROM public.live_performances l WHERE l.id = s.live_performance_id), 0), 0),
      120
    )
  )
$function$;

COMMENT ON FUNCTION public.showing_ends_at(public.showings) IS
  'The instant a showing is over, and with it the last moment it can be sold. Duration resolves showings.duration_minutes -> the production''s duration_minutes (movies, events or live_performances) -> 120. Single source of truth for enforce_showing_not_past(); mirrored by showingEndsAt() in src/lib/purchasable.ts and supabase/functions/_shared/purchasable.ts.';
