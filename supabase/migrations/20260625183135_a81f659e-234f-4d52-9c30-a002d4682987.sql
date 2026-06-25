
-- shift_requests
CREATE TABLE public.shift_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type text NOT NULL CHECK (request_type IN ('swap','time_off')),
  shift_id text,
  shift_start timestamptz,
  shift_end timestamptz,
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','cancelled')),
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_requests TO authenticated;
GRANT ALL ON public.shift_requests TO service_role;
ALTER TABLE public.shift_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff and admin view shift requests" ON public.shift_requests
FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'staff')
  OR requester_id = auth.uid()
  OR target_user_id = auth.uid()
);
CREATE POLICY "Users create own shift requests" ON public.shift_requests
FOR INSERT TO authenticated WITH CHECK (requester_id = auth.uid());
CREATE POLICY "Admin/staff update shift requests" ON public.shift_requests
FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'staff') OR requester_id = auth.uid()
);
CREATE POLICY "Admin delete shift requests" ON public.shift_requests
FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_shift_requests_updated BEFORE UPDATE ON public.shift_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- labor_settings (singleton)
CREATE TABLE public.labor_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ot_weekly_hours numeric NOT NULL DEFAULT 40,
  tip_method text NOT NULL DEFAULT 'off' CHECK (tip_method IN ('off','pooled_equal','by_hours')),
  role_wage_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.labor_settings TO authenticated;
GRANT ALL ON public.labor_settings TO service_role;
ALTER TABLE public.labor_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage labor settings" ON public.labor_settings
FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_labor_settings_updated BEFORE UPDATE ON public.labor_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.labor_settings (ot_weekly_hours, tip_method) VALUES (40, 'off');

-- payroll_exports
CREATE TABLE public.payroll_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','partial')),
  qbo_batch_id text,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  exported_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_exports TO authenticated;
GRANT ALL ON public.payroll_exports TO service_role;
ALTER TABLE public.payroll_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage payroll exports" ON public.payroll_exports
FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_payroll_exports_updated BEFORE UPDATE ON public.payroll_exports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
