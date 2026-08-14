
-- =============================================
-- HISTORICAL SCREENINGS (100-year archive)
-- =============================================
CREATE TABLE public.historical_screenings (
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
CREATE INDEX idx_hist_screen_year ON public.historical_screenings(year);
CREATE INDEX idx_hist_screen_venue ON public.historical_screenings(venue_name);
CREATE INDEX idx_hist_screen_title ON public.historical_screenings(film_title_normalized);
CREATE INDEX idx_hist_screen_movie ON public.historical_screenings(matched_movie_id);
CREATE INDEX idx_hist_screen_date ON public.historical_screenings(screening_date);

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

-- =============================================
-- KENWORTHY HISTORY (renovations, milestones)
-- =============================================
CREATE TABLE public.kenworthy_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date date,
  year int NOT NULL,
  end_date date,
  category text NOT NULL CHECK (category IN ('renovation','ownership','milestone','closure','reopening','community','programming')),
  title text NOT NULL,
  description text,
  image_url text,
  source_url text,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_kw_history_year ON public.kenworthy_history(year);

GRANT SELECT ON public.kenworthy_history TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.kenworthy_history TO authenticated;
GRANT ALL ON public.kenworthy_history TO service_role;

ALTER TABLE public.kenworthy_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read kenworthy history"
  ON public.kenworthy_history FOR SELECT
  USING (true);
CREATE POLICY "Admins manage kenworthy history"
  ON public.kenworthy_history FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_kw_history_updated
  BEFORE UPDATE ON public.kenworthy_history
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- FINANCIAL ENTRIES (income & expense, admin only)
-- =============================================
CREATE TABLE public.financial_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date,
  source_year int NOT NULL,
  source_month text,
  event_name text,
  series text,
  weekday text,
  format text,
  check_status text,
  distributor text,
  fee_terms text,
  -- attendance
  attendance int,
  adult int,
  child int,
  kfs int,
  free int,
  -- income
  box_office numeric(12,2),
  box_tax numeric(12,2),
  concessions numeric(12,2),
  concession_tax numeric(12,2),
  rental numeric(12,2),
  sponsorship numeric(12,2),
  passes numeric(12,2),
  merch numeric(12,2),
  total_income numeric(12,2),
  -- expenses
  licensing numeric(12,2),
  other_fees numeric(12,2),
  shipping numeric(12,2),
  online_mkt numeric(12,2),
  print_mkt numeric(12,2),
  staff numeric(12,2),
  utilities numeric(12,2),
  square_fee numeric(12,2),
  sales_tax numeric(12,2),
  supply numeric(12,2),
  total_expense numeric(12,2),
  -- bottom line
  net numeric(12,2),
  pass_amount numeric(12,2),
  net_plus_pass numeric(12,2),
  con_avg numeric(12,2),
  notes text,
  -- linking
  matched_movie_id uuid REFERENCES public.movies(id) ON DELETE SET NULL,
  matched_showing_id uuid REFERENCES public.showings(id) ON DELETE SET NULL,
  is_month_total boolean NOT NULL DEFAULT false,
  raw_row jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fin_entry_date ON public.financial_entries(entry_date);
CREATE INDEX idx_fin_entry_year ON public.financial_entries(source_year);
CREATE INDEX idx_fin_entry_event ON public.financial_entries(event_name);
CREATE INDEX idx_fin_entry_movie ON public.financial_entries(matched_movie_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_entries TO authenticated;
GRANT ALL ON public.financial_entries TO service_role;

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage financial entries"
  ON public.financial_entries FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_fin_entry_updated
  BEFORE UPDATE ON public.financial_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
