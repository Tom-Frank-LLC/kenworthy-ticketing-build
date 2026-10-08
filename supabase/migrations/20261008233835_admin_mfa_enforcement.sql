-- Admin and superadmin access needs an authenticator code, enforced here
-- (security audit 2026-10-06, M9; docs/briefs/BRIEF-admin-mfa.md).
--
-- The browser asking for a code is UX. This is the lock: every RLS policy and
-- every role-checking RPC goes through has_role(auth.uid(), ...), so a check in
-- has_role covers all of them at once. Verified before writing this: no policy
-- reads user_roles directly, and the public functions that do
-- (auth_user_id_by_phone, is_protected_user, handle_new_user,
-- refuse_roleless_access_token) grant no power.
--
-- Factor-agnostic on purpose. Supabase raises a session to `aal2` when any
-- verified second factor is used: TOTP today, a passkey later. The test below
-- is on the assurance level, never on which factor produced it, so adding a
-- factor type changes nothing here.
--
-- Ships DARK. The switch is app_config `mfa_required_for_admins`, seeded off.
-- Turn it on once every admin-tier account has enrolled; turn it off to roll
-- back. One row, no deploy. See docs/RUNBOOK-admin-mfa.md.

INSERT INTO public.app_config (key, value)
VALUES ('mfa_required_for_admins', '{"enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Would a session for _user_id at assurance level _aal be refused?
--
-- True only when all three hold: the session is not aal2, the switch is on, and
-- the user holds admin or superadmin. The checks run cheapest first. A NULL aal
-- (a token minted before Supabase added the claim) counts as aal1.
--
-- Internal. It answers "is this uuid an admin" while the switch is on, so
-- nobody but the definer functions below may call it.
CREATE OR REPLACE FUNCTION public.mfa_blocks(_user_id uuid, _aal text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT coalesce(_aal, 'aal1') <> 'aal2'
     AND EXISTS (
       SELECT 1 FROM public.app_config
        WHERE key = 'mfa_required_for_admins'
          AND (value ->> 'enabled')::boolean IS TRUE
     )
     AND EXISTS (
       SELECT 1 FROM public.user_roles
        WHERE user_id = _user_id
          AND role IN ('admin'::app_role, 'superadmin'::app_role)
     )
$function$;

REVOKE ALL ON FUNCTION public.mfa_blocks(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mfa_blocks(uuid, text) TO service_role;

-- has_role, with the assurance check in front.
--
-- When the caller is asking about themselves (auth.uid() = _user_id, which is
-- how every policy and RPC calls it) and mfa_blocks says so, the answer is false
-- for EVERY role, staff included. All-or-nothing on purpose: a phished admin
-- password must not still open the till, refunds or attendee lists at staff
-- level.
--
-- Unchanged for everyone else:
--   anon               auth.uid() is NULL, so the new branch never matches and
--                      no extra row is read. Public pages pay nothing.
--   service_role       the same: no auth.uid(). The edge functions ask as
--                      service_role, so they gate through role_gate below.
--   staff, host, etc.  mfa_blocks is false at its role test.
--   an aal2 admin      mfa_blocks is false at its first test, before any read.
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
    WHEN _user_id = auth.uid() AND public.mfa_blocks(_user_id, auth.jwt() ->> 'aal') THEN false
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

-- The edge functions' gate: one call answering 'ok', 'forbidden' or
-- 'mfa_required'.
--
-- The functions ask as service_role, where auth.uid() is NULL and has_role
-- cannot see the caller's session. So the function reads `aal` from the
-- caller's token, after auth has verified it, and passes it in. The rule
-- itself (mfa_blocks) stays here, in one place, rather than being re-implemented
-- in TypeScript. See requireRole in supabase/functions/_shared/callers.ts.
--
-- 'forbidden' is decided before 'mfa_required', so the code prompt is only ever
-- shown to someone who would be let in once they enter it.
CREATE OR REPLACE FUNCTION public.role_gate(_user_id uuid, _role app_role, _aal text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN NOT public.has_role(_user_id, _role) THEN 'forbidden'
    WHEN public.mfa_blocks(_user_id, _aal) THEN 'mfa_required'
    ELSE 'ok'
  END
$function$;

REVOKE ALL ON FUNCTION public.role_gate(uuid, app_role, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.role_gate(uuid, app_role, text) TO service_role;

-- For the browser: "would my session be refused without a code?" That is, is the
-- switch on and do I hold admin or superadmin? It is asked about the caller only,
-- so it says nothing about anyone else.
--
-- The client uses it for one decision: whether an admin with no authenticator
-- may skip enrolling for now. While the switch is off they may. Once it's on,
-- enrolling is the only way back in.
CREATE OR REPLACE FUNCTION public.my_mfa_required()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND public.mfa_blocks(auth.uid(), 'aal1')
$function$;

REVOKE ALL ON FUNCTION public.my_mfa_required() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_mfa_required() TO authenticated, service_role;
