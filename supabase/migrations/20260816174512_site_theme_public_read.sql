-- The published site theme: one app_config key, readable by everyone.
--
-- The Color Lab began as a per-tab audition tool — sessionStorage, no server,
-- provably unable to affect another visitor. That stays exactly as it was. This
-- adds a second, deliberate layer on top: a superadmin can take the two colours
-- they have settled on and *publish* them, at which point every visitor gets
-- them. Two powers with two very different blast radii, and which one you are
-- using is a matter of which control you press.
--
-- Why app_config rather than a new table: it already is the site's key/value
-- config store, it already carries the superadmin INSERT/UPDATE policies this
-- needs (20260701183947), it is already granted to anon for SELECT
-- (20260813220000), and the audit-log trigger already understands its text
-- primary key (20260815015037, which added details.entity_key precisely because
-- app_config is keyed by `key` and not `id`). So publishing a theme is
-- audit-logged with no extra work — the property you want on a control that
-- repaints the whole site for everyone.
--
-- Shape of the value:
--
--   {"purple": "#B16ED8", "green": "#2BAB5A"}
--
-- Either key may be null or absent, meaning "no override for that colour — use
-- whatever src/index.css ships". An absent row means the whole theme is the
-- code's. That is the same removal-not-restoration rule the Lab's Reset uses:
-- nothing here records what the stylesheet said, so nothing here can drift away
-- from it.

-- Anonymous visitors need this row: an unauthenticated ticket buyer must see
-- the published theme, not the code default.
--
-- This is a second, additive policy rather than an edit of "Public can read the
-- hiring flag". Permissive SELECT policies OR together, so one key per policy
-- reads exactly as it behaves, and the hiring flag's rule is left untouched —
-- worth something in a repo where several branches are usually in flight.
--
-- Deliberately `key = 'site_theme'` and not `USING (true)`: app_config also
-- holds things like mailchimp_webhook, so public read is an allowlist of one
-- name, not an opening of the table.
DROP POLICY IF EXISTS "Public can read the site theme" ON public.app_config;
CREATE POLICY "Public can read the site theme"
  ON public.app_config FOR SELECT
  TO anon, authenticated
  USING (key = 'site_theme');

-- Writes are NOT widened here, and that is the point of the feature. The hiring
-- toggle was given to admins because it is day-to-day editorial control;
-- repainting the site is a brand decision, so it keeps the table's default of
-- superadmin-only: "Superadmins can insert app_config" / "Superadmins can update
-- app_config" (20260701183947), reachable because that same migration granted
-- INSERT, UPDATE on the table to authenticated. Both the policies and the grant
-- were verified present before this migration was written — a policy whose grant
-- was revoked later is a policy that silently does nothing, which is a failure
-- mode this table has the shape to hide.
