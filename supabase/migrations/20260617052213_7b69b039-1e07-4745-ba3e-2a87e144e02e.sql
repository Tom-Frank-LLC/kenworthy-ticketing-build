
CREATE TABLE public.rental_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_request_id uuid NOT NULL REFERENCES public.rental_requests(id) ON DELETE CASCADE,
  line_kind text NOT NULL DEFAULT 'general',
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  account_id uuid REFERENCES public.chart_of_accounts(id),
  is_taxable boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ril_request ON public.rental_invoice_lines(rental_request_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_invoice_lines TO authenticated;
GRANT ALL ON public.rental_invoice_lines TO service_role;

ALTER TABLE public.rental_invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/staff manage invoice lines" ON public.rental_invoice_lines
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Renter reads own invoice lines" ON public.rental_invoice_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rental_requests r
    WHERE r.id = rental_invoice_lines.rental_request_id
      AND r.email = (SELECT email FROM public.profiles WHERE id = auth.uid())
  ));

CREATE TRIGGER ril_updated_at BEFORE UPDATE ON public.rental_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
