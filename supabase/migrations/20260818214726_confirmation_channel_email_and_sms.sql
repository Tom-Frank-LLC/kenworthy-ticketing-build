-- Ticket confirmations can now go out on both channels at once.
--
-- Delivery used to branch: an email address won and stopped, and SMS existed
-- only for a buyer who had given nothing else. It now sends on every channel
-- the customer supplied, so an order confirmed by email *and* text records
-- 'email+sms' -- a value the old CHECK constraint rejects. Left unwidened, the
-- UPDATE in deliverConfirmation() fails, and it fails quietly: the write is
-- fire-and-forget and only logs, so `confirmation_sent_at` would never be
-- stamped and the guard that stops a retry from texting someone twice would
-- come undone. Widening the constraint is what keeps that guard honest.
--
-- Nothing here rewrites existing rows. 'email' and 'sms' stay legal and still
-- mean what they meant: those are the orders that had one contact, or that
-- were confirmed before this change.

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_confirmation_channel_check;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_confirmation_channel_check
  CHECK (confirmation_channel IS NULL OR confirmation_channel IN ('email', 'sms', 'email+sms'));

COMMENT ON COLUMN public.tickets.confirmation_channel IS
  'Which channels delivered the confirmation: email, sms, or email+sms when the customer gave both and both sends succeeded. This is what actually went out, not what was attempted.';

COMMENT ON COLUMN public.tickets.confirmation_error IS
  'The last delivery failure for this order, if any. Cleared when every attempted channel succeeds. Set with confirmation_sent_at still NULL when nothing reached the customer -- and set *alongside* a non-NULL confirmation_sent_at when one channel got through and the other did not, which is an order the customer has their tickets for and someone should still look at.';
