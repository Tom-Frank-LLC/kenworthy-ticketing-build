-- Director and cast for every film, and the archive's film details for the
-- History page.
--
-- 1. movies.director and movies.cast_members (free text, "Name, Name, …").
--    `cast` is an SQL keyword, hence cast_members. Both are public: anon gets
--    a column grant like the rest of MOVIE_PUBLIC_COLUMNS (anon has no
--    table-level grant on movies; see 20261006225932).
--
-- 2. archive_film_details(): genre, rating, director and cast of every movie
--    the Kenworthy archive links to, so the History page's "Every film" table
--    can search and show them. A function rather than a direct read because
--    anon's movies policy shows only active and archival films, and 181
--    archive films are linked to one of our own past listings, which are
--    inactive. It returns only columns anon may already read on any visible
--    film, for films the theatre is on record as having shown. It returns
--    only films with at least one of those fields set, so the page loads
--    nothing for the ~8,500 archive films nobody has filled in yet.

ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS director text,
  ADD COLUMN IF NOT EXISTS cast_members text;

GRANT SELECT (director, cast_members) ON public.movies TO anon;

CREATE OR REPLACE FUNCTION public.archive_film_details()
RETURNS TABLE (movie_id uuid, genre text, rating text, director text, cast_members text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.genre, m.rating, m.director, m.cast_members
    FROM public.movies m
   WHERE (m.genre IS NOT NULL OR m.rating IS NOT NULL
          OR m.director IS NOT NULL OR m.cast_members IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.historical_screenings h
                  WHERE h.matched_movie_id = m.id AND h.venue_name = 'Kenworthy')
   ORDER BY m.id
$$;

REVOKE ALL ON FUNCTION public.archive_film_details() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_film_details() TO anon, authenticated, service_role;
