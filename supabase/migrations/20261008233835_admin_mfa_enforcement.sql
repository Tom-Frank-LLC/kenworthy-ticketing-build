-- Every signed-in session needs an authenticator code, enforced here
-- (security audit 2026-10-06, M9; docs/briefs/BRIEF-admin-mfa.md).
--
-- Scope: everyone who signs in, whatever their role. Tom, 2026-10-08: "let's
-- not even gate it behind roles for now: everyone who wants to log in must
-- authenticate." The brief first scoped this to admin and superadmin.
--
-- The browser asking for a code is UX. This is the lock. A password-only
-- (aal1) session, once the switch is on, gets nothing a signed-out visitor
-- wouldn't. It's closed at the three places a session's identity turns into
-- access:
--
--   1. has_role(auth.uid(), ...): about 210 policies and RPCs, and every staff,
--      admin and superadmin power.
--   2. is_host_of / is_host_of_showing: a host's powers over their assigned
--      events, including the attendee, check-in and order RPCs.
--   3. Policies that grant on auth.uid() directly ("own row"), on ten tables:
--      donations, dvd_rentals, film_pass_redemptions, host_event_assignments,
--      profiles, rental_invoice_lines, shift_requests, staff_square_links,
--      tickets, user_film_passes. Each gets one RESTRICTIVE policy, which
--      Postgres ANDs with every permissive one, so the existing policies are
--      untouched and can't drift out of step. None of these tables has a
--      signed-in read that isn't own-row or role-based, so FOR ALL takes
--      nothing public away.
--
-- Two deliberate exceptions:
--   - user_roles "Users can view own roles". A password-only session may still
--     read its own role names, so the browser can tell staff from nobody and
--     show the code step rather than bounce them home.
--   - admin_audit_log's INSERT, which ANDs auth.uid() with has_role and is
--     already closed by (1).
--
-- Surveyed on staging before writing this, all 208 policies plus pg_proc.
-- supabase/tests/admin_mfa pins it: its last case fails if a policy anywhere
-- grants on auth.uid() by a route not covered here.
--
-- Factor-agnostic. Supabase raises a session to `aal2` when any verified second
-- factor is used: TOTP today, a passkey later. Only the level is tested.
--
-- Ships DARK. The switch is app_config `mfa_required`, seeded off. Turn it on
-- once everyone who signs in has enrolled. Turn it off to roll back. One row, no
-- deploy. See docs/RUNBOOK-admin-mfa.md.

INSERT INTO public.app_config (key, value)
VALUES ('mfa_required', '{"enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Is the switch on? SECURITY DEFINER because app_config is admin-read only, and
-- the policies below run as the caller.
CREATE OR REPLACE FUNCTION public.mfa_switch_on()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.app_config
     WHERE key = 'mfa_required'
       AND (value ->> 'enabled')::boolean IS TRUE
  )
$function$;

-- May this request's session act as its signed-in user? True when there is no
-- signed-in user (anon, service_role), when the session is aal2, or while the
-- switch is off. A token with no `aal` claim counts as aal1. Cheapest test
-- first: an aal2 session never reads the switch.
CREATE OR REPLACE FUNCTION public.session_ok()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NULL
      OR coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      OR NOT public.mfa_switch_on()
$function$;

REVOKE ALL ON FUNCTION public.mfa_switch_on() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.session_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_switch_on() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.session_ok() TO authenticated, service_role;

-- 1. has_role
--
-- When the caller is asking about themselves (auth.uid() = _user_id, which is
-- how every policy and RPC calls it) from a session that isn't allowed to act,
-- the answer is false for every role. Unchanged for anon and service_role (no
-- auth.uid(), so the branch never matches and nothing extra is read). An aal2
-- session doesn't read the switch either.
--
-- Signature, volatility, security and search_path are unchanged from
-- 20260812063211_has_role_hierarchy.sql.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id IS NULL THEN false
    WHEN _user_id = auth.uid() AND NOT public.session_ok() THEN false
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

-- 2. The host checks, the same way. Bodies unchanged from 20260623175019 apart
-- from the guard.
CREATE OR REPLACE FUNCTION public.is_host_of(_user_id uuid, _event_id uuid, _live_performance_id uuid, _movie_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT NOT (_user_id = auth.uid() AND NOT public.session_ok())
     AND EXISTS (
       SELECT 1 FROM public.host_event_assignments ha
       WHERE ha.user_id = _user_id
         AND (
           (_event_id IS NOT NULL AND ha.event_id = _event_id) OR
           (_live_performance_id IS NOT NULL AND ha.live_performance_id = _live_performance_id) OR
           (_movie_id IS NOT NULL AND ha.movie_id = _movie_id)
         )
     );
$function$;

CREATE OR REPLACE FUNCTION public.is_host_of_showing(_user_id uuid, _showing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT NOT (_user_id = auth.uid() AND NOT public.session_ok())
     AND EXISTS (
       SELECT 1
       FROM public.showings s
       JOIN public.host_event_assignments ha ON (
         (ha.event_id IS NOT NULL AND ha.event_id = s.event_id) OR
         (ha.live_performance_id IS NOT NULL AND ha.live_performance_id = s.live_performance_id) OR
         (ha.movie_id IS NOT NULL AND ha.movie_id = s.movie_id)
       )
       WHERE s.id = _showing_id AND ha.user_id = _user_id
     );
$function$;

-- 3. Own-row grants. `(SELECT public.session_ok())` rather than a bare call, so
-- the planner evaluates it once per statement (an InitPlan), not once per row.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['donations', 'dvd_rentals', 'film_pass_redemptions',
                           'host_event_assignments', 'profiles', 'rental_invoice_lines',
                           'shift_requests', 'staff_square_links', 'tickets', 'user_film_passes']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Signed-in sessions need their code" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Signed-in sessions need their code" ON public.%I AS RESTRICTIVE FOR ALL '
      'TO authenticated USING ((SELECT public.session_ok())) WITH CHECK ((SELECT public.session_ok()))', t);
  END LOOP;
END $$;

-- The edge functions' gate: one call answering 'ok', 'forbidden' or
-- 'mfa_required'.
--
-- The functions ask as service_role, where auth.uid() is NULL and the checks
-- above can't see the caller's session. So the function reads `aal` from the
-- caller's token, after auth has verified it, and passes it in. See requireRole
-- in supabase/functions/_shared/callers.ts.
--
-- 'forbidden' is decided first, so the code prompt is only ever shown to someone
-- who would be let in once they enter it.
CREATE OR REPLACE FUNCTION public.role_gate(_user_id uuid, _role app_role, _aal text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN NOT public.has_role(_user_id, _role) THEN 'forbidden'
    WHEN coalesce(_aal, 'aal1') <> 'aal2' AND public.mfa_switch_on() THEN 'mfa_required'
    ELSE 'ok'
  END
$function$;

REVOKE ALL ON FUNCTION public.role_gate(uuid, app_role, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.role_gate(uuid, app_role, text) TO service_role;

-- For the browser: "would my session be refused without a code?" That is, the
-- switch is on and I'm signed in. It decides whether someone with no
-- authenticator may skip setting one up (switch off) or must (switch on).
CREATE OR REPLACE FUNCTION public.my_mfa_required()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND public.mfa_switch_on()
$function$;

REVOKE ALL ON FUNCTION public.my_mfa_required() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_mfa_required() TO authenticated, service_role;
