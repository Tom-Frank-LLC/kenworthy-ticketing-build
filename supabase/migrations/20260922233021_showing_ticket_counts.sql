-- Sold and checked-in counts per showing, aggregated where the rows live.
--
-- The admin dashboard used to download every confirmed ticket ever sold —
-- `select id, showing_id, scanned_at from tickets where status = 'confirmed'`,
-- paged a thousand at a time — on every visit, and then count them per showing
-- in the browser with a filter() per badge. Both the download and the work grew
-- with every ticket sold, so the screen the events staff live in got slower
-- every month, and nothing in it ever needed a ticket row: it needed two
-- numbers per showing. This function returns exactly those.
--
-- SECURITY INVOKER, deliberately. It reads `tickets` as whoever calls it, so
-- the table's own row-level policies decide what is counted: an admin counts
-- everything, and anyone else counts only what they could already read row by
-- row. There is no privilege here to escalate and no admin check to keep in
-- step with the policies. Anon is revoked all the same — the counts are not a
-- public number.
--
-- `count(scanned_at)` counts non-null values, which is the checked-in figure.
-- Grouping keeps a row for `showing_id IS NULL` if any confirmed ticket has no
-- showing; the caller sums `sold` across every row for its total, so that
-- total still matches the old `tickets.length`.
--
-- A set-returning function, not JSON, so the client can `.order().range()` it
-- through the same pager as every other read. PostgREST caps an RPC result at
-- the same thousand rows as a table read, and this theatre has more showings
-- than that.
CREATE OR REPLACE FUNCTION public.showing_ticket_counts()
RETURNS TABLE (showing_id uuid, sold bigint, scanned bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT t.showing_id,
         count(*)            AS sold,
         count(t.scanned_at) AS scanned
    FROM public.tickets t
   WHERE t.status = 'confirmed'
   GROUP BY t.showing_id
$$;

COMMENT ON FUNCTION public.showing_ticket_counts() IS
  'Confirmed tickets per showing: sold and scanned. SECURITY INVOKER, so tickets RLS decides what is counted. Replaces the admin dashboard downloading the whole tickets table.';

REVOKE ALL ON FUNCTION public.showing_ticket_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.showing_ticket_counts() TO authenticated, service_role;
