-- Contracts: saved blank contracts, a version history, and an archive of the
-- signed PDFs.
--
-- Before this, a rental contract was one jsonb column that every Save
-- overwrote, a blank contract lived only in one browser tab's sessionStorage,
-- and a signed contract was a hash: sign-contract stamped the PDF, hashed it,
-- handed it to the staffer's browser and kept nothing else. /verify can only
-- confirm a file someone still has, and a PDF rebuilt from contract_data later
-- is not that file — html2canvas rasterises it, and the verify page is stamped
-- on — so it never matches the hash.
--
--   blank_contracts       a blank contract a staffer chose to keep (Save, or a
--                         Download). `fields` is the editor's BlankFields as
--                         typed; `title` and `event_date` are copied out of it
--                         by the client so the Contracts list can sort and name
--                         rows without parsing jsonb.
--   contract_versions     one row per change to a contract's terms, and one per
--                         signing. Written only by the triggers below, so every
--                         write path is covered (the editor's Save, Sign &
--                         Download, a SQL fix) and nothing can be left out.
--   signed-contracts      private bucket. sign-contract uploads the stamped PDF
--                         at <rental_request_id>/<sha256>.pdf BEFORE it records
--                         the signing, so a recorded signing always has its file.
--
-- Version rows are a few KB of jsonb. History is read only when a staffer opens
-- one contract's History, never by a list or a public page.

-- ---------------------------------------------------------------------------
-- 1. blank_contracts
-- ---------------------------------------------------------------------------

CREATE TABLE public.blank_contracts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL DEFAULT '',
  event_date  date,
  fields      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.blank_contracts IS
  'Blank (no rental request) contracts staff saved or downloaded from /contract/blank. fields = the editor''s BlankFields; title/event_date are copies of it for listing.';

CREATE INDEX blank_contracts_event_date_idx ON public.blank_contracts (event_date DESC NULLS LAST);

CREATE TRIGGER update_blank_contracts_updated_at
  BEFORE UPDATE ON public.blank_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_blank_contracts
  AFTER INSERT OR UPDATE OR DELETE ON public.blank_contracts
  FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

ALTER TABLE public.blank_contracts ENABLE ROW LEVEL SECURITY;

-- Same split as rental_requests: staff can read, only admins write. Never
-- "authenticated": every ticket buyer holds a session (CLAUDE.md).
REVOKE ALL ON public.blank_contracts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blank_contracts TO authenticated;
GRANT ALL ON public.blank_contracts TO service_role;

CREATE POLICY "Staff read blank contracts"
  ON public.blank_contracts FOR SELECT TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')) OR (SELECT public.has_role(auth.uid(), 'staff')));

