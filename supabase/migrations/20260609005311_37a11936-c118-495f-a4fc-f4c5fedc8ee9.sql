ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS distributor text,
  ADD COLUMN IF NOT EXISTS circuit text,
  ADD COLUMN IF NOT EXISTS terms_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS release_year integer,
  ADD COLUMN IF NOT EXISTS release_label text;