-- The poster-restore tooling comes down.
--
-- Three tables existed in production with no migration behind them and were
-- absent from staging: the working tables of the August 2026 catalog repair
-- (docs/INCIDENT-2026-08-14-square-catalog.md). They were written by the
-- poster-restore edge function, run by hand from a terminal, and read by
-- nothing else:
--
--   poster_restore_plan      355 rows   the repair's worksheet, one per damaged item
--   poster_source_wordpress  1,518 rows a copy of kenworthy.org's public calendar
--   square_orphan_images     1,039 rows an index of Square's orphaned images
--
-- The incident is closed: 79 orphans re-attached, the remaining 156 accepted as
-- collateral damage and relinked by hand if a listing ever needs its art (Tom,
-- 15 Aug 2026). Everything in these tables was derived from Square or the
-- theatre's website and can be derived again. Decided by Tom, 22 Sep 2026;
-- the function is deleted from production and its source removed in the same
-- change.
--
-- IF EXISTS on every line: staging never had them.

DROP TABLE IF EXISTS public.poster_restore_plan;
DROP TABLE IF EXISTS public.poster_source_wordpress;
DROP TABLE IF EXISTS public.square_orphan_images;
