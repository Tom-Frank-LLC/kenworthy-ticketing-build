-- Archive-only films carry no rating, not "NR".
--
-- The screened-films archive records a date, a theatre, a title and a release
-- year; it has no rating column. import_archive_listings (20261113223015) did
-- not name `rating` when it created an archival movie, so the column default
-- 'NR' filled it in, and every archive film showed an "NR" badge, a claim
-- that the film is unrated, which for most of them is false. NULL means
-- "not known", and ProductionMetaBadges shows no badge for it.
--
-- 1. The import now inserts rating NULL explicitly (function body otherwise
--    unchanged from 20261113223015).
-- 2. Archival films already made get 'NR' cleared. Only is_archival rows
--    still at 'NR' are touched: a film made active (is_archival cleared by
--    trigger) or given a real rating by staff is left alone. Films linked to
--    one of our existing listings were never changed by the import and are
--    not touched here.

CREATE OR REPLACE FUNCTION public.import_archive_listings(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked_existing  int := 0;
  v_linked_archival  int := 0;
  v_movies_created   int := 0;
  v_rows_linked      int := 0;
  v_showings_created int := 0;
  v_skipped_overlap  int := 0;
  v_existing_titles  jsonb := '[]'::jsonb;
  v_audit_run        uuid;
BEGIN
  -- auth.uid() is NULL for the service role and the SQL editor. anon also has
  -- no uid, but holds no EXECUTE on this function.
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an admin can import the archive' USING ERRCODE = '42501';
  END IF;

  -- The first import writes ~18,500 rows to movies and showings, and each would
  -- otherwise be its own audit entry. Run from the server (the SQL editor, a
  -- migration, the service role), it goes through the sanctioned bulk path
  -- instead: a ".started" row, per-row auditing paused for these tables, and
  -- one summary row with the counts. audit_bulk_begin refuses any other
  -- caller, so an admin's run from the Film Archive tab — the small,
  -- after-an-upload case — is audited row by row as usual.
  IF NOT p_dry_run
     AND (session_user IN ('postgres', 'supabase_admin') OR coalesce(auth.role(), '') = 'service_role') THEN
    v_audit_run := public.audit_bulk_begin(
      ARRAY['movies', 'showings', 'historical_screenings'],
      'archive.import_listings', '{}'::jsonb, 30, auth.uid());
  END IF;

  BEGIN
    DROP TABLE IF EXISTS pg_temp._archive_films;
    CREATE TEMP TABLE _archive_films ON COMMIT DROP AS
    SELECT h.film_title_normalized AS n,
           h.film_year             AS fy,
           mode() WITHIN GROUP (ORDER BY h.film_title_display) AS title,
           NULL::uuid              AS movie_id,
           NULL::text              AS how
      FROM public.historical_screenings h
     WHERE h.venue_name = 'Kenworthy'
       AND h.matched_movie_id IS NULL
       AND h.match_confidence IS DISTINCT FROM 'rejected'
       AND h.film_title_normalized <> ''
     GROUP BY h.film_title_normalized, h.film_year;

    -- 1. An archival movie made earlier for exactly this film.
    UPDATE _archive_films f
       SET movie_id = m.id, how = 'archival'
      FROM public.movies m
     WHERE m.is_archival
       AND public.normalize_film_title(m.title) = f.n
       AND m.release_year IS NOT DISTINCT FROM f.fy;
    GET DIAGNOSTICS v_linked_archival = ROW_COUNT;

    -- 2. One of our current listings.
    WITH live AS (
      SELECT DISTINCT ON (public.normalize_film_title(m.title))
             public.normalize_film_title(m.title) AS n, m.id, m.release_year AS ry, m.title
        FROM public.movies m
        LEFT JOIN LATERAL (
          SELECT max(s.start_time) AS last_show
            FROM public.showings s
           WHERE s.movie_id = m.id AND NOT s.is_archival
        ) ls ON true
       WHERE NOT m.is_archival
       ORDER BY public.normalize_film_title(m.title), ls.last_show DESC NULLS LAST, m.id
    ),
    pick AS (
      SELECT DISTINCT ON (f.n) f.n, f.fy, l.id AS movie_id, l.title
        FROM _archive_films f
        JOIN live l ON l.n = f.n
       WHERE f.movie_id IS NULL
         AND (l.ry IS NULL OR f.fy IS NULL OR l.ry = f.fy)
       ORDER BY f.n, (l.ry IS NOT NULL AND l.ry = f.fy) DESC, f.fy DESC NULLS LAST
    )
    UPDATE _archive_films f
       SET movie_id = p.movie_id, how = 'existing'
      FROM pick p
     WHERE f.n = p.n AND f.fy IS NOT DISTINCT FROM p.fy;
    GET DIAGNOSTICS v_linked_existing = ROW_COUNT;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'archive_title', f.title, 'film_year', f.fy,
             'movie_id', f.movie_id, 'movie_title', m.title) ORDER BY f.title), '[]'::jsonb)
      INTO v_existing_titles
      FROM _archive_films f JOIN public.movies m ON m.id = f.movie_id
     WHERE f.how = 'existing';

    -- 3. New archival movies for the rest.
    WITH made AS (
      INSERT INTO public.movies (title, release_year, rating, is_active, is_archival, show_runtime)
      SELECT f.title, f.fy, NULL, false, true, false
        FROM _archive_films f
       WHERE f.movie_id IS NULL
      RETURNING id, title, release_year
    )
    UPDATE _archive_films f
       SET movie_id = made.id, how = 'created'
      FROM made
     WHERE f.movie_id IS NULL
       AND made.title = f.title
       AND made.release_year IS NOT DISTINCT FROM f.fy;
    GET DIAGNOSTICS v_movies_created = ROW_COUNT;

    -- Link the archive rows.
    UPDATE public.historical_screenings h
       SET matched_movie_id = f.movie_id,
           match_confidence = CASE
             WHEN f.how IN ('archival', 'created') THEN 'auto_high'
             WHEN m.release_year IS NOT NULL AND m.release_year = h.film_year THEN 'auto_high'
             ELSE 'auto_low' END
      FROM _archive_films f
      JOIN public.movies m ON m.id = f.movie_id
     WHERE h.venue_name = 'Kenworthy'
       AND h.matched_movie_id IS NULL
       AND h.match_confidence IS DISTINCT FROM 'rejected'
       AND h.film_title_normalized = f.n
       AND h.film_year IS NOT DISTINCT FROM f.fy;
    GET DIAGNOSTICS v_rows_linked = ROW_COUNT;

    -- Showings, except where our own showing of the film already covers the run.
    SELECT count(*) INTO v_skipped_overlap
      FROM public.historical_screenings h
     WHERE h.venue_name = 'Kenworthy'
       AND h.matched_movie_id IS NOT NULL
       AND h.match_confidence IS DISTINCT FROM 'rejected'
       AND NOT EXISTS (SELECT 1 FROM public.showings s WHERE s.historical_screening_id = h.id)
       AND EXISTS (
         SELECT 1 FROM public.showings s
          WHERE s.movie_id = h.matched_movie_id
            AND NOT s.is_archival
            AND s.start_time >= (h.screening_date - 3)::timestamp AT TIME ZONE 'America/Los_Angeles'
            AND s.start_time <  (h.screening_date + 15)::timestamp AT TIME ZONE 'America/Los_Angeles');

    INSERT INTO public.showings
      (movie_id, start_time, is_active, ticket_price, no_ticket_required, historical_screening_id)
    SELECT h.matched_movie_id,
           (h.screening_date + time '19:00') AT TIME ZONE 'America/Los_Angeles',
           false, 0, true, h.id
      FROM public.historical_screenings h
     WHERE h.venue_name = 'Kenworthy'
       AND h.matched_movie_id IS NOT NULL
       AND h.match_confidence IS DISTINCT FROM 'rejected'
       AND NOT EXISTS (SELECT 1 FROM public.showings s WHERE s.historical_screening_id = h.id)
       AND NOT EXISTS (
         SELECT 1 FROM public.showings s
          WHERE s.movie_id = h.matched_movie_id
            AND NOT s.is_archival
            AND s.start_time >= (h.screening_date - 3)::timestamp AT TIME ZONE 'America/Los_Angeles'
            AND s.start_time <  (h.screening_date + 15)::timestamp AT TIME ZONE 'America/Los_Angeles');
    GET DIAGNOSTICS v_showings_created = ROW_COUNT;

    IF p_dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'P0D01', MESSAGE = 'dry run';
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0D01' THEN
    NULL;  -- rolled back; the counts above survive in the variables
  END;

  IF v_audit_run IS NOT NULL THEN
    PERFORM public.audit_bulk_end(v_audit_run, 'archive.import_listings', jsonb_build_object(
      'movies_created', v_movies_created,
      'showings_created', v_showings_created,
      'archive_rows_linked', v_rows_linked,
      'films_linked_to_existing', v_linked_existing));
  END IF;

  RETURN jsonb_build_object(
    'dry_run',                  p_dry_run,
    'films_linked_to_existing', v_linked_existing,
    'films_linked_to_archival', v_linked_archival,
    'movies_created',           v_movies_created,
    'archive_rows_linked',      v_rows_linked,
    'showings_created',         v_showings_created,
    'skipped_overlap',          v_skipped_overlap,
    'existing_links',           v_existing_titles
  );
END $$;

REVOKE ALL ON FUNCTION public.import_archive_listings(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_archive_listings(boolean) TO authenticated, service_role;

-- Backfill. Through the bulk-audit path (db push runs as postgres), so this
-- writes a started row and one summary row instead of one per film.
DO $$
DECLARE
  v_run uuid;
  v_n   integer;
BEGIN
  v_run := public.audit_bulk_begin(ARRAY['movies'], 'archive.clear_placeholder_rating', '{}'::jsonb, 10, NULL);
  UPDATE public.movies SET rating = NULL WHERE is_archival AND rating = 'NR';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.audit_bulk_end(v_run, 'archive.clear_placeholder_rating',
    jsonb_build_object('movies_updated', v_n), NULL);
END
$$;
