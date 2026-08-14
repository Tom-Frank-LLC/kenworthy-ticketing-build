-- Make the Press page real, and admin-managed.
--
-- /press was a ComingSoon stub, but it is linked from the header and the
-- mobile menu — so it is a page visitors already reach, and it has been
-- telling them nothing since launch.
--
-- Two tables, deliberately separate:
--
--   press_articles       one row per piece of coverage
--   press_page_content   the page's own photo and intro paragraph
--
-- They are separate because the intro copy and the banner photo are
-- properties of the *page*, not of any article. Folding them into a row of
-- press_articles would mean the page's own text disappears the day someone
-- deletes the article it happened to be attached to.
--
-- IMPORTANT — what press_articles is NOT:
--
-- These are third-party, copyrighted articles. This table stores *link
-- metadata* only: a headline, the outlet, a date, an optional short blurb the
-- staff write themselves, and a thumbnail. It does not store, and the page
-- does not display, the body of anyone else's article. Every card on /press
-- is a link that sends the reader to the outlet. Do not add a `body` column.

CREATE TABLE IF NOT EXISTS public.press_articles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text NOT NULL,
  outlet         text NOT NULL,
  url            text NOT NULL,
  published_date date,
  excerpt        text,
  image_url      text,
  is_featured    boolean NOT NULL DEFAULT false,
  feature_order  int NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.press_articles IS
  'Link metadata for third-party press coverage shown on /press. Preview only — never the article body. Each row links out to the outlet.';

COMMENT ON COLUMN public.press_articles.excerpt IS
  'A short blurb written by staff — a one-line summary or a brief quote. Not a reproduction of the article.';

COMMENT ON COLUMN public.press_articles.published_date IS
  'Nullable: some web coverage carries no date, and inventing one would print a false fact on the public card. Undated rows sort last and render without a date.';

COMMENT ON COLUMN public.press_articles.is_featured IS
  'Pinned to the top of /press. The admin tab allows at most two, and the page itself renders at most two — a third featured row set directly in SQL falls back into the chronological list rather than breaking the layout or vanishing.';

COMMENT ON COLUMN public.press_articles.is_active IS
  'Unpublish without deleting. An inactive article is invisible to anon but still readable by staff.';

-- The public list: newest first, undated last, created_at breaking ties so two
-- pieces published the same day keep a stable order.
CREATE INDEX IF NOT EXISTS press_articles_active_published_idx
  ON public.press_articles (published_date DESC NULLS LAST, created_at DESC)
  WHERE is_active;

GRANT SELECT ON public.press_articles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.press_articles TO authenticated;
GRANT ALL ON public.press_articles TO service_role;

ALTER TABLE public.press_articles ENABLE ROW LEVEL SECURITY;

-- Mirrors job_postings and sponsorship_opportunities: the public sees active
-- rows, staff see everything so the admin tab can list drafts alongside them.
--
-- Writes are staff-level even though the Press tab is currently shown to
-- admins only. That is intentional: opening the tab to a marketing staffer
-- later should be a one-line UI change, not a migration.
CREATE POLICY "Active press articles viewable by everyone"
  ON public.press_articles FOR SELECT
  USING (is_active = true OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins and staff can insert press articles"
  ON public.press_articles FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins and staff can update press articles"
  ON public.press_articles FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins can delete press articles"
  ON public.press_articles FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_press_articles_updated_at
  BEFORE UPDATE ON public.press_articles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- press_page_content — the page's own photo and intro paragraph
-- ---------------------------------------------------------------------------
--
-- One row, forever. `id boolean PRIMARY KEY CHECK (id)` admits exactly one
-- value, so a second row is a primary-key violation rather than a silent
-- duplicate that leaves the page picking one at random. The row is seeded
-- here, and there is no INSERT or DELETE policy: the admin tab only ever
-- UPDATEs it, and .maybeSingle() on the public side always finds it.
CREATE TABLE IF NOT EXISTS public.press_page_content (
  id         boolean PRIMARY KEY DEFAULT true,
  photo_url  text,
  intro_text text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT press_page_content_singleton CHECK (id)
);

COMMENT ON TABLE public.press_page_content IS
  'Single row. The banner photo and intro paragraph at the top of /press, both optional — the page renders without either.';

INSERT INTO public.press_page_content (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.press_page_content TO anon;
GRANT SELECT, UPDATE ON public.press_page_content TO authenticated;
GRANT ALL ON public.press_page_content TO service_role;

ALTER TABLE public.press_page_content ENABLE ROW LEVEL SECURITY;

-- Nothing here is a secret — it is the copy at the top of a public page — so
-- the read policy is unconditional rather than keyed to is_active.
CREATE POLICY "Press page content viewable by everyone"
  ON public.press_page_content FOR SELECT
  USING (true);

-- Editing the page's own voice is an admin call, unlike adding a link to
-- coverage. If that turns out to be too tight in practice, widen it to
-- 'staff' to match press_articles.
CREATE POLICY "Admins can update press page content"
  ON public.press_page_content FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_press_page_content_updated_at
  BEFORE UPDATE ON public.press_page_content
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
