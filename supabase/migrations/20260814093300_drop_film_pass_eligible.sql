-- Retire showings.film_pass_eligible.
--
-- Its whole content was copied into pass_type_showings by the migration before
-- this one, and nothing reads it any more: the door reads the join table, the
-- scanner reads the join table, the showing form writes the join table.
--
-- Why this is a separate file rather than the tail of that one.
--
-- Dropping a column breaks every query that names it, immediately, including
-- the ones running in a browser tab somebody opened this morning. TicketScanner
-- selects film_pass_eligible when it loads tonight's screenings, so between the
-- drop and the frontend deploy a staff device on the old bundle gets a failed
-- query and an empty screening list — at the door, that reads as "nothing is
-- scheduled" and there is no way to scan a pass at all.
--
-- Splitting the change gives a window where both bundles work: the new table
-- exists and is populated, the old column still exists and is still true.
--
--   1. apply 20260814093200 — new model live, old column intact
--   2. deploy the frontend and film-pass-checkout
--   3. apply this file — the old column goes
--
-- Steps 1 and 3 are the same release; the ordering is an ordering, not a
-- deferral. Run them minutes apart, not weeks.
--
-- The trigger goes with the column, and it is the more interesting of the two.
-- enforce_film_pass_eligibility existed to make "a pass is for films" structural
-- — a showing with no movie_id could never be eligible whatever a form
-- submitted. That guarantee is genuinely being given up, because a festival
-- pass covering a live performance inside the festival is the feature. What
-- replaces it is that nothing is eligible unless a row says so, which closes
-- the same door from the other side: the old failure mode was a form setting a
-- flag it should not have, and the new one requires somebody to deliberately
-- tag a screening for a named pass.

DROP TRIGGER IF EXISTS enforce_film_pass_eligibility_trg ON public.showings;

DROP FUNCTION IF EXISTS public.enforce_film_pass_eligibility();

ALTER TABLE public.showings
  DROP COLUMN IF EXISTS film_pass_eligible;
