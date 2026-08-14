-- One-time cleanup of the messy `Format:` values carried over from the source spreadsheet.
-- Applied to production (vlmslygnimfbamrtwvyo) and staging (rpqzrpboyhshdrfdwayk) on 2026-08-13.
--
-- The same transform is baked into scripts/data/dvds_inventory_import.csv by
-- scripts/normalize-dvd-formats.mjs, so a fresh import reproduces this state. Keep them in step.
--
-- Combined formats mean the title is held on BOTH discs, so those rows are split in two.
-- "DVD X2" (double-disc set) and "SAME?" (a stray spreadsheet annotation) are not formats.
--
-- Order matters: the INSERT has to run first, while the combined values still exist to match on.

BEGIN;

-- 1. Clone each combined-format row as its BLU-RAY counterpart. The DVD side is handled by the
--    UPDATE below. Every other column carries over, including copies_total — a title held on
--    both discs is two physical items.
INSERT INTO public.dvds (
  title, year, director, genre, synopsis, cover_url,
  copies_total, copies_available, rental_price, is_active, notes
)
SELECT
  title, year, director, genre, synopsis, cover_url,
  copies_total, copies_available, rental_price, is_active,
  regexp_replace(
    regexp_replace(notes, 'Format:\s*[^|]*', 'Format: BLU-RAY'),
    '\s*\|\s*', ' | ', 'g'
  )
FROM public.dvds
WHERE trim(substring(notes from 'Format:\s*([^|]+)'))
      IN ('DVD + BLU-RAY', 'DVD / BLU-RAY', 'DVD/BLU-RAY');

-- 2. Rewrite the originals to plain DVD. The second regexp_replace restores the " | " spacing
--    that the first one eats when a Keywords/Source segment follows.
UPDATE public.dvds
SET notes = regexp_replace(
      regexp_replace(notes, 'Format:\s*[^|]*', 'Format: DVD'),
      '\s*\|\s*', ' | ', 'g'
    )
WHERE trim(substring(notes from 'Format:\s*([^|]+)'))
      IN ('DVD + BLU-RAY', 'DVD / BLU-RAY', 'DVD/BLU-RAY', 'DVD X2', 'SAME?');

COMMIT;
