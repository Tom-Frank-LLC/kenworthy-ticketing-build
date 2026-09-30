-- A pass type can refuse to be posted.
--
-- Every online pass order offers "Collect at the box office" or "Ship it to
-- me", and until now that choice belonged entirely to the buyer. Some passes
-- should never go in an envelope — the French Film Festival passes are for
-- renters, who are in the building anyway, and the theatre does not want to pay
-- postage on them.
--
-- So the pass says so. The purchase page reads it to leave the mail option out,
-- and film-pass-checkout reads it to refuse a mail order that arrives anyway
-- (a tab opened before the switch was flipped, or a direct call). The browser
-- hiding the choice is presentation; the refusal is the rule.
--
-- DEFAULT false: every existing pass keeps offering mail exactly as before, and
-- staff opt specific types in. It gates new orders only — mail orders already
-- placed stay in the mail queue and are posted as promised.

ALTER TABLE public.film_pass_types
  ADD COLUMN IF NOT EXISTS pickup_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.film_pass_types.pickup_only IS
  'When true, the pass can only be collected at the box office: the purchase page offers no mailing option and film-pass-checkout refuses an order with fulfillment = mail. Affects new orders only; existing mail orders are unaffected.';
