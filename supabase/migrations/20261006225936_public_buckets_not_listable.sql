-- The public media buckets serve files by URL; they no longer list them.
-- BRIEF-sec-rls-regressions (audit 2026-10-06 L18).
--
-- Each of the six public buckets carried a SELECT policy on storage.objects
-- with no role and no condition beyond the bucket id. A public bucket does
-- not need one to serve its files: /object/public/… and /render/image/public/…
-- (getPublicUrl, with or without a transform) are answered without consulting
-- RLS. What the policy added was POST /storage/v1/object/list for anyone — an
-- index of every upload, including the ones whose row is not published yet.
-- BRIEF-media-bucket-privacy-model's model is "unlisted, not private": an
-- unpublished upload is reachable only by its timestamped path. A public
-- listing undid exactly that.
--
-- Every read in the site is getPublicUrl (posters, pass images, festival
-- programmes, Backstage, featured slides, concession menus); nothing calls
-- list(), download() or createSignedUrl() on these buckets. The admin screens
-- do call remove(), and Storage's remove needs SELECT as well as DELETE on the
-- object, so admins keep a read policy. Uploads are upsert: false (INSERT only).
--
-- If a page ever needs to list one of these buckets as anon, give that one
-- bucket its policy back, scoped to the rows it should show.

DROP POLICY IF EXISTS "Poster images are publicly accessible"       ON storage.objects;
DROP POLICY IF EXISTS "Pass images are publicly readable"           ON storage.objects;
DROP POLICY IF EXISTS "Festival programs are publicly readable"     ON storage.objects;
DROP POLICY IF EXISTS "Backstage photos are publicly readable"      ON storage.objects;
DROP POLICY IF EXISTS "Concession menus are publicly readable"      ON storage.objects;
DROP POLICY IF EXISTS "Featured slide images are publicly readable" ON storage.objects;

DROP POLICY IF EXISTS "Admins can read public media objects" ON storage.objects;
CREATE POLICY "Admins can read public media objects"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id IN ('posters', 'pass-images', 'festival-programs',
                'backstage-photos', 'concession-menus', 'featured-slides')
  AND public.has_role(auth.uid(), 'admin'::app_role)
);
