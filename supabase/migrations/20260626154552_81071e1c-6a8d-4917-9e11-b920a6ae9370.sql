CREATE POLICY "Superadmins view all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Superadmins insert roles" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Superadmins delete roles" ON public.user_roles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'superadmin'));

-- Also let superadmins read all profiles (needed to list users on the roles page)
CREATE POLICY "Superadmins view all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'superadmin'));