ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signer_title text;

ALTER TABLE public.rental_requests
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signed_by_name text,
  ADD COLUMN IF NOT EXISTS signed_by_title text,
  ADD COLUMN IF NOT EXISTS signed_pdf_sha256 text,
  ADD COLUMN IF NOT EXISTS signature_serial text;