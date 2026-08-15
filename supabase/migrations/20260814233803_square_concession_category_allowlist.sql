-- Which Square categories a catalog pull may treat as concessions.
--
-- Context (2026-08-14 incident): square-catalog-sync used to import every ITEM in
-- the Square catalog. The Kenworthy's catalog is their entire sales history, so a
-- single "Pull from Square" wrote 998 rows — past films, MET broadcasts, rentals,
-- posters, passes — into concession_items, all active, onto the live home page.
--
-- The catalog is organised by a numeric prefix: 1-5 and 7 are sold at the stand,
-- `6 *` is ticketing, `9 *` is passes, and `General` is a junk drawer of posters
-- and legacy ticket types. Only the stand belongs here.
--
-- Stored as config rather than code so the menu's shape can change without a
-- deploy; square-catalog-sync falls back to this same list if the row is missing.

INSERT INTO app_config (key, value)
VALUES (
  'square_concession_categories',
  '{"categories": ["1 Combos","2 Candy","3 Bottles","3 Soda","4 Beer","4 Wine","5 Popcorn","7 Merch"]}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
