-- Read-only. Films with no working poster, for scripts/backfill-archive-posters.mjs:
-- every film the Kenworthy archive links to, plus any listing whose poster is a
-- dead WordPress URL (kenworthy.org/wp-content answers 410 since the site moved;
-- see docs/FINDINGS-wp-poster-mixup.md), where the poster is blank or dead.
-- `year` is the listing's release_year, else the archive's film_year when its
-- rows agree on one (as in archive-credit-candidates.sql).
SELECT m.id, m.title, m.is_archival, m.poster_url,
       COALESCE(m.release_year, a.film_year) AS year
  FROM public.movies m
  LEFT JOIN (
    SELECT matched_movie_id,
           CASE WHEN count(DISTINCT film_year) = 1 THEN min(film_year) END AS film_year
      FROM public.historical_screenings
     WHERE venue_name = 'Kenworthy' AND matched_movie_id IS NOT NULL
     GROUP BY matched_movie_id
  ) a ON a.matched_movie_id = m.id
 WHERE (a.matched_movie_id IS NOT NULL OR m.poster_url ~* 'kenworthy\.org/wp-content')
   AND (m.poster_url IS NULL OR m.poster_url ~* 'kenworthy\.org/wp-content')
 ORDER BY m.id;
