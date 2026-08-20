-- Let an operator close an undelivered order that will never deliver itself.
--
-- The undelivered-orders card lists any confirmed order with a delivery error,
-- or with nothing sent at all. Until now the only way off that list was a
-- successful send: a resend stamps `confirmation_sent_at` and clears
-- `confirmation_error`, and the row stops matching.
--
-- That leaves no exit for the orders that cannot be sent. A buyer with no
-- contact on file, a number that is permanently unreachable, someone the box
-- office already sorted out by telephone — each of those sits on the card
-- forever, and a warning that cannot be cleared is a warning people learn to
-- scroll past. The card only works if an empty one means something.
--
-- So dismissal is an explicit act, recorded rather than deleted:
--
--   confirmation_dismissed_at  when an operator said "handled, stop showing me"
--   confirmation_dismissed_by  who said it
--
-- Deliberately NOT a delete and not a flag on the send itself. The order is
-- still undelivered and the columns still say so — `confirmation_sent_at` stays
-- null, `confirmation_error` keeps whatever it recorded. Dismissing changes
-- what the admin is shown, never what happened. Anyone asking later "did this
-- customer ever get their ticket?" gets the true answer, plus a name and a
-- timestamp for who decided it did not matter.
--
-- Reversible by design: clearing both columns puts the order back on the card.
-- There is no button for that, and it should stay a deliberate SQL statement
-- rather than a stray click.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS confirmation_dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_dismissed_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.tickets.confirmation_dismissed_at IS
  'When an admin dismissed this order from the undelivered-orders card. Does not mean the confirmation was sent -- confirmation_sent_at and confirmation_error are untouched and still tell the truth about delivery. It means somebody looked, decided no further send was going to happen, and took it off the list. NULL for everything that has never been dismissed.';

COMMENT ON COLUMN public.tickets.confirmation_dismissed_by IS
  'The admin who dismissed it. Recorded because dismissing is a judgement about a paying customer not receiving something they bought, and a judgement wants a name against it.';

-- Only the card reads these, and only for rows already narrowed to confirmed
-- orders with a delivery problem -- a partial index keeps that lookup off the
-- rest of the table, which is every ticket ever sold.
CREATE INDEX IF NOT EXISTS tickets_undelivered_idx
  ON public.tickets (purchased_at DESC)
  WHERE confirmation_dismissed_at IS NULL
    AND (confirmation_error IS NOT NULL OR confirmation_sent_at IS NULL);
