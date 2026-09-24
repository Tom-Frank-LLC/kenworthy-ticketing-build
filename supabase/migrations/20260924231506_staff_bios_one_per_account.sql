-- One bio per account.
--
-- staff_bios.user_id was added nullable and unused (20260814183831) so a bio
-- could later be tied to the account it describes. The Team Members roster
-- now does that: each team account's card shows and edits the bio whose
-- user_id is that account. Two bios pointing at one account would make the
-- card ambiguous, so the link is unique where it is set. Nullable stays: a
-- bio for someone who never logs in is still a valid bio.

CREATE UNIQUE INDEX IF NOT EXISTS staff_bios_user_id_key
  ON public.staff_bios (user_id)
  WHERE user_id IS NOT NULL;
