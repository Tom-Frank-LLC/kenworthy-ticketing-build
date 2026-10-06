-- The renter's contract link returns what the contract page renders, not the
-- whole rental_requests row. BRIEF-sec-rls-regressions (audit 2026-10-06 L17;
-- open since the 08-14 audit's Finding 9 / 08-19 L2).
--
-- get_rental_request_by_token(text) was `SELECT *`. The token is strong, but
-- whoever holds the link — the renter, and anyone they forward it to — got
-- admin_notes, the Square invoice fields, the signature serial and hash, the
-- staff-side contact fields, and every column added after it. The only caller
-- is src/pages/RentalContract.tsx, which reads exactly the columns below (and
-- contract_data, which it renders and edits).
--
-- The return type changes from the table's row type to an explicit TABLE, so
-- the function is dropped and recreated rather than replaced. A column the
-- page starts to need has to be added here, which is the point.

DROP FUNCTION IF EXISTS public.get_rental_request_by_token(text);

CREATE FUNCTION public.get_rental_request_by_token(p_token text)
RETURNS TABLE (
  id uuid,
  event_title text,
  event_description text,
  organization_name text,
  applicant_name text,
  email text,
  proposed_date date,
  end_date date,
  event_start_time text,
  event_end_time text,
  wants_beer_wine boolean,
  created_at timestamptz,
  contract_data jsonb,
  signed_at timestamptz,
  signed_by_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.event_title, r.event_description, r.organization_name,
         r.applicant_name, r.email, r.proposed_date, r.end_date,
         r.event_start_time, r.event_end_time, r.wants_beer_wine, r.created_at,
         r.contract_data, r.signed_at, r.signed_by_name
  FROM public.rental_requests r
  WHERE r.invite_token = p_token
  LIMIT 1;
$$;

-- The token is the capability: anon is the renter.
REVOKE ALL ON FUNCTION public.get_rental_request_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_rental_request_by_token(text) TO anon, authenticated, service_role;
