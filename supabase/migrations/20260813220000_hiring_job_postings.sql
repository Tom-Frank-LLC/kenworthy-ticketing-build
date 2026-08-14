-- Make the Hiring page admin-managed.
--
-- /hiring was static JSX: a hard-coded "no paid openings right now" line that
-- only a deploy could change. The Kenworthy hires seasonally, so the page was
-- guaranteed to be wrong for weeks at a time with nobody able to fix it.
--
-- Two moving parts, deliberately separate:
--
--   job_postings          the openings themselves, one row each
--   app_config.hiring_enabled   whether the page is public at all
--
-- They are separate because "we have no openings listed" and "we are not
-- recruiting" are different statements, and the second one is the one that
-- decides whether a visitor should see the page. Deleting every posting to
-- take the page down would also destroy the postings you want back in March.

CREATE TABLE IF NOT EXISTS public.job_postings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.job_postings IS
  'Openings shown on /hiring. Visibility of the page as a whole is app_config.hiring_enabled, not the emptiness of this table.';

COMMENT ON COLUMN public.job_postings.is_active IS
  'Unpublish without deleting. An inactive posting is invisible to anon but still readable by staff, so last season''s listing can be brought back rather than retyped.';

-- Ordering is curator-controlled, and ties fall back to newest-first so a
-- freshly added posting with the default sort_order = 0 lands at the top of
-- its group rather than in an arbitrary spot.
CREATE INDEX IF NOT EXISTS job_postings_active_order_idx
  ON public.job_postings (sort_order, created_at DESC)
  WHERE is_active;

GRANT SELECT ON public.job_postings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_postings TO authenticated;
GRANT ALL ON public.job_postings TO service_role;

ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;

-- Mirrors sponsorship_opportunities: the public sees active rows, staff see
-- everything so the admin tab can list drafts alongside them.
CREATE POLICY "Active job postings viewable by everyone"
  ON public.job_postings FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins and staff can insert job postings"
  ON public.job_postings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins and staff can update job postings"
  ON public.job_postings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins can delete job postings"
  ON public.job_postings FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_job_postings_updated_at
  BEFORE UPDATE ON public.job_postings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- app_config.hiring_enabled
-- ---------------------------------------------------------------------------
--
-- app_config is admin-read-only by default ("Admins can view app_config",
-- TO authenticated). That is correct for webhook secrets and Mailchimp store
-- ids, and fatal for this key: the flag has to be legible to a logged-out
-- visitor or the page can never decide whether to render for them. A blanket
-- public-read policy would leak the secrets, so the exemption is keyed by
-- name. Every other key stays admin-only.
GRANT SELECT ON public.app_config TO anon;

DROP POLICY IF EXISTS "Public can read the hiring flag" ON public.app_config;
CREATE POLICY "Public can read the hiring flag"
  ON public.app_config FOR SELECT
  TO anon, authenticated
  USING (key = 'hiring_enabled');

-- Writes are superadmin-only for the rest of the table. The hiring toggle is
-- day-to-day editorial control, not a credential, so admins get it — scoped to
-- this one key by the same name test.
DROP POLICY IF EXISTS "Admins can insert the hiring flag" ON public.app_config;
CREATE POLICY "Admins can insert the hiring flag"
  ON public.app_config FOR INSERT
  TO authenticated
  WITH CHECK (key = 'hiring_enabled' AND public.has_role(auth.uid(), 'admin'));

-- Both INSERT and UPDATE, because the admin tab writes this with upsert and
-- PostgREST resolves that to INSERT ... ON CONFLICT DO UPDATE — a missing
-- INSERT policy fails the call even when the row already exists.
DROP POLICY IF EXISTS "Admins can update the hiring flag" ON public.app_config;
CREATE POLICY "Admins can update the hiring flag"
  ON public.app_config FOR UPDATE
  TO authenticated
  USING (key = 'hiring_enabled' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (key = 'hiring_enabled' AND public.has_role(auth.uid(), 'admin'));

-- Seeded ON, so this migration does not change what the public sees. /hiring
-- is currently live and linked from the header, the mobile menu, and the
-- Volunteer page; shipping a schema change that silently takes a linked page
-- down is not a schema change, it is a content decision, and it belongs to
-- whoever flips the switch in the admin tab.
INSERT INTO public.app_config (key, value)
VALUES ('hiring_enabled', '{"enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;
