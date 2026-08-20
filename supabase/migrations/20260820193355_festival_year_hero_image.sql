-- A photograph at the top of the page.
--
-- Per year rather than per festival, for the same reason the blurb is: the
-- picture that opens the page is a picture of a particular festival. Last
-- year's audience under last year's screen is the right image for last year and
-- a slightly dishonest one for this year, and a single festival-wide hero would
-- quietly become whichever year someone last replaced it with.
--
-- It lives in the festival-programs bucket. That bucket was described as holding
-- scanned programmes, and a hero photograph is not one — but it is public,
-- admin-write, already accepts image/jpeg, and the alternative is a second
-- bucket whose policies would be copied from this one and then drift. Paths are
-- prefixed hero/ so the two kinds of file stay legible to a human reading the
-- object list.

ALTER TABLE public.festival_years
  ADD COLUMN IF NOT EXISTS hero_image_path text;

COMMENT ON COLUMN public.festival_years.hero_image_path IS
  'Storage path in festival-programs (prefixed hero/) of the photograph that opens the festival page for this year. NULL simply means the page starts at its title, which is how it looked before there was a photograph — so a year without one is not a broken page.';
