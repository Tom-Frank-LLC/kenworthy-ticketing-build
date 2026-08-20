-- The same gap, twice more, one day later.
--
-- 20260819192104 constrained `posters` and `concession-menus` after the audit
-- found them accepting any file type into a public bucket, guarded only by a
-- client-side check anyone can skip. Two public buckets have been created since
-- that migration was written, both without `allowed_mime_types` and without
-- `file_size_limit`:
--
--   pass-images        20260820094512
--   festival-programs  20260819151204
--
-- Neither author did anything wrong. `INSERT INTO storage.buckets (id, name,
-- public)` is the shape every previous bucket used, and the columns that were
-- missing are the ones nobody knows to add. That is precisely why the finding
-- recurred inside a day: it was fixed in two instances rather than in the
-- pattern.
--
-- Both have a client-side type check — `accept="image/png,image/jpeg,
-- image/webp"` on the pass image input, and an `ACCEPTED` array on the festival
-- programme upload. Both run in the browser and neither survives a direct call
-- to `storage.from(...).upload()`, which any admin session can make from the
-- console. `file.type` is whatever the client claims regardless.
--
-- The thing worth refusing is still SVG: a document that can carry <script>, in
-- a public bucket, served from the theatre's own Supabase project under a URL
-- that looks like ours.
--
-- Written as a loop over a list rather than four UPDATEs, so that adding the
-- next bucket to the allowlist is a one-line edit in an obvious place — and so
-- this file reads as the rule for public buckets rather than as a patch to two
-- of them.

DO $$
DECLARE
  b record;
BEGIN
  FOR b IN
    SELECT * FROM (VALUES
      -- bucket              mime types                       max bytes
      ('posters',            ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif'],           10485760),
      ('pass-images',        ARRAY['image/jpeg','image/png','image/webp','image/avif'],                       10485760),
      -- Programme scans are pages: PDFs of a whole booklet, or per-page images.
      -- Matches ACCEPTED in FestivalProgramsTab.tsx, and a scanned booklet is
      -- legitimately large, so the cap is higher than an image bucket's.
      ('festival-programs',  ARRAY['application/pdf','image/jpeg','image/png','image/webp'],                  52428800),
      ('concession-menus',   ARRAY['application/pdf'],                                                        26214400)
    ) AS t(id, mimes, max_bytes)
  LOOP
    UPDATE storage.buckets
       SET allowed_mime_types = b.mimes,
           file_size_limit    = b.max_bytes
     WHERE storage.buckets.id = b.id;
  END LOOP;
END $$;

-- A standing note for whoever adds the next one. Bucket comments are not a
-- constraint, but this is the row a person is looking at when they create a
-- sibling bucket by copying the statement above it.
COMMENT ON TABLE storage.buckets IS
  'Storage buckets. A PUBLIC bucket must also set allowed_mime_types and file_size_limit — a client-side accept="" attribute is a form validation, not a control, and an unconstrained public bucket will take an SVG carrying <script> and serve it from our own origin. See 20260820164402 for the current list; add new public buckets to it.';
