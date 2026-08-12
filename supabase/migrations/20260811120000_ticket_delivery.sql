-- Ticket delivery: order-grouping token + confirmation bookkeeping.
--
-- Context: tickets were being created correctly but never delivered to the
-- customer (no transactional email, no SMS). Delivery needs two things the
-- schema did not have:
--
--   1. A way to address a whole *purchase* with one link. Tickets have no
--      order table, so a shared random token per checkout stands in for one.
--      A four-ticket order becomes one link, not four.
--   2. A record of whether delivery actually happened, so failures are
--      visible in the admin rather than silently swallowed by the
--      fire-and-forget send.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS order_token          text,
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_channel text,
  ADD COLUMN IF NOT EXISTS confirmation_error   text;

-- Backfill: every pre-existing ticket gets its own token so the QR view works
-- for historical purchases too. Legacy tickets are not grouped into orders --
-- there is no reliable purchase grouping to recover retroactively -- so each
-- one becomes a single-ticket "order".
UPDATE public.tickets
   SET order_token = gen_random_uuid()::text
 WHERE order_token IS NULL;

ALTER TABLE public.tickets
  ALTER COLUMN order_token SET DEFAULT gen_random_uuid()::text;

ALTER TABLE public.tickets
  ALTER COLUMN order_token SET NOT NULL;

CREATE INDEX IF NOT EXISTS tickets_order_token_idx
  ON public.tickets (order_token);

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_confirmation_channel_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_confirmation_channel_check
  CHECK (confirmation_channel IS NULL OR confirmation_channel IN ('email', 'sms'));

COMMENT ON COLUMN public.tickets.order_token IS
  'Unguessable random token shared by every ticket in a single purchase. Bearer credential for the public ticket-access edge function, which serves the mobile ticket page and QR images to whoever holds the emailed/texted link. RLS never exposes this to anon -- it only ever reaches a customer through a delivered confirmation.';

COMMENT ON COLUMN public.tickets.confirmation_sent_at IS
  'When the ticket confirmation was successfully handed to the delivery provider (Resend or Twilio). NULL means the customer has not been sent their ticket.';

COMMENT ON COLUMN public.tickets.confirmation_channel IS
  'Which channel delivered the confirmation: email or sms.';

COMMENT ON COLUMN public.tickets.confirmation_error IS
  'Last delivery failure for this order, if any. Set when a send is attempted and fails, cleared on success.';
