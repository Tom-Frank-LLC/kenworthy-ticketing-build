-- Read-only. The films the Kenworthy archive links to, for
-- scripts/backfill-archive-credits.mjs. `year` is the listing's release_year,
-- else the archive's film_year when its rows agree on one.
SELECT m.id, m.title, m.is_archival, m.director, m.cast_members, m.genre,
       COALESCE(m.release_year, a.film_year) AS year
  FROM public.movies m
  JOIN (
    SELECT matched_movie_id,
           CASE WHEN count(DISTINCT film_year) = 1 THEN min(film_year) END AS film_year
      FROM public.historical_screenings
     WHERE venue_name = 'Kenworthy' AND matched_movie_id IS NOT NULL
     GROUP BY matched_movie_id
  ) a ON a.matched_movie_id = m.id
 ORDER BY m.id;
