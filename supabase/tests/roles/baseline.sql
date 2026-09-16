-- Part 2 of 2: what production had on user_roles before the migration under
-- test -- the superadmin policies from 20260626154552 and the UPDATE policy
-- from 20260814214233, copied verbatim -- plus the probe helpers.
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Superadmins view all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'superadmin'));
CREATE POLICY "Superadmins insert roles" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'superadmin'));
CREATE POLICY "Superadmins delete roles" ON public.user_roles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'superadmin'));
CREATE POLICY "Superadmins update roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'superadmin'::app_role));

REVOKE ALL ON public.user_roles FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;

-- Probe helpers. SECURITY INVOKER (the default), so once the test does
-- `SET ROLE authenticated` they run under RLS exactly as PostgREST would.
--
-- Each one performs the write inside a subtransaction and then raises a
-- private error code to roll it back, so the verdict comes out while the table
-- stays as the fixture left it. INSERT/UPDATE-with-check denials raise
-- insufficient_privilege; DELETE and UPDATE-using denials raise nothing and
-- simply match zero rows, which is why the row count is the verdict there.
CREATE TABLE public.results (n serial, name text, expected text, got text, pass boolean);

CREATE FUNCTION public.probe_insert(actor uuid, target uuid, r public.app_role) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE verdict text;
BEGIN
  PERFORM set_config('test.uid', actor::text, true);
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (target, r);
    RAISE EXCEPTION USING ERRCODE = 'P0999';
  EXCEPTION
    WHEN SQLSTATE 'P0999' THEN verdict := 'allowed';
    WHEN insufficient_privilege THEN verdict := 'denied';
  END;
  RETURN verdict;
END $$;

CREATE FUNCTION public.probe_delete(actor uuid, target uuid, r public.app_role) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE verdict text; n int;
BEGIN
  PERFORM set_config('test.uid', actor::text, true);
  BEGIN
    DELETE FROM public.user_roles WHERE user_id = target AND role = r;
    GET DIAGNOSTICS n = ROW_COUNT;
    verdict := CASE WHEN n > 0 THEN 'allowed' ELSE 'denied' END;
    RAISE EXCEPTION USING ERRCODE = 'P0999';
  EXCEPTION
    WHEN SQLSTATE 'P0999' THEN NULL;
    WHEN insufficient_privilege THEN verdict := 'denied';
  END;
  RETURN verdict;
END $$;

-- Rewrites the (target, r) row to (new_target, new_r).
CREATE FUNCTION public.probe_update(actor uuid, target uuid, r public.app_role, new_target uuid, new_r public.app_role) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE verdict text; n int;
BEGIN
  PERFORM set_config('test.uid', actor::text, true);
  BEGIN
    UPDATE public.user_roles SET user_id = new_target, role = new_r WHERE user_id = target AND role = r;
    GET DIAGNOSTICS n = ROW_COUNT;
    verdict := CASE WHEN n > 0 THEN 'allowed' ELSE 'denied' END;
    RAISE EXCEPTION USING ERRCODE = 'P0999';
  EXCEPTION
    WHEN SQLSTATE 'P0999' THEN NULL;
    WHEN insufficient_privilege THEN verdict := 'denied';
  END;
  RETURN verdict;
END $$;

-- The upsert HostManagementTab actually issues.
CREATE FUNCTION public.probe_upsert_host(actor uuid, target uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE verdict text; n int;
BEGIN
  PERFORM set_config('test.uid', actor::text, true);
  BEGIN
    INSERT INTO public.user_roles (user_id, role) VALUES (target, 'host')
      ON CONFLICT (user_id, role) DO UPDATE SET role = EXCLUDED.role;
    GET DIAGNOSTICS n = ROW_COUNT;
    verdict := CASE WHEN n > 0 THEN 'allowed' ELSE 'denied' END;
    RAISE EXCEPTION USING ERRCODE = 'P0999';
  EXCEPTION
    WHEN SQLSTATE 'P0999' THEN NULL;
    WHEN insufficient_privilege THEN verdict := 'denied';
  END;
  RETURN verdict;
END $$;

CREATE FUNCTION public.visible_count(actor uuid) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('test.uid', actor::text, true);
  SELECT count(*) INTO n FROM public.user_roles;
  RETURN n;
END $$;

CREATE FUNCTION public.check(name text, expected text, got text) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.results (name, expected, got, pass) VALUES (name, expected, got, expected = got);
$$;

GRANT ALL ON public.results TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.results_n_seq TO authenticated;
