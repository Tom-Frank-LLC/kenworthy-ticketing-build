-- The MFA guard in has_role and the host checks, inlined
-- (follow-up to 20261008233835_admin_mfa_enforcement.sql).
--
-- Same rule, same results. The difference is speed. 20261008233835 had these
-- functions call session_ok(), which calls mfa_switch_on(). Both are SECURITY
-- DEFINER, so Postgres can't inline them, and has_role / is_host_of run per
-- row inside RLS. Measured on staging (an aal1 admin, `select count(*) from
-- showings`, 1,796 rows, three runs each):
--
--   before 20261008233835                 ~33 ms
--   20261008233835 (nested calls)         ~475 ms aal1, ~275 ms aal2
--   this migration (guard inlined)        ~54 ms, switch on or off, aal1 or aal2
--   anon, any version                     ~1 ms (auth.uid() is NULL, the guard never runs)
--
-- The remaining ~20 ms is the guard's own work per call: parsing the claims
-- (~13 ms) and reading the switch row (~8 ms). Removing it would mean wrapping
-- `has_role(auth.uid(), …)` as `(SELECT has_role(auth.uid(), …))` in about 200
-- policies, so it runs once per statement. That's worth doing separately.
--
-- session_ok() stays for the restrictive policies, which call it as
-- `(SELECT public.session_ok())`, an InitPlan evaluated once per statement, and
-- for nothing per-row.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id IS NULL THEN false
    -- The session_ok rule, inlined: asking about yourself, the switch on, not aal2.
    WHEN _user_id = auth.uid()
     AND coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
     AND EXISTS (SELECT 1 FROM public.app_config
                  WHERE key = 'mfa_required' AND (value ->> 'enabled')::boolean IS TRUE)
      THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id
        AND (
          role = _role
          OR (_role = 'admin'::app_role AND role = 'superadmin'::app_role)
          OR (_role = 'staff'::app_role AND role IN ('admin'::app_role, 'superadmin'::app_role))
        )
    )
  END
$function$;

-- Assignment first: for anyone who isn't a host (every admin reading every
-- showing) it is false at once and the guard is never evaluated.
CREATE OR REPLACE FUNCTION public.is_host_of(_user_id uuid, _event_id uuid, _live_performance_id uuid, _movie_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
                           WHERE key = 'mfa_required' AND (value ->> 'enabled')::boolean IS TRUE));
$function$;

CREATE OR REPLACE FUNCTION public.is_host_of_showing(_user_id uuid, _showing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
                           WHERE key = 'mfa_required' AND (value ->> 'enabled')::boolean IS TRUE));
$function$;
