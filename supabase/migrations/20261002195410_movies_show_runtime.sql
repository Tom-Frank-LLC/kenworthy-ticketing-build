-- A film's runtime can be kept off the public page. BRIEF-movie-show-runtime.
--
-- Display only. duration_minutes still decides when a showing ends — isPast,
-- the "has this passed" refusal in price_ticket_order (via showing_ends_at),
-- the showtime filters and the JSON-LD endDate — whatever this says. A hidden
-- runtime must still end the show on time and still stop selling a finished
-- screening, so nothing that computes an end time reads this column.
--
-- Default true: every existing film keeps showing its runtime exactly as now.

ALTER TABLE public.movies
  ADD COLUMN show_runtime boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.movies.show_runtime IS
  'Whether the public badge row shows the runtime. Display only: end-time math uses duration_minutes regardless.';

-- Movies are read by the public through a column-level grant (20260701020754),
-- so a new public column is invisible to the site until it is named here.
-- Without it the public select names a column anon cannot read and fails.
GRANT SELECT (show_runtime) ON public.movies TO anon;
