-- Let admins manage the lower roles, without letting them near anyone privileged.
--
-- Until now every write on user_roles was superadmin-only (20260814214233,
-- rls_permissions_hardening). That was the right first move — a plain admin
-- could once INSERT their own 'superadmin' row — but it also meant the one
-- superadmin had to personally onboard every volunteer and box-office hire.
--
-- The model, in one sentence: a "protected user" is anyone holding admin or
-- superadmin; an admin may grant and revoke ONLY staff / host / regular_user,
-- and ONLY on users who are not protected. Superadmin keeps full power.
--
-- What that closes, deliberately:
--   * an admin cannot mint admin or superadmin for anyone, themselves included
--     (the role is outside the allowed set);
--   * an admin cannot strip any role from an admin or a superadmin, so they
--     cannot demote a peer or lock the superadmin out (the target is protected);
--   * an admin cannot touch their own row at all — they are protected — so there
--     is no self-elevation and no accidental self-lockout.
--
-- The policies below are the boundary. The Accounts & Roles page hides the
-- buttons it knows will fail, and the invite-staff function checks the same
-- rule before it runs as service_role, but a hand-crafted PostgREST call gets
-- exactly what these policies allow and nothing more.
--
-- UPDATE is scoped the same way as INSERT and DELETE, for the same reason the
-- hardening migration gave superadmin all three verbs: HostManagementTab assigns
-- the host role with an upsert (ON CONFLICT DO UPDATE), and PostgreSQL checks
-- the UPDATE policy on the conflict path. Without it, an admin re-assigning an
-- existing host would fail while a first assignment succeeded.
--
-- Trigger-based audit attribution needs no change: log_audit_event() records
-- auth.uid(), which for these client-side writes is the acting admin.

BEGIN;

-- "Holds admin or superadmin." Mirrors has_role(): SECURITY DEFINER because
-- it reads user_roles from inside user_roles' own policies, and the direct
-- read would otherwise recurse into RLS.
CREATE OR REPLACE FUNCTION public.is_protected_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id
        AND role IN ('admin'::app_role, 'superadmin'::app_role)
    )
  END
$function$;

REVOKE ALL ON FUNCTION public.is_protected_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_protected_user(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Admins insert lower roles" ON public.user_roles;
CREATE POLICY "Admins insert lower roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND role IN ('staff'::app_role, 'host'::app_role, 'regular_user'::app_role)
    AND NOT public.is_protected_user(user_id)
  );

DROP POLICY IF EXISTS "Admins delete lower roles" ON public.user_roles;
CREATE POLICY "Admins delete lower roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND role IN ('staff'::app_role, 'host'::app_role, 'regular_user'::app_role)
    AND NOT public.is_protected_user(user_id)
  );

-- USING guards the row as it is; WITH CHECK guards the row as it would become,
-- so an admin can neither retarget a lower role onto a protected user nor
-- rewrite a staff row into an admin one.
DROP POLICY IF EXISTS "Admins update lower roles" ON public.user_roles;
CREATE POLICY "Admins update lower roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND role IN ('staff'::app_role, 'host'::app_role, 'regular_user'::app_role)
    AND NOT public.is_protected_user(user_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND role IN ('staff'::app_role, 'host'::app_role, 'regular_user'::app_role)
    AND NOT public.is_protected_user(user_id)
  );

COMMIT;
