
ALTER TABLE public.concession_items
  ADD COLUMN IF NOT EXISTS square_catalog_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS square_variation_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS square_version bigint,
  ADD COLUMN IF NOT EXISTS square_synced_at timestamptz;
