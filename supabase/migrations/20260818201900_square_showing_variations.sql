-- Where a showing's Square catalog identity is remembered.
--
-- Context: docs/SQUARE-TRANSACTION-CONVENTIONS.md. 99.7% of the theatre's line
-- items carry a catalog_object_id; ours carry none, because no showing has ever
-- had a Square variation to point at. This is the storage that makes a
-- catalog-linked line item possible. It stores mappings only — nothing here
-- writes to Square.
--
-- Two things are recorded, at two different grains:
--
--   1. Production -> Square ITEM. A film/event/performance is ONE Square item
--      (product_type EVENT). Held on the production row.
--   2. (showing, tier) -> Square ITEM_VARIATION. Square's convention is one
--      variation per tier per showtime — "Adult - January 14 at 9:55 AM" — so a
--      showing with Adult/Student/Child needs THREE variations, not one. That is
--      why this is a table and not a column on `showings`.
--
-- Why the key is (showing_id, tier_name) and not showing_price_tiers.id:
-- both writers of showing_price_tiers DELETE every tier for a showing and
-- reinsert them on each save (src/pages/admin/ShowingForm.tsx, and
-- src/components/admin/SeatTierEditor.tsx). Tier ids therefore do not survive an
-- edit. Keying on the id would orphan the Square variation on every save and
-- create a duplicate on the next sale. The tier NAME is what the buyer sees, what
-- Square's variation is named after, and what actually persists.

-- 1 -------------------------------------------------------------------------
-- The production -> Square item link. Nullable everywhere: nothing is linked
-- yet, and an unlinked production degrades to an ad-hoc line rather than failing
-- a sale.

ALTER TABLE public.movies            ADD COLUMN IF NOT EXISTS square_item_id text;
ALTER TABLE public.events            ADD COLUMN IF NOT EXISTS square_item_id text;
ALTER TABLE public.live_performances ADD COLUMN IF NOT EXISTS square_item_id text;

COMMENT ON COLUMN public.movies.square_item_id IS
  'Square catalog ITEM id (product_type EVENT) this film sells under. Null until linked.';
COMMENT ON COLUMN public.events.square_item_id IS
  'Square catalog ITEM id (product_type EVENT) this event sells under. Null until linked.';
COMMENT ON COLUMN public.live_performances.square_item_id IS
  'Square catalog ITEM id (product_type EVENT) this performance sells under. Null until linked.';

-- 2 -------------------------------------------------------------------------
-- (showing, tier) -> variation.

CREATE TABLE IF NOT EXISTS public.showing_square_variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  showing_id uuid NOT NULL REFERENCES public.showings(id) ON DELETE CASCADE,

  -- '' means "this showing has no tiers, it has one price" — the bare
  -- "<Weekday, Month D at TIME>" grammar. NOT NULL with an empty-string sentinel
  -- rather than NULL, because a UNIQUE constraint does not dedupe NULLs and we
  -- would silently accumulate one untiered row per sync.
  tier_name text NOT NULL DEFAULT '',

  square_item_id text NOT NULL,
  square_variation_id text NOT NULL,

  -- What we believe Square holds, so a plan run can spot drift without a second
  -- catalog read per showing.
  variation_name text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),

  -- Only ever set after a write was read BACK from Square and confirmed.
  -- A 2xx does not set this. See docs/INCIDENT-2026-08-14-square-catalog.md.
  verified_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT showing_square_variations_showing_tier_key UNIQUE (showing_id, tier_name),
  CONSTRAINT showing_square_variations_variation_key UNIQUE (square_variation_id)
);

COMMENT ON TABLE public.showing_square_variations IS
  'Maps (showing, price tier) to the Square ITEM_VARIATION a checkout line item '
  'should reference. Keyed on tier NAME because showing_price_tiers rows are '
  'deleted and reinserted on every showing edit.';

CREATE INDEX IF NOT EXISTS showing_square_variations_showing_idx
  ON public.showing_square_variations (showing_id);
CREATE INDEX IF NOT EXISTS showing_square_variations_item_idx
  ON public.showing_square_variations (square_item_id);

-- 3 -------------------------------------------------------------------------
-- RLS. This is catalog plumbing, not customer data: no anon access at all, admin
-- may read it to review a plan, and only the service role writes it.
--
-- Both the POLICY and the GRANT are set. A policy without a grant is dead — see
-- the RLS hardening migration 20260814214233.

ALTER TABLE public.showing_square_variations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read showing variations" ON public.showing_square_variations;
CREATE POLICY "Admins read showing variations"
  ON public.showing_square_variations FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON public.showing_square_variations FROM anon, authenticated;
GRANT SELECT ON public.showing_square_variations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.showing_square_variations TO service_role;

-- updated_at, matching the trigger every other table here uses.
DROP TRIGGER IF EXISTS set_showing_square_variations_updated_at
  ON public.showing_square_variations;
CREATE TRIGGER set_showing_square_variations_updated_at
  BEFORE UPDATE ON public.showing_square_variations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
