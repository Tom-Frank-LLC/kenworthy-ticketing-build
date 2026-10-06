-- Restore the column-level grants that 20260810165116 silently undid, and cut
-- staff ids out of what the public can read. BRIEF-sec-rls-regressions
-- (audit 2026-10-06 M3, L19).
--
-- 20260810165116 ran `GRANT SELECT ON <every public table> TO anon,
-- authenticated` to fix unrelated inconsistent grants. A table-wide grant
-- supersedes column grants, so every earlier column restriction became a
-- full-row grant. 20260814214233 caught sponsorship_opportunities and
-- restored that table only. Replaying every migration up to the loop and
-- listing the (table, role) pairs that lacked table-level SELECT finds exactly
-- four, and this migration settles each:
--
--   movies / anon                     -> restored here (M3)
--   qbo_connection / authenticated    -> restored here
--   sponsorship_opportunities / anon  -> restored on 08-14, but to the
--                                        20260701020754 list; the later
--                                        20260701185308 also withheld
--                                        contact_name and contact_title.
--                                        Restored to that here.
--   signing_keys / anon, authenticated -> re-revoked by 20260814214233; holds.
--
-- Column lists are explicit, never derived, so a column added later is
-- withheld by default instead of exposed by default. When a migration adds a
-- public column to one of these tables it has to grant it here-style, and the
-- page's select string has to name it. supabase/tests/anon_surface/ holds the
-- allowlist that fails if a blanket grant ever lands again.

-- ---------------------------------------------------------------------------
-- 1. movies (M3). distributor, circuit and terms_percent are the film-rental
--    terms; square_item_id is plumbing. Everything else is MOVIE_PUBLIC_COLUMNS
--    in src/lib/movieColumns.ts, which every anon read of movies names (feed,
--    showing page, festival page, Worker share previews, embedded
--    `movies(title, ...)` selects). Revoking the table grant also revokes every
--    column grant on it, so the whole public list is granted again here.
--    authenticated keeps its table grant: the admin film form and box-office
--    receipts read the terms, and RLS cannot hide a column per role.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.movies FROM anon;
GRANT SELECT (
  id, title, description, poster_url, duration_minutes, rating, genre,
  is_active, created_at, updated_at, trailer_url, is_featured, release_year,
  release_label, pass_processing_fee, ticket_type, rsvp_url, show_runtime
) ON public.movies TO anon;

-- ---------------------------------------------------------------------------
-- 2. qbo_connection. 20260617055253 gave authenticated the metadata columns
--    only, never the two Vault secret ids. The loop gave them back. RLS still
--    limits the rows to admins; this keeps the secret ids from them too, as
--    that migration intended. No client reads this table (qbo-sync uses the
--    service role).
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.qbo_connection FROM authenticated;
GRANT SELECT (
  id, realm_id, token_expires_at, environment, connected_at, connected_by,
  is_active, created_at, updated_at
) ON public.qbo_connection TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. sponsorship_opportunities. Back to 20260701185308: no contact columns for
--    anon, and no created_by (L19). No public page reads this table any more
--    (src/pages/Sponsors.tsx dropped the query); the admin screens are
--    authenticated.
-- ---------------------------------------------------------------------------
REVOKE SELECT (contact_name, contact_title, created_by)
  ON public.sponsorship_opportunities FROM anon;

-- ---------------------------------------------------------------------------
-- 4. Staff ids out of public reads (L19). These four tables were table-granted
--    to anon, so anyone could map a published bio or an upload to an auth
--    uuid, then ask has_role() whether that uuid is an admin. Each public page
--    already names its columns, none of them these:
--      staff_bios          About.tsx (STAFF_BIO_PUBLIC_COLUMNS)
--      featured_slides     useFeaturedSlides.ts (SLIDE_COLUMNS)
--      pass_type_showings  FilmPassDetail.tsx, SilentFilmFestival.tsx,
--                          passEligibility.fetchShowingEligibility
--      festival_programs   SilentFilmFestival.tsx
--      backstage_photos    Backstage.tsx
--      concession_menus    Concessions.tsx
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.staff_bios FROM anon;
GRANT SELECT (
  id, name, title, bio, headshot_url, display_on_about, sort_order, is_active,
  created_at, updated_at
) ON public.staff_bios TO anon;

REVOKE SELECT ON public.featured_slides FROM anon;
GRANT SELECT (
  id, title, blurb, image_path, image_alt, link_url, cta_label, is_active,
  display_order, starts_at, ends_at, created_at, updated_at
) ON public.featured_slides TO anon;

REVOKE SELECT ON public.pass_type_showings FROM anon;
GRANT SELECT (id, pass_type_id, showing_id, created_at)
  ON public.pass_type_showings TO anon;

REVOKE SELECT ON public.festival_programs FROM anon;
GRANT SELECT (
  id, festival_slug, year, title, file_path, file_type, display_order,
  is_published, created_at, thumbnail_path, generated_from
) ON public.festival_programs TO anon;

REVOKE SELECT ON public.backstage_photos FROM anon;
GRANT SELECT (id, caption, file_path, display_order, is_published, created_at)
  ON public.backstage_photos TO anon;

REVOKE SELECT ON public.concession_menus FROM anon;
-- notes is the admin's own annotation on an upload (ConcessionMenusTab), not
-- copy; the public page reads label and file_path.
GRANT SELECT (id, label, file_path, is_active, created_at, updated_at)
  ON public.concession_menus TO anon;

-- ---------------------------------------------------------------------------
-- 5. Tables anon holds SELECT on but no policy lets anon see a row of. The
--    loop granted these; RLS answers [] today. Revoked so the grant list says
--    what the policies already mean, and so the allowlist test has nothing to
--    excuse. Only admin screens read them.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON public.film_pass_orders, public.audit_suppression,
  public.square_link_dismissals FROM anon;

-- ---------------------------------------------------------------------------
-- 6. Privileges no client role uses. On a project with Supabase's legacy
--    default ACL (production, by the 08-14 audit's evidence) every table
--    carries TRUNCATE, TRIGGER and REFERENCES for anon and authenticated.
--    PostgREST cannot issue any of them, and TRUNCATE ignores RLS entirely, so
--    they are pure exposure if any other path to SQL ever opens. No-op where
--    the defaults are absent (staging).
-- ---------------------------------------------------------------------------
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
