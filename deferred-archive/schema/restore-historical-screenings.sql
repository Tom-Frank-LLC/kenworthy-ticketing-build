-- Restore DDL for the screened-films archive table.
--
-- NOTE: the original creating migration
--   supabase/migrations/20260608170228_b912e070-bc5f-4c18-a3be-523daf12956a.sql
-- also creates `kenworthy_history` and `financial_entries`, which are NOT part of
-- the archive and stay live. Do NOT re-run that migration to restore the archive —
-- it would fail on the existing tables. Use this file instead: it is the
-- historical_screenings-only subset, extracted verbatim.
--
-- As of the August 2026 removal the table was left DORMANT (data intact, no UI
-- reads it), so this file is only needed if the table is later dropped.

CREATE TABLE IF NOT EXISTS public.historical_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_date date NOT NULL,
  year int NOT NULL,
  venue_name text NOT NULL,
  film_title_normalized text NOT NULL,
  film_title_display text NOT NULL,
  film_year int,
  is_double_feature boolean NOT NULL DEFAULT false,
  raw_cell text NOT NULL,
  matched_movie_id uuid REFERENCES public.movies(id) ON DELETE SET NULL,
  match_confidence text CHECK (match_confidence IN ('auto_high','auto_low','manual','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hist_screen_year  ON public.historical_screenings(year);
CREATE INDEX IF NOT EXISTS idx_hist_screen_venue ON public.historical_screenings(venue_name);
CREATE INDEX IF NOT EXISTS idx_hist_screen_title ON public.historical_screenings(film_title_normalized);
CREATE INDEX IF NOT EXISTS idx_hist_screen_movie ON public.historical_screenings(matched_movie_id);
CREATE INDEX IF NOT EXISTS idx_hist_screen_date  ON public.historical_screenings(screening_date);

GRANT SELECT ON public.historical_screenings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.historical_screenings TO authenticated;
GRANT ALL ON public.historical_screenings TO service_role;

ALTER TABLE public.historical_screenings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read historical screenings"
  ON public.historical_screenings FOR SELECT
  USING (true);

CREATE POLICY "Admins manage historical screenings"
  ON public.historical_screenings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_hist_screen_updated
  BEFORE UPDATE ON public.historical_screenings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
