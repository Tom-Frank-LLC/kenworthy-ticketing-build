
-- 1) Movies: hide distributor/circuit/terms_percent from anonymous users
REVOKE SELECT ON public.movies FROM anon;
GRANT SELECT (id, title, description, poster_url, duration_minutes, rating, genre, is_active, created_at, updated_at, trailer_url, is_featured, release_year, release_label, pass_processing_fee) ON public.movies TO anon;

-- 2) Sponsorship opportunities: hide contact PII from anonymous users
REVOKE SELECT ON public.sponsorship_opportunities FROM anon;
GRANT SELECT (id, slug, title, tagline, intro_text, hook_text, cta_label, section_heading, section_body, benefits, stats_text, price_text, availability_text, contact_name, contact_title, hero_image_url, display_order, is_active, created_by, created_at, updated_at) ON public.sponsorship_opportunities TO anon;

-- 3) Rental requests: constrain anon inserts to safe defaults
DROP POLICY IF EXISTS "Anyone can submit rental requests" ON public.rental_requests;

CREATE POLICY "Anyone can submit rental requests"
ON public.rental_requests
FOR INSERT
TO anon, authenticated
WITH CHECK (
  COALESCE(status::text, 'pending') = 'pending'
  AND COALESCE(contract_status, 'draft') IN ('draft', 'pending')
  AND signed_at IS NULL
  AND signed_by_name IS NULL
  AND signed_by_title IS NULL
  AND signature_serial IS NULL
  AND signed_pdf_sha256 IS NULL
  AND admin_notes IS NULL
);
