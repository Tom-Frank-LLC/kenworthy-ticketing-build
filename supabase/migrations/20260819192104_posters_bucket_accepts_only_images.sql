-- The posters bucket accepts anything, and serves it publicly.
--
-- `posters` was created public (20260402052026) with admin-only writes, which
-- is right for posters. What it was never given is a statement of what a poster
-- *is*: the bucket carries no allowed_mime_types and no file_size_limit, so the
-- only thing standing between an upload and the public internet is this, in
-- PosterUpload.tsx:
--
--     if (!file.type.startsWith('image/')) { toast.error(...); return; }
--
-- That is a form validation, not a control. It runs in the browser, it can be
-- skipped by calling `storage.from('posters').upload()` directly from the
-- console, and `file.type` is whatever the client says it is regardless.
--
-- The specific thing worth refusing is SVG. An SVG is a document that can carry
-- <script>, and this bucket is public, so an uploaded one is a page an attacker
-- controls, served from the Supabase storage origin under the theatre's own
-- project. It does not reach the app's own origin — tokens live in localStorage
-- on the Worker domain, not on storage — but a plausible-looking kenworthy
-- asset URL that runs the uploader's JavaScript is a phishing primitive, and
-- there is no reason a poster needs to be one.
--
-- This does mean the control now lives where an admin session cannot skip it,
-- which is the point: the storage API refuses the upload rather than the form
-- declining to offer it. Reaching this at all requires the admin role, so the
-- threat is a compromised or careless admin session rather than the public —
-- but "the attacker already has admin" is exactly when the layer underneath
-- matters.
--
-- The size limit is the same argument applied to cost: posters run to a
-- megabyte or so today, and 10MB is generous for one while still bounding what
-- a single call can push into a public bucket.
--
-- Raster formats only, plus the two the app actually produces or accepts:
--   jpeg/png/webp/gif  what a poster or press photo arrives as
--   avif               increasingly what a modern export produces
-- SVG is deliberately absent. If a vector asset is ever genuinely needed, add
-- it to a *private* bucket and serve it through a signed URL, or rasterise it.

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
         'image/jpeg',
         'image/png',
         'image/webp',
         'image/gif',
         'image/avif'
       ],
       file_size_limit = 10485760  -- 10 MiB
 WHERE id = 'posters';

-- The menus bucket is private and admin-write, so a script inside an upload has
-- no public URL to be served from. It is still worth saying what belongs in it,
-- because "private" has been assumed before and been wrong.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['application/pdf'],
       file_size_limit = 26214400  -- 25 MiB
 WHERE id = 'concession-menus';
