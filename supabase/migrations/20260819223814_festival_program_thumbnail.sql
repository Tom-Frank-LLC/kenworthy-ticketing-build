-- A cover for the things that cannot be their own thumbnail.
--
-- The archive lists a program and shows a preview of it. An image program is
-- both: the file is the thumbnail (scaled down by the transform endpoint) and
-- the preview. A PDF is neither — there is no way to draw page one of a PDF in
-- a grid tile, so it rendered as a grey card with a document glyph, which is
-- exactly as informative as a filename.
--
-- So a PDF row may carry a pointer to an image of its own first page. Nullable
-- rather than required, because it is derived: the import script renders it
-- with pdftoppm, and a PDF uploaded by hand may simply not have one yet. A row
-- without it still works — it just falls back to the glyph — so this can never
-- be the reason a program fails to appear.
--
-- Deliberately not a general "attachments" table. One optional cover per row is
-- the whole requirement, and a join table would buy flexibility nobody asked
-- for at the cost of a query on every tile.

ALTER TABLE public.festival_programs
  ADD COLUMN IF NOT EXISTS thumbnail_path text;

COMMENT ON COLUMN public.festival_programs.thumbnail_path IS
  'Storage path of a cover image for this row, used as its tile in the archive. Only meaningful for file_type = pdf, which cannot be its own thumbnail; an image row is scaled from file_path instead. NULL means the tile falls back to a document glyph, so this is an improvement to a working row rather than a requirement of one.';
