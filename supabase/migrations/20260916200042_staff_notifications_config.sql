-- Staff notifications: one app_config entry, editable by admins.
--
-- `staff_notifications` holds, per notification type, whether it fires and who
-- receives it — {"rental_request": {"enabled": true, "recipients": [...]}}.
-- The rental-request edge function reads it (service_role) to decide whether
-- and where to email when the marquee or theatre form is submitted; the admin
-- Notifications screen writes it.
--
-- app_config writes are superadmin-only by default. Like the hiring flag, this
-- is day-to-day operational control — which inbox hears about a rental — not a
-- credential or a brand decision, so admins get it, scoped to this one key by
-- the same name test the hiring policies use. Reads already work: the table's
-- admin SELECT policy covers every key.
--
-- Both INSERT and UPDATE, because the tab writes with upsert and PostgREST
-- resolves that to INSERT ... ON CONFLICT DO UPDATE — a missing INSERT policy
-- fails the call even when the row already exists.
--
-- Recipients in this row are the ONLY source of To addresses for these emails.
-- Nothing in a public form submission can add one. Keep it that way.

DROP POLICY IF EXISTS "Admins can insert staff notifications" ON public.app_config;
CREATE POLICY "Admins can insert staff notifications"
  ON public.app_config FOR INSERT
  TO authenticated
  WITH CHECK (key = 'staff_notifications' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update staff notifications" ON public.app_config;
CREATE POLICY "Admins can update staff notifications"
  ON public.app_config FOR UPDATE
  TO authenticated
  USING (key = 'staff_notifications' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (key = 'staff_notifications' AND public.has_role(auth.uid(), 'admin'));

-- Seeded with the default the function would use anyway, so the admin screen
-- shows where these emails go from day one instead of an implicit fallback.
-- DO NOTHING rather than overwrite: if an environment already has a list, this
-- migration must not reset it.
INSERT INTO public.app_config (key, value)
VALUES (
  'staff_notifications',
  '{"rental_request": {"enabled": true, "recipients": ["events@kenworthy.org"]}}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
