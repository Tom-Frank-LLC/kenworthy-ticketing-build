-- Staff bios — the "Kenworthy Staff" section of /about, edited from the admin
-- Staff tab.
--
-- This table is deliberately *editorial*, not a projection of who has a login.
-- The people the public should read about and the people who hold accounts are
-- overlapping but different sets: the Executive Director belongs on the About
-- page whether or not they ever sign into the box office, and a volunteer with
-- a scanner account does not belong there at all. Deriving the section from
-- profiles/user_roles would mean the public page changes shape every time
-- someone is on-boarded or off-boarded, which is not a decision anyone makes
-- with the About page in mind.
--
-- `user_id` is therefore nullable and carries no behaviour today. It exists so
-- a bio can later be tied to the account it describes (for "edit your own bio",
-- or to show a headshot next to a staff action) without a second migration and
-- without a backfill guess. Nothing reads it yet, and the RLS below does not
-- consult it — a bio is not editable by its subject.

CREATE TABLE IF NOT EXISTS public.staff_bios (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  title            text,
  bio              text,
  headshot_url     text,
  display_on_about boolean NOT NULL DEFAULT false,
  sort_order       int NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  user_id          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.staff_bios IS
  'Editorial staff bios for the "Kenworthy Staff" section of /about. Not a view of who has a login — a bio exists because someone decided the public should read it.';

COMMENT ON COLUMN public.staff_bios.title IS
  'Role as the public should read it ("Executive Director"), not a permission level. Nullable: a name and a photo are enough for a card.';

COMMENT ON COLUMN public.staff_bios.display_on_about IS
  'The switch that puts this person on the public About page. Off by default, so adding a bio is never the same act as publishing it — staff can draft a card, upload a headshot, and choose the moment it goes live.';

COMMENT ON COLUMN public.staff_bios.is_active IS
  'Still on staff. Separate from display_on_about so that someone leaving can be taken off the site without the row — and the headshot, and the copy someone wrote — being deleted. Either flag off keeps them off /about.';

COMMENT ON COLUMN public.staff_bios.sort_order IS
  'Manual ordering, lowest first, name breaking ties. Alphabetical would put the Executive Director wherever the alphabet happens to put them; this section is a hierarchy the theatre chooses.';

COMMENT ON COLUMN public.staff_bios.user_id IS
  'Optional link to the platform account for this person. Unused today — see the table comment. ON DELETE SET NULL because losing an account must not delete a published bio.';

-- The public read, exactly: the two flags in the WHERE, the ordering in the
-- key. The partial index means /about does not scan bios it is not allowed to
-- see.
CREATE INDEX IF NOT EXISTS staff_bios_about_idx
  ON public.staff_bios (sort_order, name)
  WHERE display_on_about AND is_active;

GRANT SELECT ON public.staff_bios TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_bios TO authenticated;
GRANT ALL ON public.staff_bios TO service_role;

ALTER TABLE public.staff_bios ENABLE ROW LEVEL SECURITY;

-- Anon sees only what is flagged for the About page and still active. Staff see
-- every row, which is what lets the admin tab list drafts and former staff
-- alongside the published cards.
--
-- Note the shape: anon cannot read an unpublished bio at all, so a headshot and
-- a paragraph drafted for someone who has not been announced yet are not
-- sitting behind a flag the client controls. (The uploaded image itself lives in
-- the public `posters` bucket and is reachable by URL — see the admin tab's
-- note. Don't draft anything in here you would not want found.)
CREATE POLICY "Published staff bios viewable by everyone"
  ON public.staff_bios FOR SELECT
  USING (
    (display_on_about = true AND is_active = true)
    OR public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Admins and staff can insert staff bios"
  ON public.staff_bios FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Admins and staff can update staff bios"
  ON public.staff_bios FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'staff'))
  WITH CHECK (public.has_role(auth.uid(), 'staff'));

-- Deleting is admin-only, matching press_articles. Unpublishing is one click and
-- reversible; deleting throws away a photo and the copy someone wrote.
CREATE POLICY "Admins can delete staff bios"
  ON public.staff_bios FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_staff_bios_updated_at
  BEFORE UPDATE ON public.staff_bios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
