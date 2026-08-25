-- What a pass is worth, in the only currency a buyer cares about.
--
-- The film pass confirmation email and the /film-passes page both tried to
-- state the offer and both stated it backwards: "about 10 films at $6 each".
-- $6 is `redemption_price` — the balance the pass *spends* per admission. The
-- number that makes the pass worth buying is the one the buyer does not pay:
-- the $8 that same seat costs at the window. A pass that spends $6 for an $8
-- ticket is a deal; a pass described as "$6 each" is just a smaller price tag.
--
-- That figure was nowhere in the schema. `film_pass_types` carries price,
-- initial_balance and redemption_price and nothing else, and a showing's own
-- `ticket_price` is not a constant to borrow — staging alone holds eleven
-- distinct values ($0, $8, $10, $12, $20, $40 …), of which $8 is merely the
-- most common. So it is stored per pass type, because the answer differs per
-- pass: the Festival Pass buys festival seats, not standard ones.
--
-- Nullable on purpose. Every surface falls back to naming the count without a
-- price ("redeemable for ten film tickets"), which is true of any pass, so an
-- unset value can never be the reason a pass stops selling or an email starts
-- lying. It is the absence of a claim, not a wrong claim.

ALTER TABLE public.film_pass_types
  ADD COLUMN IF NOT EXISTS ticket_face_value numeric;

COMMENT ON COLUMN public.film_pass_types.ticket_face_value IS
  'Window price of one ticket this pass admits you to — what the holder would otherwise have paid, not what the pass deducts (that is redemption_price). Drives the "ten $8 film tickets" claim in the confirmation email and on /film-passes. NULL means the surfaces state the count without a price rather than guess, so leaving it unset is always safe.';
