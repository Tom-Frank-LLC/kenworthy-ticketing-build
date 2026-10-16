-- A blank contract becomes a rental request's contract.
--
-- A contract drawn up on /contract/blank had no request behind it: no renter
-- link to send, no signing, no invoice, and no place in the review queue. Staff
-- now link a filled-in blank to an existing request, or create one from it,
-- and from then on the request's contract IS that contract.
--
-- Both paths are one function, link_blank_contract, so the link is all or
-- nothing and a blank cannot be linked twice: the blank row is locked, an
-- already-linked blank is refused, and so is a request that is already signed
-- (its signed terms are not rewritten from a worksheet).
--
-- The blank row is kept, not deleted, with linked_request_id set. Its versions
-- are BlankFields, a different shape from contract_data, so they stay where
-- they are and the request's History shows them as "from the blank contract".
--
-- No email goes out. The staff notification for a new request is sent by the
-- rental-request edge function for the public form; a request staff made
-- themselves needs no alert to staff.
--
-- authenticated holds no INSERT on rental_requests (20260819193812), and still
-- does not: this SECURITY DEFINER function is the only way in besides the
-- public form, and it checks for admin itself.

ALTER TABLE public.blank_contracts
  ADD COLUMN IF NOT EXISTS linked_request_id uuid
    REFERENCES public.rental_requests(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.blank_contracts.linked_request_id IS
  'The rental request this blank became the contract of (link_blank_contract). Set: the blank is retired, and the list and its URL point at the request. NULL: a standalone blank. ON DELETE SET NULL: deleting the request returns the blank to standalone rather than losing it.';

CREATE INDEX IF NOT EXISTS blank_contracts_linked_request_idx
  ON public.blank_contracts (linked_request_id) WHERE linked_request_id IS NOT NULL;

-- p_request_id: link to this existing request; NULL to create one from p_new.
-- p_new:        the new request's columns (allowlisted below).
-- p_patch:      columns of the existing request the staffer chose to replace
--               with what was typed (allowlisted below).
-- p_contract_data: the request's contract terms, converted from the blank by
--               the client (blankToContractData), Term overrides included.
CREATE OR REPLACE FUNCTION public.link_blank_contract(
  p_blank_id uuid,
  p_request_id uuid,
  p_new jsonb,
  p_patch jsonb,
  p_contract_data jsonb
)
RETURNS TABLE (request_id uuid, invite_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blank public.blank_contracts%ROWTYPE;
  v_req public.rental_requests%ROWTYPE;
  v_id uuid;
  v_email_re constant text := '^[^\s@]+@[^\s@]+\.[^\s@]+$';
  t text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only an admin can link a contract to a rental request' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_contract_data) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Contract terms are missing' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_blank FROM public.blank_contracts WHERE id = p_blank_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Blank contract not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_blank.linked_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'This blank contract is already linked to a rental request' USING ERRCODE = '23505';
  END IF;

  IF p_request_id IS NULL THEN
    IF jsonb_typeof(p_new) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Say which request to link to, or give the new request''s details' USING ERRCODE = '22023';
    END IF;
    FOREACH t IN ARRAY ARRAY['event_title', 'applicant_name', 'email'] LOOP
      IF coalesce(btrim(p_new->>t), '') = '' THEN
        RAISE EXCEPTION 'A new rental request needs %', replace(t, '_', ' ') USING ERRCODE = '23502';
      END IF;
    END LOOP;
    IF btrim(p_new->>'email') !~ v_email_re THEN
      RAISE EXCEPTION 'That email address is not valid' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.rental_requests (
      event_title, applicant_name, organization_name, email, phone,
      proposed_date, end_date, event_start_time, event_end_time,
      event_description, wants_beer_wine,
      status, contract_status, admin_notes
    ) VALUES (
      btrim(p_new->>'event_title'),
      btrim(p_new->>'applicant_name'),
      nullif(btrim(p_new->>'organization_name'), ''),
      btrim(p_new->>'email'),
      nullif(btrim(p_new->>'phone'), ''),
      nullif(p_new->>'proposed_date', '')::date,
      nullif(p_new->>'end_date', '')::date,
      nullif(p_new->>'event_start_time', ''),
      nullif(p_new->>'event_end_time', ''),
      nullif(btrim(p_new->>'event_description'), ''),
      coalesce((p_new->>'wants_beer_wine')::boolean, false),
      'pending', 'draft',
      'Created by staff from a blank contract.'
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO v_req FROM public.rental_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Rental request not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_req.signed_at IS NOT NULL THEN
      RAISE EXCEPTION 'That request''s contract is already signed; its terms are not changed from a blank' USING ERRCODE = '55000';
    END IF;
    IF p_patch ? 'email' AND btrim(p_patch->>'email') !~ v_email_re THEN
      RAISE EXCEPTION 'That email address is not valid' USING ERRCODE = '22023';
    END IF;
    IF (p_patch ? 'applicant_name' AND coalesce(btrim(p_patch->>'applicant_name'), '') = '') THEN
      RAISE EXCEPTION 'The applicant name cannot be emptied' USING ERRCODE = '23502';
    END IF;
    -- Only what the staffer picked, and only these. Dates and times are not
    -- here: a typed date the staffer prefers goes into the contract's Term
    -- (p_contract_data), and the request keeps what the renter asked for.
    UPDATE public.rental_requests r SET
      applicant_name    = CASE WHEN p_patch ? 'applicant_name' THEN btrim(p_patch->>'applicant_name') ELSE r.applicant_name END,
      organization_name = CASE WHEN p_patch ? 'organization_name' THEN nullif(btrim(p_patch->>'organization_name'), '') ELSE r.organization_name END,
      email             = CASE WHEN p_patch ? 'email' THEN btrim(p_patch->>'email') ELSE r.email END,
      phone             = CASE WHEN p_patch ? 'phone' THEN nullif(btrim(p_patch->>'phone'), '') ELSE r.phone END,
      event_description = CASE WHEN p_patch ? 'event_description' THEN nullif(btrim(p_patch->>'event_description'), '') ELSE r.event_description END
    WHERE r.id = p_request_id;
    v_id := p_request_id;
  END IF;

  -- A separate UPDATE, not part of the INSERT, so snapshot_rental_contract
  -- (AFTER UPDATE OF contract_data) records the linked terms as a version.
  UPDATE public.rental_requests SET contract_data = p_contract_data WHERE id = v_id;
  UPDATE public.blank_contracts SET linked_request_id = v_id WHERE id = p_blank_id;

  RETURN QUERY SELECT r.id, r.invite_token FROM public.rental_requests r WHERE r.id = v_id;
END $$;

REVOKE ALL ON FUNCTION public.link_blank_contract(uuid, uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_blank_contract(uuid, uuid, jsonb, jsonb, jsonb) TO authenticated, service_role;
