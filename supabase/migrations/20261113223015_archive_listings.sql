-- The screened-films archive becomes movie listings and showings.
--
-- historical_screenings holds 10,028 Kenworthy screenings (1926–2025, real
-- opening dates) for 8,721 distinct films. Until now nothing tied them to
-- `movies`: matched_movie_id was NULL on every row, because the edge function
-- meant to fill it re-read the same unmatched batch forever and never finished.
--
-- This migration adds the schema and one function, import_archive_listings(),
-- which does the work. It does NOT run the import: that is a data write sized
-- by each database's own catalogue, so it is run deliberately, after a dry run
-- (see docs/briefs/BRIEF-archive-listings.md).
--
-- The rules, as decided with Tom on 2026-11-13:
--
--   * Archival showings are public. Past showings were already readable by
--     anon (start_time < now()); archive-only films are inactive, so the movies
--     policy gains `OR is_archival` or a patron would see a showing with no
--     title. Distributor terms stay hidden — anon's grant on movies is per
--     column and is_archival is the only column added to it.
--   * They stay off the operational surfaces (dashboard, pickers, box office,
--     calendar for now). Every such reader filters `is_archival`; the column
--     exists so they can.
--   * An archive film we already list is tied to THAT movie, so its history
--     travels with the current listing. Only films with no listing get a new,
--     archival movie.
--   * Where we already have our own showing of the film within the archive
--     run (3 days before to 14 after its opening date), ours stands and no
--     archival showing is made. The archive row is still linked to the movie.
--   * The archive has dates, not times: archival showings start at 7:00 PM
--     Pacific. That is a placeholder, which is_archival says.

-- ---------------------------------------------------------------------------
-- 1. Title normalisation, in SQL
-- ---------------------------------------------------------------------------
-- Mirrors src/lib/normalizeTitle.ts, which computed film_title_normalized when
-- the workbook was uploaded. The two must agree or a film never meets its
-- listing; the brief records the check that they do over every archive row.

CREATE OR REPLACE FUNCTION public.normalize_film_title(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT regexp_replace(
           regexp_replace(
             btrim(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(lower(coalesce(raw, '')), '\(\d{4}\)', ' ', 'g'),
                   '[‘’'']', '', 'g'),
                 '[^a-z0-9]+', ' ', 'g')),
             '^(the|a|an)\s+', ''),
           '\s+', ' ', 'g')
$$;

REVOKE ALL ON FUNCTION public.normalize_film_title(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_film_title(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS is_archival boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.movies.is_archival IS
  'A film known only from the screened-films archive: no current listing. Kept off the dashboard and pickers. Cleared automatically when the film gets a live showing or is made active.';

-- CASCADE, not SET NULL: with SET NULL, clearing the archive would turn every
-- archival showing into an ordinary one and drop ten thousand of them onto the
-- dashboard and calendar.
ALTER TABLE public.showings
  ADD COLUMN IF NOT EXISTS historical_screening_id uuid UNIQUE
    REFERENCES public.historical_screenings(id) ON DELETE CASCADE;

-- Generated, so it cannot disagree with the link that defines it.
ALTER TABLE public.showings
  ADD COLUMN IF NOT EXISTS is_archival boolean
    GENERATED ALWAYS AS (historical_screening_id IS NOT NULL) STORED;

COMMENT ON COLUMN public.showings.historical_screening_id IS
  'The archive row this showing was made from. Its start time is a 7:00 PM placeholder; the archive records dates only.';
COMMENT ON COLUMN public.showings.is_archival IS
  'Made from the screened-films archive. Public, but off the operational surfaces; filter on it.';

-- The dashboard and pickers read only live rows, by these orders.
CREATE INDEX IF NOT EXISTS showings_live_start_time_idx
  ON public.showings (start_time DESC) WHERE NOT is_archival;
CREATE INDEX IF NOT EXISTS movies_live_title_idx
  ON public.movies (title) WHERE NOT is_archival;
CREATE INDEX IF NOT EXISTS historical_screenings_matched_movie_idx
  ON public.historical_screenings (matched_movie_id) WHERE matched_movie_id IS NOT NULL;

-- anon's grant on movies is per column (distributor terms live there). The
-- allowlist in supabase/tests/anon_surface/surface.sql and MOVIE_PUBLIC_COLUMNS
-- carry this column too. showings is a whole-table grant, so its new columns
-- need nothing.
GRANT SELECT (is_archival) ON public.movies TO anon;

-- ---------------------------------------------------------------------------
-- 3. Public can read archival films
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone can view active movies" ON public.movies;
CREATE POLICY "Anyone can view active movies"
  ON public.movies FOR SELECT
  USING (
    is_active = true
    OR is_archival = true
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'staff'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 4. A film that comes back stops being archival
-- ---------------------------------------------------------------------------
-- Two ways it comes back, and both clear the flag, so the movie reappears on
-- the dashboard with its archive history still attached:
--   * staff make the listing active (the "use the archive listing" path in
--     the movie form);
--   * a live showing is created for it.

CREATE OR REPLACE FUNCTION public.movies_clear_archival_on_activate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_active AND NEW.is_archival THEN
    NEW.is_archival := false;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS movies_clear_archival_on_activate ON public.movies;
CREATE TRIGGER movies_clear_archival_on_activate
  BEFORE INSERT OR UPDATE OF is_active, is_archival ON public.movies
  FOR EACH ROW EXECUTE FUNCTION public.movies_clear_archival_on_activate();

CREATE OR REPLACE FUNCTION public.showings_clear_movie_archival()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.movie_id IS NOT NULL AND NEW.historical_screening_id IS NULL THEN
    UPDATE public.movies SET is_archival = false
     WHERE id = NEW.movie_id AND is_archival;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS showings_clear_movie_archival ON public.showings;
CREATE TRIGGER showings_clear_movie_archival
  AFTER INSERT OR UPDATE OF movie_id, historical_screening_id ON public.showings
  FOR EACH ROW EXECUTE FUNCTION public.showings_clear_movie_archival();

REVOKE ALL ON FUNCTION public.movies_clear_archival_on_activate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.showings_clear_movie_archival() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The import
-- ---------------------------------------------------------------------------
-- Idempotent: rows already linked keep their movie (including a hand-set
-- 'manual' link), rows marked 'rejected' are left alone, and a showing is made
-- at most once per archive row (the UNIQUE on historical_screening_id). After
-- a new workbook upload, running it again links and lists only the new rows.
--
-- p_dry_run (the default) does everything inside a subtransaction, counts it,
-- and rolls it back: the numbers are what a real run would do, against this
-- database's own catalogue.
--
-- Which listing an archive film joins:
--   1. An archival movie this function made earlier for the same title and
--      release year (a re-run, or a later upload).
--   2. Otherwise one of our current listings with the same normalised title,
--      when its release year (if set) agrees. Current listings have no
--      release year today, so a title shared by several films — a remake —
--      cannot be told apart by year. Only ONE archive film per title joins a
--      current listing: the one whose release year matches it, else the most
--      recent. The others get archival movies of their own. Where several
--      current listings share a title, the one shown most recently wins.
--   3. Otherwise a new archival movie: inactive, is_archival, release_year
--      from the archive, runtime hidden (the archive does not record it).

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
      INSERT INTO public.movies (title, release_year, is_active, is_archival, show_runtime)
      SELECT f.title, f.fy, false, true, false
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
