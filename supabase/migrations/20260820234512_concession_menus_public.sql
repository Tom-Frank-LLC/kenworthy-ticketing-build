-- The concession menu PDF has never been visible to a patron.
--
-- `concession-menus` was created private (20260429143125) with a single SELECT
-- policy on storage.objects: staff or admin. But ConcessionsPreview.tsx, on the
-- PUBLIC home page, renders the active menu by calling createSignedUrl() — and
-- signing requires SELECT on the object. For anyone not signed in, auth.uid()
-- is null, both has_role() calls are false, the signing request fails, and the
-- "View full printed menu (PDF)" link is never rendered.
--
-- It went unnoticed for the two reasons that usually apply together:
--
--   It fails silently. The caller destructured `{ data: signed }` and dropped
--   the error, so there was no console noise and no toast.
--
--   It works for whoever checks. Staff and admins satisfy the policy, so
--   everyone who has ever looked at this page while working on it saw the link
--   behaving exactly as designed.
--
-- Proven on staging before writing this, because the obvious test is a trap:
-- signing a made-up path returns `404 NoSuchKey` on a private bucket and a
-- public one alike — storage will not say whether an object is missing or
-- merely hidden by RLS. It took a real menu, uploaded and activated through the
-- admin UI, to show that anon can read the row *and the file_path inside it*
-- and still cannot fetch the bytes.
--
-- Two ways out. Keep the bucket private and add an anon SELECT policy joining
-- back to the owning table, or make the bucket public like the other four media
-- buckets. This takes the second: a printed menu is handed to every customer at
-- the counter, so there is nothing in it to protect, and a private bucket that
-- anyone may freely mint a signed URL from is a public bucket with extra steps
-- and one more thing to break.
--
-- The consequence, stated plainly rather than discovered later: an INACTIVE
-- menu's bytes are now reachable by direct URL, exactly as with posters,
-- festival programmes and Backstage photos. `is_active` governs listing, not
-- access. The row policy still hides an inactive menu's file_path from the
-- public, and upload paths are timestamp-prefixed, so it is unlisted rather
-- than enumerable — but it is not private, and no menu that needs to be
-- private should live here.
--
-- See docs/briefs/BRIEF-media-bucket-privacy-model.md.

UPDATE storage.buckets
   SET public             = true,
       -- Already set by 20260820164402; restated so this migration alone is
       -- enough to leave the bucket in a correct state, and so a public bucket
       -- is never created or flipped without both constraints in view.
       allowed_mime_types = ARRAY['application/pdf'],
       file_size_limit    = 26214400
 WHERE id = 'concession-menus';

-- Replaced rather than supplemented. Policies are OR'd, so leaving the
-- staff-and-admin policy alongside a public one would still work — but it would
-- read as though staff have some access the public does not, which is no longer
-- true and is the kind of stale statement that misleads the next reader.
DROP POLICY IF EXISTS "Staff and admins can view concession menus" ON storage.objects;

CREATE POLICY "Concession menus are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'concession-menus');
