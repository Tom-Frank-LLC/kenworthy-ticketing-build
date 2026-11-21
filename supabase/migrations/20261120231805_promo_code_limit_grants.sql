-- ticket_discount_limits: the table grants 20261120190412 left out.
--
-- New tables on this project do not get SELECT/INSERT/UPDATE/DELETE for
-- `authenticated` by default; they get only REFERENCES, TRIGGER and TRUNCATE.
-- So the RLS policies on the limits table had nothing to govern: every
-- admin read failed with "permission denied for table ticket_discount_limits"
-- (found on staging, 20 Nov 2026, in the Promo codes tab). The pricing path
-- was unaffected: it reads the table as SECURITY DEFINER.
--
-- Matches ticket_discounts exactly: authenticated may SELECT/INSERT/UPDATE/
-- DELETE (RLS then admits staff to read and admins to write), and nothing
-- else. TRUNCATE in particular ignores RLS, so it is taken away. anon has
-- nothing, as before.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_discount_limits TO authenticated;
REVOKE REFERENCES, TRIGGER, TRUNCATE ON public.ticket_discount_limits FROM authenticated;
REVOKE ALL ON public.ticket_discount_limits FROM anon;
