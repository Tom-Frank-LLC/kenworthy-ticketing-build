-- A host can read their own production's sales from a magic-link session.
-- docs/briefs/BRIEF-host-magic-link-view.md
--
-- Assurance matches authority. A magic link proves the inbox and nothing more,
-- so the session it makes (aal1) gets to READ what an assigned host may read and
-- to change nothing. Every write keeps needing aal2, exactly as before.
--
-- Who gets the aal1 allowance: an account that holds `host` and none of staff,
-- admin or superadmin ("host-only"). Anyone with a privileged role is treated
-- exactly as today, host or not, so this is not a way round the code for staff
-- who also host a show.
--
-- Shape. Nothing that already exists is loosened:
--
--   * is_host_of / is_host_of_showing are UNCHANGED. Every write policy, the
--     door scanner (check_in_ticket) and comps (create_ticket_order) keep the
--     aal2 guard through them. The allowance lives in two new read predicates,
--     can_host_read / can_host_read_showing, used only at the read sites below.
--     A read site that was missed shows an empty view; it cannot turn into an
--     unguarded write.
--   * A host does not read `tickets` at all at aal1: its restrictive "Signed-in
--     sessions need their code" policy is untouched. Counts and the attendee
--     list come from two narrow functions that return name, ticket type and
--     checked-in, and no contact details. RLS is per row and column grants are
--     per role, so a direct table read could not have been held to those
--     columns for one kind of session.
--   * showing_attendees (email and phone, which the contact export reads) is now
--     for staff only. Contacts and export are staff work (Tom, 2026-11-05).
--
-- Read sites opened to a host-only aal1 session, all scoped by assignment:
--   showings          "Hosts can view assigned showings"   (rewritten)
--   events, live_performances, movies  "Hosts can view assigned ..." (new: an
--                     inactive production was invisible to its host at any aal)
--   host_event_assignments  own rows (restrictive policy split by command)
--   host_ticket_counts(), host_attendees()  (new)
--
-- The guard is inlined in the per-row predicates, as in has_role: a nested
-- SECURITY DEFINER call cannot be inlined and once made a full showings read 14x
-- slower (20261009003240). Restrictive policies call functions through a scalar
-- subquery, which runs once per statement, so host_view_session() is fine there.

-- ---------------------------------------------------------------------------
-- The caller is host-only: holds `host`, and no staff, admin or superadmin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.host_view_session()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = auth.uid() AND role = 'host'::app_role)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles
                      WHERE user_id = auth.uid()
                        AND role IN ('staff'::app_role, 'admin'::app_role, 'superadmin'::app_role))
$$;

-- ---------------------------------------------------------------------------
-- Read predicates: is_host_of's body, with one more way past the guard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_host_read(_user_id uuid, _event_id uuid, _live_performance_id uuid, _movie_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
       SELECT 1 FROM public.host_event_assignments ha
       WHERE ha.user_id = _user_id
         AND (
           (_event_id IS NOT NULL AND ha.event_id = _event_id) OR
           (_live_performance_id IS NOT NULL AND ha.live_performance_id = _live_performance_id) OR
           (_movie_id IS NOT NULL AND ha.movie_id = _movie_id)
         )
     )
     AND NOT (_user_id = auth.uid()
              AND coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
              AND EXISTS (SELECT 1 FROM public.app_config
                           WHERE key = 'mfa_required' AND (value ->> 'enabled')::boolean IS TRUE)
              -- The one difference from is_host_of: a host-only account passes.
              AND NOT (EXISTS (SELECT 1 FROM public.user_roles
                                WHERE user_id = _user_id AND role = 'host'::app_role)
                       AND NOT EXISTS (SELECT 1 FROM public.user_roles
                                        WHERE user_id = _user_id
                                          AND role IN ('staff'::app_role, 'admin'::app_role, 'superadmin'::app_role))));
$$;

CREATE OR REPLACE FUNCTION public.can_host_read_showing(_user_id uuid, _showing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
       SELECT 1
       FROM public.showings s
       JOIN public.host_event_assignments ha ON (
         (ha.event_id IS NOT NULL AND ha.event_id = s.event_id) OR
         (ha.live_performance_id IS NOT NULL AND ha.live_performance_id = s.live_performance_id) OR
         (ha.movie_id IS NOT NULL AND ha.movie_id = s.movie_id)
       )
       WHERE s.id = _showing_id AND ha.user_id = _user_id
     )
     AND NOT (_user_id = auth.uid()
              AND coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
              AND EXISTS (SELECT 1 FROM public.app_config
                           WHERE key = 'mfa_required' AND (value ->> 'enabled')::boolean IS TRUE)
              AND NOT (EXISTS (SELECT 1 FROM public.user_roles
                                WHERE user_id = _user_id AND role = 'host'::app_role)
                       AND NOT EXISTS (SELECT 1 FROM public.user_roles
                                        WHERE user_id = _user_id
                                          AND role IN ('staff'::app_role, 'admin'::app_role, 'superadmin'::app_role))));
