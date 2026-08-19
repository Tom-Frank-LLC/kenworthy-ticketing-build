-- The festival program archive.
--
-- Four annual Silent Film Festivals have left behind a shelf of printed
-- programs, and the point of this table is that a patron can look at them. That
-- single sentence settles most of the design:
--
--   The bucket is PUBLIC. concession-menus, the table this otherwise mirrors,
--   is private and hands out ten-minute signed URLs, because a menu is an
--   operational document that staff preview before publishing. A festival
--   program is the opposite — it is published *at* the public, it is already
--   printed and handed out on the night, and there is nothing in it to protect.
--   Signed URLs would mean every thumbnail on the archive page needs a round
--   trip to mint one, and they would expire behind a reader who left the tab
--   open. So: getPublicUrl, like posters.
--
--   Publication is still gated. Public bucket is not the same as public row.
--   Tom uploads scans and decides when a year is ready to show, so is_published
--   defaults to false and the anon SELECT policy filters on it. An unpublished
--   row is invisible to the public even though its bytes sit in a public
--   bucket — which is the honest description of what this is, and the reason
--   the object path is not guessable (it carries a timestamp prefix).
--
--   festival_slug exists on day one for a festival that does not need it yet.
--   The Kenworthy runs more than one festival, and the cost of the column now
--   is one word in a WHERE clause, against the cost later of either a second
--   near-identical table or a migration that backfills a discriminator onto
--   rows nobody remembers the provenance of.

INSERT INTO storage.buckets (id, name, public)
VALUES ('festival-programs', 'festival-programs', true)
ON CONFLICT (id) DO NOTHING;

-- Read is open because the bucket is public; the policy is stated anyway so the
-- object's reachability is legible here rather than only in a bucket flag.
CREATE POLICY "Festival programs are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'festival-programs');

CREATE POLICY "Admins can upload festival programs"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'festival-programs' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update festival programs"
ON storage.objects FOR UPDATE
USING (bucket_id = 'festival-programs' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete festival programs"
ON storage.objects FOR DELETE
USING (bucket_id = 'festival-programs' AND has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.festival_programs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  festival_slug text NOT NULL DEFAULT 'silent-film-festival',
  year          int  NOT NULL,
  title         text,
  file_path     text NOT NULL,
  file_type     text NOT NULL CHECK (file_type IN ('pdf', 'image')),
  display_order int  NOT NULL DEFAULT 0,
  is_published  boolean NOT NULL DEFAULT false,
  uploaded_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.festival_programs IS
  'Scanned programs from past festivals, shown on the festival page so the public can read back through previous years. One row per file: a year may have several (a cover, a centrefold, a PDF of the whole booklet), ordered within the year by display_order.';

COMMENT ON COLUMN public.festival_programs.festival_slug IS
  'Which festival this program belongs to. Matches the page route (silent-film-festival) and film_pass_types.festival_slug, so a second festival is a new value here and a new page rather than a new table.';

COMMENT ON COLUMN public.festival_programs.file_type IS
  'How the archive page should render this file: an image is a thumbnail that opens full size, a pdf is a card that opens in a new tab. Derived from the upload MIME type rather than the extension, and constrained to the two the page knows how to draw.';

COMMENT ON COLUMN public.festival_programs.is_published IS
  'Whether the public can see this row. Defaults to false so a scan is never live the instant it finishes uploading — the bucket is public, so this flag is the only thing standing between an upload and the archive page.';

-- Both reads the page makes: the archive query filters slug + published and
-- orders by year then display_order.
CREATE INDEX IF NOT EXISTS festival_programs_slug_year_idx
  ON public.festival_programs (festival_slug, year DESC, display_order);

GRANT SELECT ON public.festival_programs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.festival_programs TO authenticated;
GRANT ALL ON public.festival_programs TO service_role;

ALTER TABLE public.festival_programs ENABLE ROW LEVEL SECURITY;

-- Published rows are public; unpublished ones are visible to the admins who
-- manage them, so the admin tab can list a draft it has just uploaded.
CREATE POLICY "Published festival programs are public"
ON public.festival_programs FOR SELECT
USING (is_published = true OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can add festival programs"
ON public.festival_programs FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can change festival programs"
ON public.festival_programs FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can remove festival programs"
ON public.festival_programs FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
