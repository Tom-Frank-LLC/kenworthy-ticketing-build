CREATE TABLE IF NOT EXISTS public.signing_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  algorithm text NOT NULL DEFAULT 'Ed25519',
  private_key_b64 text NOT NULL,
  public_key_b64 text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.signing_keys TO service_role;
ALTER TABLE public.signing_keys ENABLE ROW LEVEL SECURITY;
-- No policies: table is unreachable via Data API. Only service_role (edge function) touches it.

CREATE OR REPLACE FUNCTION public.get_contract_signature(p_request_id uuid)
RETURNS TABLE (
  event_title text,
  applicant_name text,
  signed_at timestamptz,
  signed_by_name text,
  signed_by_title text,
  signed_pdf_sha256 text,
  signature_b64 text,
  public_key_b64 text,
  algorithm text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.event_title,
    r.applicant_name,
    r.signed_at,
    r.signed_by_name,
    r.signed_by_title,
    r.signed_pdf_sha256,
    r.signature_serial AS signature_b64,
    k.public_key_b64,
    k.algorithm
  FROM public.rental_requests r
  LEFT JOIN public.signing_keys k ON k.active = true
  WHERE r.id = p_request_id
  ORDER BY k.created_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_contract_signature(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contract_signature(uuid) TO anon, authenticated;