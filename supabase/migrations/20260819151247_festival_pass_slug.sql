-- Which pass is the festival's pass.
--
-- The festival page has to find one row in film_pass_types and it cannot do it
-- by name. `SILENT FILM FESTIVAL PASS` exists three times in the Square catalog
-- as duplicate SKUs, the site's copy of it does not exist yet at all, and the
-- name is an editable field in the admin form — so any string the page matched
-- on would be a string someone can change without knowing a page depends on it.
-- The failure would also be silent and total: no pass found means no buy button
-- AND no screenings, because the lineup is derived from the pass.
--
-- So the pass carries an explicit mark instead. NULL for an ordinary pass, a
-- slug for a festival's pass, and the page asks for the slug.
--
-- This is not a second eligibility mechanism. What the pass covers is still
-- pass_type_showings and only that. This column answers a different and much
-- smaller question — "which pass does the silent-film-festival page advertise"
-- — and deliberately answers nothing about redemption, so the door's behaviour
-- cannot drift from what the page shows.

ALTER TABLE public.film_pass_types
  ADD COLUMN IF NOT EXISTS festival_slug text;

COMMENT ON COLUMN public.film_pass_types.festival_slug IS
  'The festival whose page sells this pass, matching that page''s route and festival_programs.festival_slug — for example silent-film-festival. NULL for an ordinary pass, which is every pass that is not tied to one named run. Purely a lookup key for the festival page: eligibility remains pass_type_showings, so setting this neither grants nor removes admission anywhere.';

-- One pass per festival. The page shows a single pass and a second matching row
-- would make which one it shows depend on row order, so the ambiguity is
-- refused here rather than resolved arbitrarily at read time. Partial, so the
-- NULLs that every ordinary pass carries are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS film_pass_types_festival_slug_key
  ON public.film_pass_types (festival_slug)
  WHERE festival_slug IS NOT NULL;
