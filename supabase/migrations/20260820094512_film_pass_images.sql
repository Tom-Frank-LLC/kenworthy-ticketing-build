-- A picture for a pass.
--
-- The passes are sold as a list of names and prices, which was adequate while
-- there was one of them. With a festival pass beside the standard one they are
-- two products competing for the same glance, and the thing that distinguishes
-- them — a festival's artwork against a plain card — is exactly what the page
-- does not show.
--
-- Nullable, and every surface falls back to the icon it draws today. A pass
-- with no picture is a pass that sells exactly as it does now, so this can
-- never be the reason one stops appearing.
--
-- Its own bucket rather than a corner of `posters`. Posters belong to films and
-- are written by the listings flow; pass artwork belongs to a product and is
-- written by whoever edits pass types. Sharing a bucket would mean one set of
-- storage policies governing two different jobs, and the first time those needed
-- to differ the shared bucket would be the thing in the way.

INSERT INTO storage.buckets (id, name, public)
VALUES ('pass-images', 'pass-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Pass images are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'pass-images');

CREATE POLICY "Admins can upload pass images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'pass-images' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update pass images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'pass-images' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete pass images"
ON storage.objects FOR DELETE
USING (bucket_id = 'pass-images' AND has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE public.film_pass_types
  ADD COLUMN IF NOT EXISTS image_path text;

COMMENT ON COLUMN public.film_pass_types.image_path IS
  'Storage path in the pass-images bucket for this pass''s artwork, shown beside it on /film-passes and on the festival page. NULL is the ordinary case and every surface falls back to a ticket icon, so a pass without artwork sells exactly as one with it.';