$$;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Hosts can view assigned showings" ON public.showings;
CREATE POLICY "Hosts can view assigned showings" ON public.showings
  FOR SELECT TO authenticated
  USING (public.can_host_read(auth.uid(), event_id, live_performance_id, movie_id));

DROP POLICY IF EXISTS "Hosts can view assigned events" ON public.events;
CREATE POLICY "Hosts can view assigned events" ON public.events
  FOR SELECT TO authenticated
  USING (public.can_host_read(auth.uid(), id, NULL, NULL));

DROP POLICY IF EXISTS "Hosts can view assigned live performances" ON public.live_performances;
CREATE POLICY "Hosts can view assigned live performances" ON public.live_performances
  FOR SELECT TO authenticated
  USING (public.can_host_read(auth.uid(), NULL, id, NULL));

DROP POLICY IF EXISTS "Hosts can view assigned movies" ON public.movies;
CREATE POLICY "Hosts can view assigned movies" ON public.movies
  FOR SELECT TO authenticated
  USING (public.can_host_read(auth.uid(), NULL, NULL, id));

-- host_event_assignments: the restrictive policy was FOR ALL, which cannot let a
-- read through without letting a write through. Split by command; the write
-- halves are the old condition unchanged.
DROP POLICY IF EXISTS "Signed-in sessions need their code" ON public.host_event_assignments;
CREATE POLICY "Signed-in sessions need their code" ON public.host_event_assignments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT public.session_ok()) OR (SELECT public.host_view_session()));
CREATE POLICY "Signed-in sessions need their code to add" ON public.host_event_assignments
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.session_ok()));
CREATE POLICY "Signed-in sessions need their code to change" ON public.host_event_assignments
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT public.session_ok())) WITH CHECK ((SELECT public.session_ok()));
CREATE POLICY "Signed-in sessions need their code to remove" ON public.host_event_assignments
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.session_ok()));

-- ---------------------------------------------------------------------------
-- What the host view shows: counts and a name list, no contact details.
-- Staff (aal2) may call these too; the /host page uses them for everyone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.host_ticket_counts(p_showing_ids uuid[])
RETURNS TABLE(showing_id uuid, sold bigint, comps bigint, checked_in bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.id,
         count(t.id) FILTER (WHERE t.payment_method IS DISTINCT FROM 'comp'),
         count(t.id) FILTER (WHERE t.payment_method = 'comp'),
         count(t.scanned_at)
    FROM public.showings s
    LEFT JOIN public.tickets t ON t.showing_id = s.id AND t.status = 'confirmed'
   WHERE s.id = ANY (p_showing_ids)
     AND ((SELECT public.has_role(auth.uid(), 'staff'::app_role))
          OR public.can_host_read_showing(auth.uid(), s.id))
   GROUP BY s.id
$$;

-- Confirmed tickets only: a declined card or a refund is not an attendee.
CREATE OR REPLACE FUNCTION public.host_attendees(p_showing_id uuid)
RETURNS TABLE(ticket_id uuid, attendee_name text, ticket_type text, is_comp boolean,
              checked_in boolean, purchased_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.id,
         coalesce(nullif(btrim(t.comp_recipient_name), ''), nullif(btrim(p.display_name), ''), 'Guest'),
         spt.tier_name,
         t.payment_method = 'comp',
         t.scanned_at IS NOT NULL,
         t.purchased_at
    FROM public.tickets t
    LEFT JOIN public.profiles p ON p.id = t.user_id
    LEFT JOIN public.showing_price_tiers spt ON spt.id = t.tier_id
   WHERE t.showing_id = p_showing_id
     AND t.status = 'confirmed'
     AND ((SELECT public.has_role(auth.uid(), 'staff'::app_role))
          OR (SELECT public.can_host_read_showing(auth.uid(), p_showing_id)))
   ORDER BY t.purchased_at DESC, t.id
$$;

-- ---------------------------------------------------------------------------
-- Contact details: staff only. The host branch is gone; nothing else changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.showing_attendees(p_showing_ids uuid[])
RETURNS TABLE(ticket_id uuid, display_name text, email text, phone text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT t.id,
         p.display_name,
         p.email,
         p.phone
  FROM public.tickets t
  LEFT JOIN public.profiles p ON p.id = t.user_id
  WHERE t.showing_id = ANY (p_showing_ids)
    AND (SELECT public.has_role(auth.uid(), 'staff'::app_role));
$$;

-- ---------------------------------------------------------------------------
-- The client's "do I need a code?" question: not for a host-only account.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_mfa_required()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL AND public.mfa_switch_on() AND NOT public.host_view_session()
$$;

-- ---------------------------------------------------------------------------
-- Grants: signed-in sessions only, as for is_host_of.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.host_view_session() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_host_read(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_host_read_showing(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.host_ticket_counts(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.host_attendees(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_view_session() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_host_read(uuid, uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_host_read_showing(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.host_ticket_counts(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.host_attendees(uuid) TO authenticated, service_role;
