-- A showing that has already happened stays readable by the public.
--
-- Why
-- ---
-- Links to past showings answered 404 (docs/briefs/BRIEF-past-event-graceful.md).
-- The page for a past showing already renders "This showing has passed" with
-- the rest of the run beneath it — but only when the row loads, and the anon
-- SELECT policy was `is_active = true OR staff`. Once a showing is inactive
-- the public cannot read it at all: the Worker answers 404 and the SPA bounced
-- to the home page with no explanation.
--
-- Measured before this change (staging, 2026-09-09): 1,755 of 1,787 past
-- showings are inactive — every one of them created by the August archive
-- import, none with a ticket sold. Every showing that sold through this
-- platform is still active. Production has the same shape: anon sees 70
-- showings, and the earliest visible past one is 14 Aug 2026.
--
-- Why the policy and not the flag
-- -------------------------------
-- The brief's first option was to keep past rows `is_active = true` and let
-- listings hide them by date. That would mean flipping the archive rows on,
-- and `is_active = true` is what a dozen admin queries use to mean "current"
-- (docs/TASKS.md, "Listings filters is_active = true (small, uncapped)"),
-- with PostgREST's 1,000-row cap waiting behind them. Widening the read rule
-- touches none of that: every `.eq('is_active', true)` query behaves exactly
-- as before, and the flag keeps meaning what admin screens think it means.
--
-- What it exposes
-- ---------------
-- A never-published showing whose date has passed becomes readable by direct
-- link. Nothing lists it (every listing filters `is_active = true` and by
-- date); it would have to be reached by its UUID. Productions are untouched:
-- movies/events/live_performances still require `is_active = true`, so a
-- hidden *title* stays hidden and its showing page renders the not-found
-- state instead.
--
-- `start_time < now()` rather than "ended": duration is nullable and the film
-- fallback lives in the app. A hidden showing becomes readable at curtain,
-- not at the credits, which is the same instant the page stops selling it.

DROP POLICY IF EXISTS "Anyone can view active showings" ON public.showings;
CREATE POLICY "Anyone can view active showings"
  ON public.showings FOR SELECT
  USING (
    is_active = true
    OR start_time < now()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'staff'::app_role)
  );
