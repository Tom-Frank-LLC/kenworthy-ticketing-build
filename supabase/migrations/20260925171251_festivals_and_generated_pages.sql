-- What belongs to the festival itself, and which programme pages a PDF made.
--
-- Two changes, one reason: the festival page can now be managed through a
-- season's end without a code edit.
--
-- ---------------------------------------------------------------------------
-- festivals
-- ---------------------------------------------------------------------------
--
-- festival_years holds what belongs to a year. The standing description and
-- the festival's name belonged to nothing, so they sat as constants in
-- SilentFilmFestival.tsx — and 20260820180722_festival_year_copy.sql said
-- outright that giving them a home "wants a festivals table". This is it.
--
-- Keyed by slug rather than by a uuid because the slug is already the key
-- everything else uses: the route, festival_programs.festival_slug,
-- festival_years.festival_slug, film_pass_types.festival_slug. A second id
-- would be a join for no reader.
--
-- between_seasons is the off-season switch. The page picks a year to feature
-- from the lineup, or failing that from the newest year anyone wrote about —
-- which means a finished festival stays featured until the next one is
-- written up. There was no way to say "nothing is on right now". With this
-- true the page features no year: the standing description sits at the top,
-- the finished year joins the archive with the rest, and flipping it back
-- (or tagging next year's lineup) restores the featured section with nothing
-- re-entered.
--
-- about is the standing description, as HTML from the admin rich-text editor
-- like festival_years.blurb. Seeded with the constant the page carried so the
-- page reads the same the moment this applies; the code keeps that constant
-- only as a last resort for a missing row.

CREATE TABLE IF NOT EXISTS public.festivals (
  slug             text PRIMARY KEY,
  name             text NOT NULL,
  about            text,
  between_seasons  boolean NOT NULL DEFAULT false,
  off_season_note  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.festivals IS
  'One row per festival the site has a page for, holding what belongs to the festival rather than to any one year of it: its name, its standing description, and whether it is currently between seasons.';

COMMENT ON COLUMN public.festivals.about IS
  'The standing description, shown under the title whenever the featured year has no blurb of its own — and always, while between_seasons is true. HTML from the admin editor.';

COMMENT ON COLUMN public.festivals.between_seasons IS
  'True once a festival has finished and the next has not been announced. The page then features no year: every year is in the archive and the top of the page carries about and off_season_note. Tagging the next lineup does not clear this flag — an admin does, from Pages → Festival Programs.';

COMMENT ON COLUMN public.festivals.off_season_note IS
  'One line shown in place of the lineup while between_seasons is true, e.g. "The next festival will be announced soon." NULL shows nothing in that spot.';

GRANT SELECT ON public.festivals TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.festivals TO authenticated;
GRANT ALL ON public.festivals TO service_role;

ALTER TABLE public.festivals ENABLE ROW LEVEL SECURITY;

-- Public read: everything here is page copy. Admin write, same as the
-- festival_years it sits beside.
CREATE POLICY "Festivals are public"
  ON public.festivals FOR SELECT
  USING (true);

CREATE POLICY "Admins can add a festival"
  ON public.festivals FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can change a festival"
  ON public.festivals FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can remove a festival"
  ON public.festivals FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_festivals_updated_at
BEFORE UPDATE ON public.festivals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- The one festival, with the words the page has carried since it was built.
INSERT INTO public.festivals (slug, name, about, off_season_note)
VALUES (
  'silent-film-festival',
  'Kenworthy Silent Film Festival',
  '<p>Silent cinema as it was meant to be seen — on a big screen, in a full room, '
  || 'with live music. Each night pairs a restored classic with an original score '
  || 'performed in the auditorium.</p>',
  'The next festival will be announced soon.'
)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- festival_programs.generated_from
-- ---------------------------------------------------------------------------
--
-- The admin upload now renders a PDF's pages to images in the browser and
-- inserts one image row per page, the way the import script always did with
-- pdftoppm. Those rows are derived — from the PDF row, deterministically —
-- and derived rows need to say so, or a second upload of the same year's
-- booklet appends thirty duplicate pages beside the first thirty.
--
-- So a page rendered from a PDF points at the PDF's row. Re-uploading a year's
-- booklet removes the earlier booklet and everything that points at it, and
-- nothing else: pages uploaded by hand, or by the script, carry NULL here and
-- are never touched by a replacement. ON DELETE CASCADE keeps the invariant
-- from the other side — deleting a booklet in the admin list takes its
-- rendered pages with it rather than leaving orphans that no longer match any
-- download.

ALTER TABLE public.festival_programs
  ADD COLUMN IF NOT EXISTS generated_from uuid
    REFERENCES public.festival_programs(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.festival_programs.generated_from IS
  'For an image row rendered from a PDF by the admin upload: the PDF row it was rendered from. NULL for a page uploaded by hand or by the import script. Replacing a year''s booklet deletes the old booklet and, by cascade, every page that points at it — and only those.';

CREATE INDEX IF NOT EXISTS festival_programs_generated_from_idx
  ON public.festival_programs (generated_from)
  WHERE generated_from IS NOT NULL;
