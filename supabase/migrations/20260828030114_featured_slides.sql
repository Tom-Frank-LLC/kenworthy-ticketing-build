-- Curator's picks that are not showings.
--
-- The curator carousel on the home page is built entirely out of the feed:
-- `is_featured` on a movie / event / live_performance, or on one showing. That
-- makes a pick something you can only make of a thing that sells a ticket, and
-- it means the Silent Film Festival — a real page, at /silent-film-festival,
-- with no showing behind it — cannot be featured at all. Neither can the
-- Backstage room, a rentals promo, or the donate page. The only way to promote
-- one today is to invent a fake showing for it, which then has to be hidden
-- from the listings, the calendar and the box office.
--
-- So: a second source of slides, with no production behind it. A row here is a
-- picture, a headline, a sentence and a link. It is not a production, it does
-- not appear in the listings, and nothing here is purchasable.
--
-- Three shape decisions, all borrowed from backstage_photos rather than
-- invented, because it is the same problem again:
--
--   The bucket is PUBLIC. These images sit on the home page; getPublicUrl
--   beats minting a signed URL that would expire behind a reader who left the
--   tab open, and it is what lets the render endpoint resize them.
--
--   The bucket declares allowed_mime_types and file_size_limit AT CREATION.
--   An unconstrained public bucket will accept an SVG carrying <script> and
--   serve it from our own origin, and the admin form's `accept=""` is a form
--   validation, not a control.
--
--   Visibility is a row-level flag, not a bucket property. A public bucket is
--   not a public row.
--
-- One decision that is NOT borrowed: the image is upload-only. There is no
-- "paste any URL" column. A stored object path is one source of truth — it is
-- what the delete cleans up, and it is what the transform endpoint resizes.
-- An arbitrary remote URL would be neither, and would put a third-party host
-- in the critical path of the home page.

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES (
  'featured-slides',
  'featured-slides',
  true,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
  10485760
)
ON CONFLICT (id) DO NOTHING;

-- Stated even though the bucket flag already makes it true, so that an
-- object's reachability is legible here rather than only in a boolean column
-- nobody reads.
CREATE POLICY "Featured slide images are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'featured-slides');

CREATE POLICY "Admins can upload featured slide images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'featured-slides' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update featured slide images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'featured-slides' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete featured slide images"
ON storage.objects FOR DELETE
USING (bucket_id = 'featured-slides' AND has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- featured_slides
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.featured_slides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  blurb         text,
  image_path    text,
  image_alt     text,
  link_url      text NOT NULL,
  cta_label     text NOT NULL DEFAULT 'Read more',
  is_active     boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- The link is the whole point of the row, and it is written by hand into a
  -- text box, so the rule about what may be in it belongs here rather than in
  -- the form that happens to be in front of it today.
  --
  -- Two shapes and no others: an absolute https:// URL, or a rooted internal
  -- path. `javascript:` and `data:` in an href are script execution on our own
  -- origin; a protocol-relative `//evil.com` reads as a path and navigates off
  -- the site, which is why the internal branch requires a non-slash character
  -- after the leading one. http:// is refused with the rest — the site is
  -- https, and a mixed-content link from the home page is a broken link with
  -- a warning attached.
  CONSTRAINT featured_slides_link_shape CHECK (
    link_url ~ '^https://[^\s]+$' OR link_url ~ '^/[^/\s][^\s]*$'
  ),

  -- A window that closes before it opens shows the slide never, silently. It
  -- is always a typo, so it is refused rather than obeyed.
  CONSTRAINT featured_slides_window CHECK (
    starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at
  )
);

COMMENT ON TABLE public.featured_slides IS
  'Manually written slides in the home page curator carousel, alongside the picks derived from showings. One row per slide. Nothing here is a production: a slide links to a page, and sells nothing.';

COMMENT ON COLUMN public.featured_slides.image_path IS
  'Object path inside the public featured-slides bucket. Nullable — a slide with no image renders as copy and a link, the same as a pick whose production has no poster.';

COMMENT ON COLUMN public.featured_slides.image_alt IS
  'What a screen reader is told about the image. Its own column rather than the title reused, because the title says what the slide is FOR and alt text has to say what the picture SHOWS. Falls back to the title when blank.';

COMMENT ON COLUMN public.featured_slides.link_url IS
  'Where the CTA goes. Either a rooted internal path (/silent-film-festival), followed in-app by the router, or an absolute https:// URL, which opens in a new tab. Enforced by featured_slides_link_shape, not only by the admin form.';

COMMENT ON COLUMN public.featured_slides.is_active IS
  'The switch an admin flips. Independent of the date window: a slide is public only if it is active AND in window.';

COMMENT ON COLUMN public.featured_slides.starts_at IS
  'Optional. Null means "already started". Together with ends_at this is what lets a festival promo retire itself the morning after, rather than depending on someone remembering.';

COMMENT ON COLUMN public.featured_slides.display_order IS
  'Ascending, and manual slides lead the carousel — so this is the order of the front of the band. Ties fall back to created_at, then id, so the sort is total.';

-- The one read the home page makes: live rows in carousel order.
CREATE INDEX IF NOT EXISTS featured_slides_live_order_idx
  ON public.featured_slides (is_active, display_order, created_at);

GRANT SELECT ON public.featured_slides TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.featured_slides TO authenticated;
GRANT ALL ON public.featured_slides TO service_role;

ALTER TABLE public.featured_slides ENABLE ROW LEVEL SECURITY;

-- Live rows are public; everything else stays visible to the admins who manage
-- it, so the admin list can show a draft and an expired slide next to a live
-- one. The window is evaluated here rather than only in the client's query,
-- which is what makes "inactive" and "not yet" mean unreadable rather than
-- merely unrequested.
CREATE POLICY "Live featured slides are public"
ON public.featured_slides FOR SELECT
USING (
  (
    is_active
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at   IS NULL OR ends_at   >  now())
  )
  OR has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Admins can add featured slides"
ON public.featured_slides FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can change featured slides"
ON public.featured_slides FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can remove featured slides"
ON public.featured_slides FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_featured_slides_updated_at
  BEFORE UPDATE ON public.featured_slides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
