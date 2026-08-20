-- "Yes, I know, and it is fine."
--
-- The Square panel warns about anything not linked to the catalog. Most of those
-- warnings are worth acting on; some are permanently not. A one-off screening
-- that will never be sold through Square, a retired pass kept for reporting —
-- these are correct to be unlinked, and a warning that cannot be answered is a
-- warning people learn to scroll past, taking the real ones with it.
--
-- So a dismissal is a decision, and decisions here are recorded. This is a table
-- rather than a column for two reasons: it applies to four different entity
-- types that have nothing else in common, and putting it in one place means one
-- audit trigger covers all of them rather than four columns each needing their
-- own coverage.
--
-- Dismissing does not link anything and does not touch Square. It only says a
-- human looked. Deleting the row restores the warning, which is what "undo"
-- means here.

CREATE TABLE IF NOT EXISTS public.square_link_dismissals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The table the thing lives in: film_pass_types, movies, events,
  -- live_performances. Deliberately not a foreign key — one column cannot
  -- reference four tables, and a CHECK keeps it honest without pretending
  -- otherwise.
  entity_type  text NOT NULL CHECK (entity_type IN (
                 'film_pass_types', 'movies', 'events', 'live_performances')),
  entity_id    uuid NOT NULL,
  reason       text,
  dismissed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT square_link_dismissals_unique UNIQUE (entity_type, entity_id)
);

COMMENT ON TABLE public.square_link_dismissals IS
  'Items whose missing Square link has been deliberately accepted, so the panel stops warning about them. A dismissal links nothing and writes nothing to Square — it records that a person looked and decided. Removing the row brings the warning back.';

COMMENT ON COLUMN public.square_link_dismissals.entity_type IS
  'Which table entity_id lives in. Not a foreign key because one column cannot reference four tables; the CHECK constraint is what stops a typo becoming a row nothing can resolve.';

CREATE INDEX IF NOT EXISTS square_link_dismissals_lookup_idx
  ON public.square_link_dismissals (entity_type, entity_id);

GRANT SELECT ON public.square_link_dismissals TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.square_link_dismissals TO authenticated;
GRANT ALL ON public.square_link_dismissals TO service_role;

ALTER TABLE public.square_link_dismissals ENABLE ROW LEVEL SECURITY;

-- Readable by staff, because the panel that reads it is already staff-only and
-- the rows say nothing about anyone. Written by admins, because dismissing a
-- warning is the kind of decision the audit log exists to attribute.
CREATE POLICY "Staff can see dismissals"
  ON public.square_link_dismissals FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins can dismiss"
  ON public.square_link_dismissals FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can undo a dismissal"
  ON public.square_link_dismissals FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- The whole point of recording it. log_audit_event is the same trigger function
-- behind every other audited table, so a dismissal appears in the activity log
-- in the same shape as the link that preceded it — and the link is already
-- logged, because film_pass_types, movies, events and live_performances have
-- carried audit triggers since 20260617072944.
DROP TRIGGER IF EXISTS audit_square_link_dismissals ON public.square_link_dismissals;
CREATE TRIGGER audit_square_link_dismissals
AFTER INSERT OR UPDATE OR DELETE ON public.square_link_dismissals
FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();
