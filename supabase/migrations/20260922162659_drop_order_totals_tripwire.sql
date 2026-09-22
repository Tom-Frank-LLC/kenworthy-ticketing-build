-- The tripwire comes down. BRIEF-pricing-rpc, Ship 2.
--
-- enforce_ticket_order_totals recomputed what a client should have computed —
-- the order's tax, the discount's rule and amount — and refused an insert that
-- differed. It existed because three copies of the arithmetic could drift.
-- Every paid row is now written by create_ticket_order, which prices with the
-- one copy that remains; a direct paid insert is refused by policy
-- (20260922001849). There is no second computation left to disagree.
--
-- enforce_ticket_pricing (the row trigger) stays: it still derives list_price
-- from the tier or showing and zeroes comps, and costs nothing.
--
-- What is lost: a check on rows the SERVICE ROLE inserts directly, since it
-- bypasses RLS. No edge function does that any more (ticket-checkout goes
-- through createTicketOrder); the row trigger's list_price derivation is what
-- remains against a future one.

DROP TRIGGER IF EXISTS enforce_ticket_order_totals_on_insert ON public.tickets;
DROP FUNCTION IF EXISTS public.enforce_ticket_order_totals();