CREATE POLICY "Admins create blank contracts"
  ON public.blank_contracts FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins update blank contracts"
  ON public.blank_contracts FOR UPDATE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')))
  WITH CHECK ((SELECT public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Admins delete blank contracts"
  ON public.blank_contracts FOR DELETE TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')));

-- ---------------------------------------------------------------------------
-- 2. Where a signing's PDF is kept
-- ---------------------------------------------------------------------------

ALTER TABLE public.rental_requests
  ADD COLUMN IF NOT EXISTS signed_pdf_path text;

COMMENT ON COLUMN public.rental_requests.signed_pdf_path IS
  'Object path in the signed-contracts bucket of the latest signed PDF, the exact file signed_pdf_sha256 hashes. NULL for signings before 2026-10-16, whose file was never kept.';

-- ---------------------------------------------------------------------------
-- 3. contract_versions
-- ---------------------------------------------------------------------------

CREATE TABLE public.contract_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_request_id  uuid REFERENCES public.rental_requests(id) ON DELETE CASCADE,
  blank_contract_id  uuid REFERENCES public.blank_contracts(id) ON DELETE CASCADE,
  event              text NOT NULL CHECK (event IN ('saved', 'signed')),
  contract_data      jsonb,
  -- A request contract prints the renter's name, purpose, dates and alcohol
  -- choice from the request row, not from contract_data. Without these an old
  -- version would render its old terms against today's request.
  request_snapshot   jsonb,
  signed_pdf_sha256  text,
  signed_pdf_path    text,
  saved_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  saved_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((rental_request_id IS NULL) <> (blank_contract_id IS NULL))
);

COMMENT ON TABLE public.contract_versions IS
  'History of contract terms: one row per change to rental_requests.contract_data or blank_contracts.fields, and one per signing. Written by triggers only.';

CREATE INDEX contract_versions_request_idx
  ON public.contract_versions (rental_request_id, saved_at DESC) WHERE rental_request_id IS NOT NULL;
CREATE INDEX contract_versions_blank_idx
  ON public.contract_versions (blank_contract_id, saved_at DESC) WHERE blank_contract_id IS NOT NULL;

ALTER TABLE public.contract_versions ENABLE ROW LEVEL SECURITY;

-- Read-only to staff. No write policy and no write grant: the triggers are
-- SECURITY DEFINER, and history nobody can edit is the point of having it.
REVOKE ALL ON public.contract_versions FROM anon, authenticated;
GRANT SELECT ON public.contract_versions TO authenticated;
GRANT ALL ON public.contract_versions TO service_role;

CREATE POLICY "Staff read contract versions"
  ON public.contract_versions FOR SELECT TO authenticated
  USING ((SELECT public.has_role(auth.uid(), 'admin')) OR (SELECT public.has_role(auth.uid(), 'staff')));

-- A signing is recorded when signed_pdf_sha256 changes; the editor saves the
-- terms first, so a Sign & Download with unsaved edits writes a 'saved' row
-- then a 'signed' row, and an unchanged contract writes only the 'signed' one.
CREATE OR REPLACE FUNCTION public.snapshot_rental_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signed boolean := NEW.signed_pdf_sha256 IS NOT NULL
    AND NEW.signed_pdf_sha256 IS DISTINCT FROM OLD.signed_pdf_sha256;
BEGIN
  INSERT INTO public.contract_versions (
    rental_request_id, event, contract_data, request_snapshot,
    signed_pdf_sha256, signed_pdf_path, saved_by
  ) VALUES (
    NEW.id,
    CASE WHEN v_signed THEN 'signed' ELSE 'saved' END,
    NEW.contract_data,
    -- What the contract prints from the request: the get_rental_request_by_token
    -- projection, less the contract and signature columns.
    jsonb_build_object(
      'event_title', NEW.event_title,
      'event_description', NEW.event_description,
      'organization_name', NEW.organization_name,
      'applicant_name', NEW.applicant_name,
      'email', NEW.email,
      'proposed_date', NEW.proposed_date,
      'end_date', NEW.end_date,
      'event_start_time', NEW.event_start_time,
      'event_end_time', NEW.event_end_time,
      'wants_beer_wine', NEW.wants_beer_wine,
      'created_at', NEW.created_at
    ),
    CASE WHEN v_signed THEN NEW.signed_pdf_sha256 END,
    CASE WHEN v_signed THEN NEW.signed_pdf_path END,
    -- sign-contract writes with the service role, where auth.uid() is NULL.
    CASE WHEN v_signed THEN NEW.signed_by ELSE auth.uid() END
  );
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.snapshot_rental_contract() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER snapshot_rental_contract
  AFTER UPDATE OF contract_data, signed_pdf_sha256 ON public.rental_requests
  FOR EACH ROW
  WHEN (NEW.contract_data IS DISTINCT FROM OLD.contract_data
        OR (NEW.signed_pdf_sha256 IS NOT NULL AND NEW.signed_pdf_sha256 IS DISTINCT FROM OLD.signed_pdf_sha256))
  EXECUTE FUNCTION public.snapshot_rental_contract();

CREATE OR REPLACE FUNCTION public.snapshot_blank_contract()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.contract_versions (blank_contract_id, event, contract_data, saved_by)
  VALUES (NEW.id, 'saved', NEW.fields, auth.uid());
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.snapshot_blank_contract() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER snapshot_blank_contract_ins
  AFTER INSERT ON public.blank_contracts
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_blank_contract();

CREATE TRIGGER snapshot_blank_contract_upd
  AFTER UPDATE OF fields ON public.blank_contracts
  FOR EACH ROW
  WHEN (NEW.fields IS DISTINCT FROM OLD.fields)
  EXECUTE FUNCTION public.snapshot_blank_contract();

-- ---------------------------------------------------------------------------
-- 4. signed-contracts bucket
-- ---------------------------------------------------------------------------

-- Private, PDFs only. Only sign-contract (service role) writes; staff read
-- through a short-lived signed URL, which needs the SELECT policy.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signed-contracts', 'signed-contracts', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Staff read signed contracts"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'signed-contracts'
         AND ((SELECT public.has_role(auth.uid(), 'admin')) OR (SELECT public.has_role(auth.uid(), 'staff'))));
