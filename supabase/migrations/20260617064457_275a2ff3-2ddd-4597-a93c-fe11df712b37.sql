CREATE TABLE public.sponsorship_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  tagline text,
  intro_text text,
  hook_text text,
  cta_label text DEFAULT 'Learn more',
  section_heading text,
  section_body text,
  benefits jsonb NOT NULL DEFAULT '[]'::jsonb,
  stats_text text,
  price_text text,
  availability_text text,
  contact_name text,
  contact_title text,
  contact_email text,
  contact_phone text,
  hero_image_url text,
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sponsorship_opportunities TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsorship_opportunities TO authenticated;
GRANT ALL ON public.sponsorship_opportunities TO service_role;

ALTER TABLE public.sponsorship_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active opportunities viewable by everyone"
  ON public.sponsorship_opportunities FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins and staff can insert opportunities"
  ON public.sponsorship_opportunities FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins and staff can update opportunities"
  ON public.sponsorship_opportunities FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins can delete opportunities"
  ON public.sponsorship_opportunities FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_sponsorship_opportunities_updated_at
  BEFORE UPDATE ON public.sponsorship_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.sponsorship_opportunities (
  slug, title, tagline, intro_text, hook_text, cta_label,
  section_heading, section_body, benefits, stats_text, price_text, availability_text,
  contact_name, contact_title, contact_email, contact_phone, display_order
) VALUES (
  'summer-family-matinees-2026',
  'Summer Family Matinees',
  'A KPAC Tradition — 2026 Sponsorship Package',
  'The Kenworthy Performing Arts Centre is a nonprofit 501(c)(3) organization dedicated to serving the greater Palouse region with quality entertainment for everyone. We strive to provide quality family entertainment with zero economic barriers to access.',
  'Help us support this mission by sponsoring a family-friendly movie from June 16 to August 20.',
  'Learn more',
  'Engage The Community',
  'The annual Summer Family Matinee Series provides an avenue for local businesses and organizations to partner in a shared mission to build community that is accessible to all.',
  '[
    {"title":"Recognition","description":"KPAC acknowledges sponsors on the marquee and in all print/digital media."},
    {"title":"Tabling Opportunity","description":"Meet the community and engage folks upon arrival (optional)."},
    {"title":"Marketing & Outreach","description":"Gather photos with your team; share the story of your service to the community."}
  ]'::jsonb,
  'In 2025, we hosted 30 free matinees with support from 27 sponsors – the average attendance was 170 people each day.',
  'Sponsorships start at $400 per film per day.',
  'Sponsors choose the films that correspond with specific dates, every Tuesday, Wednesday, and Thursday at 1 PM from June 16th – August 20th. Full lineup of 2026 films available now.',
  'Colin Mannex',
  'Executive Director',
  'executive@kenworthy.org',
  '208.892.9752',
  1
);