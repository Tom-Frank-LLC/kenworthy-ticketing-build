-- A showing can be cancelled, and a cancelled showing is listed nowhere.
-- docs/briefs/BRIEF-showing-cancellation.md
--
-- Why a column and not the flag
-- -----------------------------
-- `is_active = false` already means two things: the August 2026 archive
-- import (1,749 past showings that really played, written inactive) and
-- "hidden". The /calendar history has to ignore the flag to show the archive
-- (src/hooks/useCalendarHistory.ts), so a showing cancelled by hiding it would
-- reappear there, marked "Ended", once its date passed. Deleting is not an
-- answer either: a showing with sales cannot be deleted
-- (20261006225933_showing_delete_keeps_sales.sql). Nothing on production has
-- been set inactive since the import (measured 2026-10-10), so there is
-- nothing to backfill.
--
-- Cancelled implies inactive
-- --------------------------
-- The CHECK below makes "cancelled but still listed or on sale" impossible to
-- write, instead of a rule every surface has to remember. Everything that
-- filters `is_active = true` (the feed, the counter, the sitemap, Square
-- variation sync) hides a cancelled showing unchanged, and
-- price_ticket_order already refuses an inactive showing (PT409). Only the
-- calendar history, which deliberately ignores the flag, asks about
-- cancelled_at itself.
--
-- Readable by direct link
-- -----------------------
-- A patron holding a ticket has a link to the showing in their email. Without
-- the extra clause an upcoming cancelled showing is unreadable to them, and
-- the page says "not found". With it, the page loads and says the showing was
-- cancelled. It is listed nowhere: every listing filters `is_active = true`.

ALTER TABLE public.showings ADD COLUMN cancelled_at timestamptz;

COMMENT ON COLUMN public.showings.cancelled_at IS
  'When staff cancelled this showing; null if not cancelled. Cancelled implies is_active = false (showings_cancelled_is_inactive).';

ALTER TABLE public.showings
  ADD CONSTRAINT showings_cancelled_is_inactive
  CHECK (cancelled_at IS NULL OR is_active = false);

DROP POLICY IF EXISTS "Anyone can view active showings" ON public.showings;
CREATE POLICY "Anyone can view active showings"
  ON public.showings FOR SELECT
  USING (
    is_active = true
    OR start_time < now()
    OR cancelled_at IS NOT NULL
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'staff'::app_role)
  );
