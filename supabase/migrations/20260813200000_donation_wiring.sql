-- Donations: bundling with a ticket order, and bookkeeping for the emails.
--
-- Two things this table could not previously express:
--
--   1. Where a gift came from. Every row was a Donate-page gift, so nothing
--      needed to say so. A donation added to a ticket checkout or rung up at
--      the box office is the same contribution income, but it arrives with an
--      order attached and it is worth being able to tell them apart when
--      reconciling a day's takings against Square.
--
--   2. Whether the donor was ever actually told. The donor receipt and the
--      tribute notification are dispatched fire-and-forget, exactly like ticket
--      delivery, which makes silent failure the real risk — so every outcome is
--      written back here, mirroring tickets.confirmation_sent_at /
--      confirmation_error.
--
-- donor_email loses its NOT NULL for the counter case only: a walk-in who drops
-- a dollar in at the box office has no email to give, and refusing to record
-- that gift would lose real money from the books. Every online path still
-- requires one.

ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'donate_page',
  -- 'online' (card, web), 'terminal' (Square reader), 'cash' (till).
  ADD COLUMN IF NOT EXISTS payment_channel text,
  -- The ticket order this gift rode along with, when it was bundled. Not a
  -- foreign key: tickets.order_token is a grouping column, not a primary key,
  -- and the donation outlives a refunded order.
  ADD COLUMN IF NOT EXISTS order_token uuid,
  ADD COLUMN IF NOT EXISTS showing_id uuid REFERENCES public.showings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_error text,
  ADD COLUMN IF NOT EXISTS notify_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS notify_error text;

ALTER TABLE public.donations ALTER COLUMN donor_email DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'donations_source_check'
  ) THEN
    ALTER TABLE public.donations
      ADD CONSTRAINT donations_source_check
      CHECK (source IN ('donate_page', 'ticket_checkout', 'staff_pos'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'donations_payment_channel_check'
  ) THEN
    ALTER TABLE public.donations
      ADD CONSTRAINT donations_payment_channel_check
      CHECK (payment_channel IS NULL OR payment_channel IN ('online', 'terminal', 'cash'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_donations_order_token ON public.donations(order_token);
CREATE INDEX IF NOT EXISTS idx_donations_source ON public.donations(source);

COMMENT ON COLUMN public.donations.source IS
  'Where the gift was made: donate_page, ticket_checkout (bundled with tickets), staff_pos (box office).';
COMMENT ON COLUMN public.donations.order_token IS
  'tickets.order_token of the sale this gift was added to, when bundled. Null for standalone gifts.';
COMMENT ON COLUMN public.donations.confirmation_error IS
  'Why the donor receipt failed to send, if it did. Mirrors tickets.confirmation_error.';
