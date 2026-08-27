-- Curator's pick, at the showing level.
--
-- The flag already exists on movies, events and live_performances, where it
-- means "this production is the pick" — and the home page then has to choose a
-- date for it, which it does by taking the soonest. That is the right answer
-- for a film with a run, but it cannot express the other case: a single night
-- worth singling out. A 35mm print, a director Q&A, the one screening with the
-- live score. Those are properties of the *showing*, not of the film.
--
-- The two flags are independent by design and both may be set. A film flagged
-- at the production level renders as one pick listing its whole run; a flagged
-- showing renders as its own pick for that date alone. Setting both is a
-- deliberate "see this film, and especially this night", and produces two
-- entries rather than one overriding the other.
--
-- Defaults false, so every existing showing is unaffected and the home page
-- behaves exactly as it did until someone ticks the box.

ALTER TABLE public.showings
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.showings.is_featured IS
  'Curator''s pick for this specific date. Independent of the production-level is_featured on movies/events/live_performances; both may be set, and each produces its own entry on the home page.';

-- Partial index: the readers all ask "which showings are picks", which is a
-- handful of rows out of ~1,789. A full index on a mostly-false boolean would
-- be dead weight.
CREATE INDEX IF NOT EXISTS showings_is_featured_idx
  ON public.showings (start_time)
  WHERE is_featured;
