-- How many tickets one buyer may hold for a showing through ONLINE checkout.
--
-- ## What this replaces
--
-- A constant, `MAX_TICKETS_PER_SHOWING = 4`, in ticket-checkout. Nobody chose it:
-- it arrived on 17 Jun 2026 in an app-builder commit titled "Fixed auth/security
-- issues", with no comment, and was carried through the August payments rewrite
-- as a number. As a bot defence it is weak — "buyer" is whatever email or phone
-- is typed, so varying the address walks past it; Turnstile and the rate limiter
-- are the real defences. What it reliably did was turn away a family of six, and
-- only after they had filled in the whole form, because the page never enforced
-- it. It also made a "buy 4 or more" discount unreachable online beyond exactly 4.
--
-- ## The setting
--
--   20    the default, stamped on every showing, existing and new
--   n     whatever staff set for one showing (a hot night can be tightened)
--   NULL  no cap: a showing that welcomes a large group. Capacity is then the
--         only limit, and the capacity trigger already enforces that.
--
-- The value on the row is the truth — there is no separate "default" to look up
-- and no magic zero. To change the house default later: ALTER ... SET DEFAULT,
-- and decide separately whether to touch rows already stamped.
--
-- The box office is not subject to this. It never was: the limit lives in
-- ticket-checkout, and StaffPOS writes through PostgREST.

ALTER TABLE public.showings
  ADD COLUMN IF NOT EXISTS max_tickets_per_buyer integer DEFAULT 20
    CONSTRAINT showings_max_tickets_per_buyer_positive
    CHECK (max_tickets_per_buyer IS NULL OR max_tickets_per_buyer >= 1);

COMMENT ON COLUMN public.showings.max_tickets_per_buyer IS
  'Most tickets one buyer may hold for this showing via online checkout. NULL = no cap '
  '(capacity still applies). Default 20. Not applied at the box office. Enforced by '
  'ticket-checkout; the showing page enforces it up front so nobody meets it at the pay button.';
