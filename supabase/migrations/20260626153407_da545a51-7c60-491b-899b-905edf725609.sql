
-- =========================================================
-- DVD Rentals
-- =========================================================

CREATE TYPE public.dvd_rental_status AS ENUM (
  'reserved', 'checked_out', 'returned', 'overdue', 'cancelled'
);

-- ---------- dvds ----------
CREATE TABLE public.dvds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  year integer,
  director text,
  genre text,
  synopsis text,
  cover_url text,
  copies_total integer NOT NULL DEFAULT 1 CHECK (copies_total >= 0),
  copies_available integer NOT NULL DEFAULT 1 CHECK (copies_available >= 0),
  rental_price numeric(10,2) NOT NULL DEFAULT 3.00 CHECK (rental_price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dvds TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dvds TO authenticated;
GRANT ALL ON public.dvds TO service_role;

ALTER TABLE public.dvds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active dvds" ON public.dvds
  FOR SELECT USING (is_active = true OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins manage dvds" ON public.dvds
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE TRIGGER dvds_updated_at BEFORE UPDATE ON public.dvds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- dvd_settings ----------
CREATE TABLE public.dvd_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_days integer NOT NULL DEFAULT 7 CHECK (loan_days > 0),
  max_active_per_user integer NOT NULL DEFAULT 3 CHECK (max_active_per_user > 0),
  late_fee_per_day numeric(10,2) NOT NULL DEFAULT 1.00 CHECK (late_fee_per_day >= 0),
  default_rental_price numeric(10,2) NOT NULL DEFAULT 3.00 CHECK (default_rental_price >= 0),
  reservation_hold_hours integer NOT NULL DEFAULT 48 CHECK (reservation_hold_hours > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dvd_settings TO anon, authenticated;
GRANT ALL ON public.dvd_settings TO service_role;

ALTER TABLE public.dvd_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read dvd settings" ON public.dvd_settings
  FOR SELECT USING (true);

CREATE POLICY "Admins manage dvd settings" ON public.dvd_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER dvd_settings_updated_at BEFORE UPDATE ON public.dvd_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed singleton row
INSERT INTO public.dvd_settings DEFAULT VALUES;

-- ---------- dvd_rentals ----------
CREATE TABLE public.dvd_rentals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dvd_id uuid NOT NULL REFERENCES public.dvds(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.dvd_rental_status NOT NULL DEFAULT 'reserved',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  checked_out_at timestamptz,
  due_at timestamptz,
  returned_at timestamptz,
  rental_price numeric(10,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,4) NOT NULL DEFAULT 0.06,
  tax_amount numeric(10,2) NOT NULL DEFAULT 0,
  late_fee numeric(10,2) NOT NULL DEFAULT 0,
  processing_fee numeric(10,2) NOT NULL DEFAULT 0,
  total_paid numeric(10,2) NOT NULL DEFAULT 0,
  payment_method text,
  staff_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dvd_rentals_user_idx ON public.dvd_rentals(user_id);
CREATE INDEX dvd_rentals_dvd_idx ON public.dvd_rentals(dvd_id);
CREATE INDEX dvd_rentals_status_idx ON public.dvd_rentals(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dvd_rentals TO authenticated;
GRANT ALL ON public.dvd_rentals TO service_role;

ALTER TABLE public.dvd_rentals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view own rentals" ON public.dvd_rentals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Members create own reservations" ON public.dvd_rentals
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Members cancel own pending reservations" ON public.dvd_rentals
  FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() AND status = 'reserved')
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')
  )
  WITH CHECK (
    (user_id = auth.uid() AND status IN ('reserved','cancelled'))
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Staff delete rentals" ON public.dvd_rentals
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE TRIGGER dvd_rentals_updated_at BEFORE UPDATE ON public.dvd_rentals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- copies_available sync + caps ----------
CREATE OR REPLACE FUNCTION public.dvd_rentals_sync_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_active_count integer;
  v_max integer;
  v_available integer;
  v_loan_days integer;
BEGIN
  SELECT max_active_per_user, loan_days INTO v_max, v_loan_days
  FROM public.dvd_settings ORDER BY created_at LIMIT 1;
  v_max := COALESCE(v_max, 3);
  v_loan_days := COALESCE(v_loan_days, 7);

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('reserved','checked_out','overdue') THEN
      SELECT COUNT(*) INTO v_active_count FROM public.dvd_rentals
       WHERE user_id = NEW.user_id AND status IN ('reserved','checked_out','overdue');
      IF v_active_count >= v_max THEN
        RAISE EXCEPTION 'Active rental limit reached (% per member)', v_max;
      END IF;

      SELECT copies_available INTO v_available FROM public.dvds WHERE id = NEW.dvd_id FOR UPDATE;
      IF v_available IS NULL OR v_available < 1 THEN
        RAISE EXCEPTION 'No copies available for this title';
      END IF;
      UPDATE public.dvds SET copies_available = copies_available - 1 WHERE id = NEW.dvd_id;

      IF NEW.status = 'checked_out' AND NEW.due_at IS NULL THEN
        NEW.due_at := COALESCE(NEW.checked_out_at, now()) + (v_loan_days || ' days')::interval;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- transition from active -> inactive: return a copy
    IF OLD.status IN ('reserved','checked_out','overdue')
       AND NEW.status IN ('returned','cancelled') THEN
      UPDATE public.dvds SET copies_available = copies_available + 1 WHERE id = OLD.dvd_id;
    END IF;
    -- transition from inactive -> active: reclaim a copy
    IF OLD.status IN ('returned','cancelled')
       AND NEW.status IN ('reserved','checked_out','overdue') THEN
      SELECT copies_available INTO v_available FROM public.dvds WHERE id = NEW.dvd_id FOR UPDATE;
      IF v_available < 1 THEN
        RAISE EXCEPTION 'No copies available for this title';
      END IF;
      UPDATE public.dvds SET copies_available = copies_available - 1 WHERE id = NEW.dvd_id;
    END IF;
    -- auto stamp returned_at
    IF NEW.status = 'returned' AND NEW.returned_at IS NULL THEN
      NEW.returned_at := now();
    END IF;
    -- auto stamp checked_out_at + due_at when staff checks out
    IF OLD.status = 'reserved' AND NEW.status = 'checked_out' THEN
      IF NEW.checked_out_at IS NULL THEN NEW.checked_out_at := now(); END IF;
      IF NEW.due_at IS NULL THEN
        NEW.due_at := NEW.checked_out_at + (v_loan_days || ' days')::interval;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('reserved','checked_out','overdue') THEN
      UPDATE public.dvds SET copies_available = copies_available + 1 WHERE id = OLD.dvd_id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER dvd_rentals_sync_inventory_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.dvd_rentals
FOR EACH ROW EXECUTE FUNCTION public.dvd_rentals_sync_inventory();

-- ---------- pricing enforcement ----------
CREATE OR REPLACE FUNCTION public.dvd_rentals_enforce_pricing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_price numeric;
  v_tax_rate numeric := 0.06;
BEGIN
  SELECT rental_price INTO v_price FROM public.dvds WHERE id = NEW.dvd_id;
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'Invalid dvd_id';
  END IF;
  NEW.rental_price := v_price;
  NEW.tax_rate := v_tax_rate;
  NEW.tax_amount := ROUND((v_price + COALESCE(NEW.late_fee,0)) * v_tax_rate, 2);
  IF NEW.late_fee IS NULL OR NEW.late_fee < 0 THEN NEW.late_fee := 0; END IF;
  IF NEW.processing_fee IS NULL OR NEW.processing_fee < 0 THEN NEW.processing_fee := 0; END IF;
  -- total_paid is computed when the rental is paid (checkout or return)
  IF NEW.status IN ('checked_out','returned','overdue') THEN
    NEW.total_paid := ROUND(NEW.rental_price + NEW.late_fee + NEW.tax_amount + NEW.processing_fee, 2);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER dvd_rentals_enforce_pricing_trg
BEFORE INSERT OR UPDATE ON public.dvd_rentals
FOR EACH ROW EXECUTE FUNCTION public.dvd_rentals_enforce_pricing();

-- ---------- audit ----------
CREATE TRIGGER dvds_audit
AFTER INSERT OR UPDATE OR DELETE ON public.dvds
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER dvd_rentals_audit
AFTER INSERT OR UPDATE OR DELETE ON public.dvd_rentals
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
