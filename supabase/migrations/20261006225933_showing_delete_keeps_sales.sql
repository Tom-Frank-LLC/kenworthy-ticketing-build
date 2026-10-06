-- A showing that has sold cannot be deleted, and a host cannot edit tickets.
-- BRIEF-sec-rls-regressions (audit 2026-10-06 M4).
--
-- 1. "Hosts can update tickets for assigned showings" (20260623175019) was cut
--    when hosts checked tickets in by updating the row. Check-in has been the
--    check_in_ticket RPC (SECURITY DEFINER) since 20260812190000, and no host
--    code path writes a ticket: HostDashboard reads tickets and calls
--    showing_attendees / check_in_ticket. What the policy still allowed was
--    every column of every ticket for the host's production — flip a refunded
--    ticket back to confirmed, reassign it, reprice it. Dropped.
--
-- 2. tickets.showing_id and film_pass_redemptions.showing_id were ON DELETE
--    CASCADE, so deleting a showing (a host's "Remove", an admin's delete, or a
--    film's delete cascading to its showings) silently erased every sale and
--    pass admission for it, and the pass balances they had drawn down stayed
--    drawn down. Both are RESTRICT now: a sale outlives the schedule entry it
--    was for. The configuration rows (tiers, discounts, pass tagging, Square
--    variations) still cascade; donations and concession sales already SET
--    NULL.
--
--    RESTRICT alone would surface as Postgres's foreign-key message, which
--    names constraints, not what to do. The trigger below refuses first, with
--    a sentence a person can act on; both admin screens and the host dashboard
--    already show error.message in a toast. The FK stays as the backstop for
--    anything that skips triggers.

DROP POLICY IF EXISTS "Hosts can update tickets for assigned showings" ON public.tickets;

ALTER TABLE public.tickets
  DROP CONSTRAINT tickets_showing_id_fkey,
  ADD CONSTRAINT tickets_showing_id_fkey
    FOREIGN KEY (showing_id) REFERENCES public.showings(id) ON DELETE RESTRICT;

ALTER TABLE public.film_pass_redemptions
  DROP CONSTRAINT film_pass_redemptions_showing_id_fkey,
  ADD CONSTRAINT film_pass_redemptions_showing_id_fkey
    FOREIGN KEY (showing_id) REFERENCES public.showings(id) ON DELETE RESTRICT;

-- SECURITY DEFINER: the caller (a host) may not be able to see every ticket on
-- the showing, and the refusal must not depend on what RLS shows them. It
-- reveals only that some exist, which the caller's own showing page says.
-- Any status counts — refunded and failed rows are part of the sales record
-- the box-office report and QBO export read.
CREATE OR REPLACE FUNCTION public.refuse_delete_sold_showing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tickets WHERE showing_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.film_pass_redemptions WHERE showing_id = OLD.id) THEN
    RAISE EXCEPTION 'This showing has tickets or pass admissions recorded against it, so it cannot be deleted. Turn it off (inactive) instead.'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.refuse_delete_sold_showing() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS refuse_delete_sold_showing ON public.showings;
CREATE TRIGGER refuse_delete_sold_showing
  BEFORE DELETE ON public.showings
  FOR EACH ROW EXECUTE FUNCTION public.refuse_delete_sold_showing();
