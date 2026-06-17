
-- Generic audit logger
CREATE OR REPLACE FUNCTION public.log_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_entity_id uuid;
  v_action text;
  v_details jsonb := '{}'::jsonb;
  v_changes jsonb;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_entity_id := (to_jsonb(NEW) ->> 'id')::uuid;
    v_action := TG_TABLE_NAME || '.create';
    v_details := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    v_entity_id := (to_jsonb(NEW) ->> 'id')::uuid;
    v_action := TG_TABLE_NAME || '.update';

    IF TG_TABLE_NAME = 'sponsorship_opportunities'
       AND (to_jsonb(NEW) ->> 'is_active') IS DISTINCT FROM (to_jsonb(OLD) ->> 'is_active') THEN
      v_action := CASE WHEN (to_jsonb(NEW) ->> 'is_active')::boolean
                       THEN 'sponsorship_opportunities.publish'
                       ELSE 'sponsorship_opportunities.unpublish' END;
    END IF;

    IF TG_TABLE_NAME = 'tickets'
       AND (to_jsonb(NEW) ->> 'scanned_at') IS DISTINCT FROM (to_jsonb(OLD) ->> 'scanned_at')
       AND (to_jsonb(OLD) ->> 'scanned_at') IS NULL THEN
      v_action := 'tickets.scan';
    END IF;

    SELECT jsonb_object_agg(key, jsonb_build_object('old', o.value, 'new', n.value))
      INTO v_changes
      FROM jsonb_each(to_jsonb(OLD)) o
      JOIN jsonb_each(to_jsonb(NEW)) n USING (key)
     WHERE o.value IS DISTINCT FROM n.value
       AND key NOT IN ('updated_at');
    v_details := jsonb_build_object('changes', COALESCE(v_changes, '{}'::jsonb));
  ELSIF TG_OP = 'DELETE' THEN
    v_entity_id := (to_jsonb(OLD) ->> 'id')::uuid;
    v_action := TG_TABLE_NAME || '.delete';
    v_details := jsonb_build_object('old', to_jsonb(OLD));
  END IF;

  INSERT INTO public.admin_audit_log (actor_id, actor_email, action, entity_type, entity_id, details)
  VALUES (v_actor, v_email, v_action, TG_TABLE_NAME, v_entity_id, COALESCE(v_details, '{}'::jsonb));

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Helper to attach audit triggers
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'sponsorship_opportunities',
    'showings',
    'movies',
    'events',
    'live_performances',
    'tickets',
    'profiles',
    'user_roles',
    'concession_items',
    'film_pass_types'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_audit_event()',
      t, t
    );
  END LOOP;
END $$;
