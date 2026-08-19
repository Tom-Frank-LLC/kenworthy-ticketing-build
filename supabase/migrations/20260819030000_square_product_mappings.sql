-- Catalog mappings for the two things sold outside the showings path.
--
-- Same purpose as showing_square_variations: give checkout a catalog_object_id
-- to send, so the sale lands in Square's item-sales and category reporting
-- instead of being an amount with a note (docs/SQUARE-TRANSACTION-CONVENTIONS.md).
--
-- Both are nullable and unset. A product with no mapping still sells — it bills
-- as a named ad-hoc line, which loses the rollup but never fails a sale.

-- 1 -------------------------------------------------------------------------
-- Film passes. One REGULAR item per pass type, filed under '9 Film Passes'.
-- No per-showtime dimension, so unlike a showing this is a plain one-to-one map
-- and needs no side table.

ALTER TABLE public.film_pass_types
  ADD COLUMN IF NOT EXISTS square_item_id text,
  ADD COLUMN IF NOT EXISTS square_variation_id text;

COMMENT ON COLUMN public.film_pass_types.square_variation_id IS
  'Square ITEM_VARIATION this pass type sells against. Null until mapped; '
  'checkout falls back to a named ad-hoc line.';

-- 2 -------------------------------------------------------------------------
-- Donations. There is ONE DONATION product-type item in the catalog, carrying
-- $10 / $20 / $50 / $100 and a VARIABLE_PRICING "Custom Amount" variation, all
-- is_taxable false.
--
-- Config rather than a table: it is a single row that changes when somebody
-- edits the catalog, not per-record data. Shape:
--
--   { "item_id": "…",
--     "by_amount_cents": { "1000": "VAR…", "2000": "VAR…" },
--     "custom": "VAR…" }
--
-- Seeded empty on purpose — populating it means reading the live catalog, which
-- is a deliberate admin action, not a migration's job.

INSERT INTO app_config (key, value)
VALUES ('square_donation_variations', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;
