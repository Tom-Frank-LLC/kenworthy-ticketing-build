-- This year's words, and a way to reach the year that has no scans yet.
--
-- festival_years was created to hold a trailer and left deliberately thin, with
-- a note that dates and a per-year blurb were the obvious next tenants. They
-- are, and sooner than expected: the festival page's copy is still three
-- constants in the component, so changing a sentence about this year's
-- programme means a code edit, a build and a deploy — for a paragraph.
--
-- The blurb is per-year rather than per-festival because that is what it is
-- about. "The fourth annual festival concludes with FAUST" is true of 2026 and
-- false of everything else, and a single festival-level paragraph would have to
-- be rewritten every August anyway, losing what it said last time.
--
-- The festival's own name and the archive's standing description stay in code
-- for now. They are properties of the festival rather than of a year, they have
-- not changed in four editions, and giving them a home is a different change —
-- one that wants a festivals table, not another column here.

ALTER TABLE public.festival_years
  ADD COLUMN IF NOT EXISTS blurb text;

COMMENT ON COLUMN public.festival_years.blurb IS
  'What this year''s festival is, in the page''s own voice, shown under the title in place of the standing description. NULL falls back to the constant in SilentFilmFestival.tsx, so a year nobody has written about still reads as a finished page rather than a gap.';
