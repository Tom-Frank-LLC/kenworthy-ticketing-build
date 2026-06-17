
-- 1. Donations: explicit INSERT policy (authenticated users, scoped to self)
DROP POLICY IF EXISTS "Authenticated users can insert own donations" ON public.donations;
CREATE POLICY "Authenticated users can insert own donations"
ON public.donations
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 2. Profiles: drop overbroad host -> attendee profile read
DROP POLICY IF EXISTS "Hosts can view attendee profiles" ON public.profiles;

-- 3. Signing keys: revoke all direct API access (private keys must never be read via PostgREST)
REVOKE ALL ON public.signing_keys FROM anon, authenticated;

-- 4. Movies: hide confidential licensing fields from anonymous visitors
REVOKE SELECT (terms_percent, distributor, circuit) ON public.movies FROM anon;

-- 5. SECURITY DEFINER functions: tighten EXECUTE
REVOKE EXECUTE ON FUNCTION public.get_contract_signature(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_account_id(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.redeem_film_pass(uuid, uuid, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_rental_request_by_token(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_rental_request_by_token(text) TO anon, authenticated;

-- 6. Rental requests: let a submitter read their own request via invite token
DROP POLICY IF EXISTS "Submitter can read own rental request via token" ON public.rental_requests;
-- (No direct policy needed; access is via SECURITY DEFINER function get_rental_request_by_token.)
