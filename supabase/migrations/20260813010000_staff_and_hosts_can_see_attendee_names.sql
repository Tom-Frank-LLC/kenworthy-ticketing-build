-- Attendee names, without handing the box office the donor file.
--
-- Found by auditing all 43 RLS-enabled tables against the surfaces staff can
-- actually reach. `profiles` is the last table with the shape that broke
-- `tickets`: staff operate the surface, but only `admin` is named in the policy.
--
--   "Users can view own profile"     (id = auth.uid()) OR has_role(uid,'admin')
--   "Superadmins view all profiles"  has_role(uid,'superadmin')
--
-- Verified against the real policies, with the patron row proven to exist:
--
--   profiles visible to a staff-only account: 1   (its own row only)
--   as postgres, the patron row does exist:   1
--   the PATRON row visible to staff:          0
--
-- PostgREST applies RLS to *embedded* resources too, so the joins simply
-- returned NULL and every call site fell through to its placeholder. Nothing
-- errored:
--
--   AttendeeSheet.tsx      every attendee rendered "Unknown", no email or phone
--   lib/exportContacts.ts  CSV exports lost every name
--   HostDashboard.tsx      every attendee rendered "Guest"
--
-- The attendee sheet is the door list. A staff-only account saw a roster of
-- "Unknown".
--
-- ---------------------------------------------------------------------------
-- Why not a staff SELECT policy on profiles
-- ---------------------------------------------------------------------------
-- Because `profiles` is not a name table. It also carries marketing_opt_in and
-- a block of Mailchimp columns including mailchimp_ltv_tickets and
-- mailchimp_ltv_donations — lifetime donation value for every patron. RLS
-- cannot restrict columns, and every logged-in user shares the `authenticated`
-- database role, so column privileges cannot separate staff from admin either.
-- A staff read policy on the table would publish the donor file to the box
-- office in order to print a door list.
--
-- So this exposes the operation instead of the table, the same way
-- check_in_ticket and film-pass-checkout's patron lookup already do: three
-- contact columns, keyed to tickets the caller is entitled to see.
--
-- ---------------------------------------------------------------------------
-- Scoping
-- ---------------------------------------------------------------------------
-- Staff get every showing they ask for — they can already read all of `tickets`.
-- A host gets only showings they are assigned to, and the check is per row
-- rather than per call, so a host passing somebody else's showing id receives
-- no rows for it instead of an error. Anyone else receives nothing at all.
--
-- Ticket-keyed, not user-keyed, for two reasons: a comp ticket has no user_id
-- and must still line up with its row, and a user-keyed lookup would let a host
-- pass arbitrary user ids and read contacts for patrons who never attended
-- their event.

CREATE OR REPLACE FUNCTION public.showing_attendees(p_showing_ids uuid[])
 RETURNS TABLE (
   ticket_id    uuid,
   display_name text,
   email        text,
   phone        text
 )
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.id,
         p.display_name,
         p.email,
         p.phone
  FROM public.tickets t
  LEFT JOIN public.profiles p ON p.id = t.user_id
  WHERE t.showing_id = ANY (p_showing_ids)
    AND (
      public.has_role(auth.uid(), 'staff'::app_role)
      OR public.is_host_of_showing(auth.uid(), t.showing_id)
    );
$function$;

COMMENT ON FUNCTION public.showing_attendees(uuid[]) IS
  'Contact details for the attendees of the given showings, keyed by ticket id. SECURITY DEFINER because RLS on profiles restricts every row to its own owner or an admin, which left staff and hosts unable to put a name to a ticket. Returns only display_name, email and phone — never the marketing or Mailchimp lifetime-value columns. Staff see any showing; a host sees only showings they are assigned to; everyone else gets no rows.';

REVOKE ALL ON FUNCTION public.showing_attendees(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.showing_attendees(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.showing_attendees(uuid[]) TO authenticated, service_role;
