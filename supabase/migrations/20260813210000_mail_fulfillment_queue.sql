-- Posting a pass is a second event, and until now nothing recorded it.
--
-- activate_film_pass sets the order to 'fulfilled' the moment a blank sticker
-- is scanned against it, for pickup and mail alike. For a pickup that is the
-- truth: the patron is standing there and walks away with the pass. For a
-- mailed pass it is the midpoint — the sticker is on the card, the card is on
-- the desk, and nobody has been to the post office yet.
--
-- The box office queue reads status='paid', so activation drops a mail order
-- out of every screen while the envelope is still sitting there. fulfilled_at
-- timestamps the scan, not the post, and no column anywhere could answer
-- "did we actually mail it?".
--
-- These columns are that answer. The mail queue is
--     fulfillment = 'mail' AND status = 'fulfilled' AND posted_at IS NULL
-- and a row leaves it only when a staff member says the envelope went out.
--
-- Why not a new status value instead? Because posting is not a payment state.
-- QboExportTab reads this table with `status IN ('paid','fulfilled')` to build
-- the QuickBooks export, so a new value would drop awaiting-post orders out of
-- the revenue numbers with no error — a shortfall nobody could explain months
-- later. A nullable timestamp is orthogonal to status, carries when and who,
-- and breaks no existing reader.

ALTER TABLE public.film_pass_orders
  ADD COLUMN IF NOT EXISTS posted_at             timestamptz,
  ADD COLUMN IF NOT EXISTS posted_by             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_notice_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_notice_error   text;

COMMENT ON COLUMN public.film_pass_orders.posted_at IS
  'When a staff member confirmed the envelope went out. NOT derivable from fulfilled_at, which records the sticker scan that happens before posting. NULL on a fulfilled mail order means it is still waiting to be posted.';

COMMENT ON COLUMN public.film_pass_orders.posted_by IS
  'Who confirmed the posting. Separate from fulfilled_by: the person who activates the sticker and the person who walks to the post office are often not the same.';

COMMENT ON COLUMN public.film_pass_orders.posted_notice_sent_at IS
  'When the "it is in the mail" email reached Resend. Mirrors confirmation_sent_at: a fire-and-forget send fails silently, and silence means a patron never told their pass shipped.';

-- A pickup order has no envelope, so it can never be posted. Without this the
-- column is merely conventional, and a future caller could quietly mark one.
ALTER TABLE public.film_pass_orders
  DROP CONSTRAINT IF EXISTS film_pass_orders_posted_is_mail;

ALTER TABLE public.film_pass_orders
  ADD CONSTRAINT film_pass_orders_posted_is_mail
  CHECK (posted_at IS NULL OR fulfillment = 'mail');

-- The queue read: mail orders activated but not yet posted, oldest first.
-- Partial, because the rows that matter are a small and shrinking subset of the
-- table — every posted order leaves the index for good.
CREATE INDEX IF NOT EXISTS film_pass_orders_awaiting_post_idx
  ON public.film_pass_orders (fulfilled_at)
  WHERE fulfillment = 'mail' AND posted_at IS NULL;

-- No backfill, deliberately.
--
-- Every mail order already fulfilled arrives with posted_at NULL and so appears
-- in the new queue. That is correct here: production holds only test data from
-- the day this was built, so there is no history to assert about, and clearing
-- those rows by hand is the first real exercise of the button. Backfilling
-- posted_at = fulfilled_at would have claimed those envelopes were posted
-- without anyone knowing whether they were.
--
-- If this migration is ever replayed against a database with real history,
-- check the count first:
--   SELECT count(*) FROM public.film_pass_orders
--   WHERE fulfillment = 'mail' AND status = 'fulfilled' AND posted_at IS NULL;
-- A large number there means the queue would open full of orders nobody can
-- act on, which trains staff to ignore it. Decide before running, not after.
