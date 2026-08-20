-- What we know about a festival year, as opposed to about one of its files.
--
-- The archive has had years since it was built, but never a row for one: a year
-- was whatever `festival_programs` rows happened to share a `year` value, which
-- is enough to group scans and nothing else. A trailer is the first fact that
-- belongs to the year itself rather than to any page of its programme, and
-- there was nowhere to put it.
--
-- Hanging it off a program row was the alternative and it is wrong in a way
-- that shows up later: eight rows for 2023 means eight places a trailer could
-- live, seven of which are empty, and no answer to which one the page should
-- believe. So the year gets a row.
--
-- Deliberately thin. It holds what a year has that its files do not, which today
-- is one URL. Dates and a per-year blurb are the obvious next tenants — the
-- festival page still carries its copy as constants in the component — and this
-- is where they should go when someone wants them editable.

CREATE TABLE IF NOT EXISTS public.festival_years (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_slug text NOT NULL DEFAULT 'silent-film-festival',
  year          int  NOT NULL,
  trailer_url   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- One row per year per festival. Two rows would reintroduce exactly the
  -- ambiguity this table exists to remove.
  CONSTRAINT festival_years_unique_year UNIQUE (festival_slug, year)
);

COMMENT ON TABLE public.festival_years IS
  'One row per festival year, holding what belongs to the year rather than to any one of its programme files. Created when a trailer needed somewhere to live that was not arbitrarily one of eight scanned pages.';

COMMENT ON COLUMN public.festival_years.trailer_url IS
  'Whatever an admin pasted — a YouTube watch or share link, a Vimeo link, or a direct file. It is parsed at render time by src/lib/trailer.ts, the same resolver behind the home page marquee, so the admin does not have to know what an embed URL looks like.';

CREATE INDEX IF NOT EXISTS festival_years_slug_year_idx
  ON public.festival_years (festival_slug, year DESC);

GRANT SELECT ON public.festival_years TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.festival_years TO authenticated;
GRANT ALL ON public.festival_years TO service_role;

ALTER TABLE public.festival_years ENABLE ROW LEVEL SECURITY;

-- Public read. A trailer is promotional; there is nothing here to protect, and
-- the archive is a public page. Unlike festival_programs there is no published
-- flag, because a row with no trailer_url renders nothing anyway — the absence
-- of a value is already the "not ready" state.
CREATE POLICY "Festival years are public"
  ON public.festival_years FOR SELECT
  USING (true);

CREATE POLICY "Admins can add a festival year"
  ON public.festival_years FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can change a festival year"
  ON public.festival_years FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can remove a festival year"
  ON public.festival_years FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_festival_years_updated_at
BEFORE UPDATE ON public.festival_years
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
