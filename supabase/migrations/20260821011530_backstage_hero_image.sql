-- A photograph of the actual sign, at the top of /backstage.
--
-- The page currently opens on backstage-logo.svg — a drawn version of the
-- sign, glowing by way of four stacked drop-shadows. It is a good stand-in and
-- it was the only thing available. A photograph of the real neon, lit, in the
-- real room, is better than a drawing of it for the same reason the festival
-- page took a hero photograph: the room is the product.
--
-- Stored, not bundled. The obvious alternative is to drop a JPEG into
-- src/assets/ and import it, which is what backstage-logo.svg does. Three
-- reasons not to:
--
--   A photograph is not a logo. The logo is part of the brand and changes
--   about never; the hero is editorial and will be swapped for a better shot,
--   or a seasonal one, by someone who does not deploy.
--
--   It would ship to every visitor of every page. Vite fingerprints and
--   serves bundled assets well, but the file still lives in the repo and in
--   the build, and a full-bleed photograph is orders of magnitude larger than
--   the SVG it sits next to.
--
--   The bucket already exists and already has the right constraints —
--   backstage-photos is public-read, admin-write, images only, 10 MB. A hero
--   is one more object in it under a `hero/` prefix, governed by the policies
--   that are already there rather than by a second mechanism.
--
-- Nullable, and the page falls back to the SVG sign when it is null. That
-- matters on the day this ships, when the column exists and no one has
-- uploaded anything yet: the header has to look deliberate empty, not broken.

ALTER TABLE public.backstage_page_content
  ADD COLUMN IF NOT EXISTS hero_path text;

COMMENT ON COLUMN public.backstage_page_content.hero_path IS
  'Object path in the backstage-photos bucket for the photograph at the top of /backstage. Null falls back to the drawn backstage-logo.svg. Carries no caption: it is the sign, and the page says so in the alt text.';
