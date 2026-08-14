-- Where a rental's Square invoice lives, once staff have generated one.
--
-- The invoice itself is built from `rental_invoice_lines` by the
-- `square-invoice` edge function and stored in Square. These four columns are
-- the local record of that: enough to stop a second click creating a second
-- invoice, and enough for the admin listing to turn "Generate Invoice" into
-- "View Invoice" without asking Square on every render.
--
-- `square_invoice_status` is Square's own status string (DRAFT, UNPAID, PAID,
-- CANCELED …) as of the last time we wrote it. It is a cache, not the truth —
-- Square is the truth, which is why the button links there.

ALTER TABLE public.rental_requests
  ADD COLUMN IF NOT EXISTS square_invoice_id text,
  ADD COLUMN IF NOT EXISTS square_invoice_url text,
  ADD COLUMN IF NOT EXISTS square_invoice_status text,
  ADD COLUMN IF NOT EXISTS square_invoice_created_at timestamptz;

-- Anonymous submitters must not be able to plant these.
--
-- The public form inserts as `anon`, and the existing policy already stops a
-- submitter forging the signature fields or their own admin notes. An invoice
-- id and URL belong in the same list: a request that arrives already carrying
-- `square_invoice_url = <attacker's page>` would render as "View Invoice" on
-- the staff listing and send whoever clicked it somewhere we never wrote.
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
  AND square_invoice_id IS NULL
  AND square_invoice_url IS NULL
  AND square_invoice_status IS NULL
  AND square_invoice_created_at IS NULL
);
