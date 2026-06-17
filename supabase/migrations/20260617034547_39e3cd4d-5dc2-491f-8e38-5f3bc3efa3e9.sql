CREATE TABLE public.staff_square_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  square_team_member_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_square_links TO authenticated;
GRANT ALL ON public.staff_square_links TO service_role;

ALTER TABLE public.staff_square_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all staff links"
  ON public.staff_square_links
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Staff can view their own link"
  ON public.staff_square_links
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER set_staff_square_links_updated_at
  BEFORE UPDATE ON public.staff_square_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();