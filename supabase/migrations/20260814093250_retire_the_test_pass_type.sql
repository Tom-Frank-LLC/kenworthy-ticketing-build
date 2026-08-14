-- Retire a pass type that was only ever a test.
--
-- Production carries two active film_pass_types: "10-film pass", which is the
-- real one, and "first test pass", created while the physical-pass work was
-- being tried out and never cleaned up.
--
-- That was harmless while eligibility was a flag on the showing — an unsold
-- pass type sitting in a list costs nothing. It stops being harmless one
-- migration earlier than this one: 20260814093200 seeds is_default_for_movies
-- on *every active* type and then backfills a pass_type_showings row for each
-- of them against every screening that was film_pass_eligible. On production
-- that is 1,109 screenings, so the test pass would silently acquire 1,109
-- eligibility rows and become genuinely redeemable at every standard film in
-- the building.
--
-- The seed is not wrong. It cannot be: "which of these types is real" is not a
-- question the schema can answer, and every type that existed when this model
-- was designed *was* a standard film pass. What it cannot know is that one row
-- on one environment is an artefact. So the correction is data, stated here
-- rather than typed into a console where nobody could review it afterwards.
--
-- Deliberately not a DELETE. Passes may have been issued against this type —
-- production holds 41 pass rows — and deleting the type they point at would
-- either fail on the foreign key or, worse, take real history with it.
-- Deactivating stops it being sold and stops it being pre-selected; removing
-- its eligibility rows stops it being redeemed. The row itself, and anything
-- attached to it, stays answerable.
--
-- Matched by name, which is the only handle that exists (ids differ per
-- environment). Idempotent, and a no-op anywhere the row is absent — staging
-- has no such type, so this does nothing there.

UPDATE public.film_pass_types
SET is_active             = false,
    is_default_for_movies = false
WHERE lower(btrim(name)) = 'first test pass';

-- The rows 20260814093200 just created for it, if it was active when that ran.
-- Scoped by the same name test so this can never reach the real pass type.
DELETE FROM public.pass_type_showings pts
USING public.film_pass_types t
WHERE t.id = pts.pass_type_id
  AND lower(btrim(t.name)) = 'first test pass';
