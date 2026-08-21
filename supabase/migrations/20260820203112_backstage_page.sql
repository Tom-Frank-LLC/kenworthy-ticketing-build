-- Backstage: the room behind the room, and the page that shows it off.
--
-- Backstage is the Kenworthy's after-hours speakeasy and its second rentable
-- space — `rental_requests.venue_area` has carried 'backstage_speakeasy' as an
-- option for a while, but there has never been anywhere to send someone who
-- asked what the room looks like. That is what this table pair is for: photos
-- of events that have happened in it, and one paragraph saying how it gets
-- used.
--
-- Three shape decisions, all borrowed from festival_programs rather than
-- invented, because this is the same problem one more time:
--
--   The bucket is PUBLIC. The photos exist to be looked at by anyone who finds
--   the page, so getPublicUrl beats minting a signed URL per thumbnail — a
--   signed URL would expire behind a reader who left the tab open, and it
--   would protect nothing.
--
--   Publication is still a row-level flag. A public bucket is not a public
--   row. Uploads land with is_published = false so a photo is never live the
--   instant it finishes uploading, and the object path carries a timestamp
--   prefix so "unpublished" means unlisted rather than guessable.
--
--   The bucket declares allowed_mime_types and file_size_limit AT CREATION.
--   20260820164402 had to go back and constrain two public buckets that were
--   created without them, and said in as many words that the fix belonged in
--   the pattern rather than in the instances. This is the pattern being
--   followed: an unconstrained public bucket will accept an SVG carrying
--   <script> and serve it from our own origin, and the `accept=""` attribute
--   on the admin file input is a form validation, not a control.
--
-- The page itself is UNLISTED, not access-controlled. It is reached by
-- clicking the neon Backstage sign at the bottom of the home page, or by
-- typing the URL. Nothing here assumes otherwise — anyone who has the address
-- can read every published row, exactly as intended.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES (
  'backstage-photos',
  'backstage-photos',
  true,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
  10485760
)
ON CONFLICT (id) DO NOTHING;

-- Stated even though the bucket flag already makes it true, so that an
-- object's reachability is legible here rather than only in a boolean column
-- nobody reads.
CREATE POLICY "Backstage photos are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'backstage-photos');

CREATE POLICY "Admins can upload backstage photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'backstage-photos' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update backstage photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'backstage-photos' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete backstage photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'backstage-photos' AND has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- backstage_photos — the gallery
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.backstage_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caption       text,
  file_path     text NOT NULL,
  display_order int  NOT NULL DEFAULT 0,
  is_published  boolean NOT NULL DEFAULT false,
  uploaded_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.backstage_photos IS
  'Photographs of past events in the Backstage speakeasy, shown on the unlisted /backstage page. One row per image.';

COMMENT ON COLUMN public.backstage_photos.caption IS
  'What the photograph is of. Doubles as the image alt text on the public page, which is why an empty caption falls back to generic wording there rather than to an empty alt="".';

COMMENT ON COLUMN public.backstage_photos.display_order IS
  'Admin-chosen order within the grid, ascending. Ties fall back to created_at DESC so two photos left at the default 0 do not reshuffle between renders.';

COMMENT ON COLUMN public.backstage_photos.is_published IS
  'Whether the public can see this row. Defaults to false — the bucket is public, so this flag is the only thing between an upload and the page.';

-- The one read the public page makes: published rows in grid order.
CREATE INDEX IF NOT EXISTS backstage_photos_published_order_idx
  ON public.backstage_photos (is_published, display_order, created_at DESC);

GRANT SELECT ON public.backstage_photos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backstage_photos TO authenticated;
GRANT ALL ON public.backstage_photos TO service_role;

ALTER TABLE public.backstage_photos ENABLE ROW LEVEL SECURITY;

-- Published rows are public; unpublished ones stay visible to the admins who
-- manage them, so the admin tab can list a draft it has just uploaded.
CREATE POLICY "Published backstage photos are public"
ON public.backstage_photos FOR SELECT
USING (is_published = true OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can add backstage photos"
ON public.backstage_photos FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can change backstage photos"
ON public.backstage_photos FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can remove backstage photos"
ON public.backstage_photos FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- backstage_page_content — how the room gets used
-- ---------------------------------------------------------------------------
--
-- One row, forever, the same shape as press_page_content: `id boolean PRIMARY
-- KEY CHECK (id)` admits exactly one value, so a second row is a primary-key
-- violation rather than a silent duplicate the page picks between at random.
-- Seeded here, and there is no INSERT or DELETE policy — the admin tab only
-- ever UPDATEs it, and .maybeSingle() on the public side always finds it.
--
-- The prose lives in the database rather than in the component because the
-- wording is Tom's, not the build's. The text seeded below is PLACEHOLDER: it
-- is written in the teaser's voice so the page looks finished on day one, and
-- it is meant to be replaced from the admin tab without a deploy.
CREATE TABLE IF NOT EXISTS public.backstage_page_content (
  id         boolean PRIMARY KEY DEFAULT true,
  body_text  text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backstage_page_content_singleton CHECK (id)
);

COMMENT ON TABLE public.backstage_page_content IS
  'Single row. The "how the space is used" paragraph on /backstage, edited from the admin Pages > Backstage tab. Optional — the page renders without it.';

COMMENT ON COLUMN public.backstage_page_content.body_text IS
  'Plain text, blank lines separating paragraphs. Rendered as paragraphs, never as HTML. Seeded with placeholder copy awaiting Tom''s final wording.';

INSERT INTO public.backstage_page_content (id, body_text)
VALUES (
  true,
  'Backstage is the room behind the room — the Kenworthy''s after-hours speakeasy, a low-lit space off the main house with its own bar, its own sound, and its own hours.

Most nights it belongs to whoever booked it. Private parties and receptions, album releases and listening nights, cast parties that run past the last credit, readings, fundraisers, and the occasional wedding that wanted somewhere with a little more shadow in it. Live music fits comfortably; so does a room of forty people talking.

It is available to rent on its own or alongside the theatre. Tell us what the night is supposed to feel like and we will tell you whether this is the room for it.'
)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.backstage_page_content TO anon;
GRANT SELECT, UPDATE ON public.backstage_page_content TO authenticated;
GRANT ALL ON public.backstage_page_content TO service_role;

ALTER TABLE public.backstage_page_content ENABLE ROW LEVEL SECURITY;

-- Nothing here is a secret — it is the copy on a page anyone with the URL can
-- read — so the read policy is unconditional.
CREATE POLICY "Backstage page content viewable by everyone"
ON public.backstage_page_content FOR SELECT
USING (true);

CREATE POLICY "Admins can update backstage page content"
ON public.backstage_page_content FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_backstage_page_content_updated_at
  BEFORE UPDATE ON public.backstage_page_content
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
