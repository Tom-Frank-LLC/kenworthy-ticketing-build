-- Make has_role honour the role hierarchy the application already assumes.
--
-- src/lib/auth.tsx grants the admin UI to superadmins:
--     isAdmin = roles.includes('admin') || superadmin
--     isStaff = roles.includes('staff') || roles.includes('admin') || superadmin
-- but has_role matched the requested role EXACTLY, and every RLS policy on
-- content tables calls has_role(auth.uid(), 'admin'). So an account holding
-- only `superadmin` passed the client-side check, was shown the edit form, and
-- then had its UPDATE filtered out by RLS.
--
-- PostgREST answers an UPDATE that matches no rows with 204 No Content, which
-- supabase-js reports as success — so the form showed "Movie updated!" and
-- navigated away while nothing had been written. That is why movie trailers
-- (and every other admin edit made by a superadmin-only account) vanished.
-- Verified before this migration, as the authenticated role with that account:
--   UPDATE public.movies ... -> rows_updated = 0, has_role(uid,'admin') = false
--
-- The hierarchy below mirrors auth.tsx exactly:
--   superadmin satisfies admin and staff
--   admin      satisfies staff
--   host       stays independent (isHost = roles.includes('host')), because
--              host access is scoped per assignment, not a rank in this ladder.
--
-- Signature, volatility, security and search_path are unchanged; only the
-- membership test is widened.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
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
        AND (
          role = _role
          OR (_role = 'admin'::app_role AND role = 'superadmin'::app_role)
          OR (_role = 'staff'::app_role AND role IN ('admin'::app_role, 'superadmin'::app_role))
        )
    )
  END
$function$;
