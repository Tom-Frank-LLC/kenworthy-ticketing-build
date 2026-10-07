-- What the public (the `anon` role) can reach, against an explicit allowlist.
-- Read-only: catalog queries only, no writes, no SET ROLE. Returns one row per
-- violation and nothing when the database matches the allowlist.
--
--   replay:  sh supabase/tests/anon_surface/run.sh
--   live:    npx supabase db query --linked -f supabase/tests/anon_surface/surface.sql
--
-- Why it exists: 20260810165116 granted SELECT on every table to anon to fix
-- an unrelated inconsistency, and silently turned two column restrictions back
-- into full-row grants (sponsorship contact details, found 08-14; film-rental
-- terms on movies, found 10-06). A function "revoked FROM PUBLIC" stayed
-- callable by anon on any project with Supabase's legacy default ACL. Neither
-- produced an error anywhere. This query is the error.
--
-- Changing the allowlist is a decision, not a fix-up: a new public table or
-- column, or a new anon-callable function, belongs here only once someone has
-- decided the public should have it. Say why in the commit.

WITH
-- Tables anon may SELECT whole. Row visibility is still RLS's job; this is
-- only "may name any column".
table_allow(t) AS (VALUES
  ('app_config'), ('backstage_page_content'), ('concession_combo_items'),
  ('concession_items'), ('dvd_settings'), ('dvds'), ('events'),
  ('festival_years'), ('festivals'), ('film_pass_types'),
  ('historical_screenings'), ('job_postings'), ('kenworthy_history'),
  ('live_performances'), ('press_articles'), ('press_page_content'),
  ('production_price_tiers'), ('production_seat_tiers'), ('seats'),
  ('showing_price_tiers'), ('showing_seat_tiers'), ('showings'),
  ('ticket_discounts'), ('venue_seats'), ('venues')
),
-- Tables anon may SELECT only these columns of. A table here must NOT also
-- hold a table-level grant: that is exactly the regression this file exists for.
column_allow(t, c) AS (
  SELECT 'movies', unnest(ARRAY[  -- = MOVIE_PUBLIC_COLUMNS, src/lib/movieColumns.ts
    'id','title','description','poster_url','duration_minutes','rating','genre',
    'is_active','created_at','updated_at','trailer_url','is_featured',
    'release_year','release_label','pass_processing_fee','ticket_type',
    'rsvp_url','show_runtime'])
  UNION ALL SELECT 'sponsorship_opportunities', unnest(ARRAY[
    'id','slug','title','tagline','intro_text','hook_text','cta_label',
    'section_heading','section_body','benefits','stats_text','price_text',
    'availability_text','hero_image_url','display_order','is_active',
    'created_at','updated_at'])
  UNION ALL SELECT 'staff_bios', unnest(ARRAY[
    'id','name','title','bio','headshot_url','display_on_about','sort_order',
    'is_active','created_at','updated_at'])
  UNION ALL SELECT 'featured_slides', unnest(ARRAY[
    'id','title','blurb','image_path','image_alt','link_url','cta_label',
    'is_active','display_order','starts_at','ends_at','created_at','updated_at'])
  UNION ALL SELECT 'pass_type_showings', unnest(ARRAY[
    'id','pass_type_id','showing_id','created_at'])
  UNION ALL SELECT 'festival_programs', unnest(ARRAY[
    'id','festival_slug','year','title','file_path','file_type','display_order',
    'is_published','created_at','thumbnail_path','generated_from'])
  UNION ALL SELECT 'backstage_photos', unnest(ARRAY[
    'id','caption','file_path','display_order','is_published','created_at'])
  UNION ALL SELECT 'concession_menus', unnest(ARRAY[
    'id','label','file_path','is_active','created_at','updated_at'])
),
-- Functions anon may EXECUTE (any overload of the name). Trigger functions
-- are excluded below: they cannot be called outside a trigger.
function_allow(f, why) AS (VALUES
  -- SECURITY DEFINER, deliberately public
  ('get_rental_request_by_token', 'the renter''s contract link; the token is the capability'),
  ('get_contract_signature',      'the /verify page printed on a signed contract'),
  ('get_public_availability',     'the public rental calendar'),
  ('showing_availability',        'seat counts on the showing page'),
  ('showing_ends_at',             'end-of-show rule; read by the pricing path'),
  ('quote_ticket_order',          'the checkout price preview'),
  ('log_failed_staff_login',      'staff sign-in page, before there is a session'),
  ('has_role',                    'called by the SELECT policies anon evaluates; revoking it breaks every public read'),
  -- Supabase's ensure_rls event trigger (made on the projects, not by a
  -- migration, so the replay never sees it). It returns event_trigger, which
  -- the trigger exclusion below does not cover. An event_trigger function
  -- cannot be called directly ("trigger functions can only be called as
  -- triggers"), so anon's EXECUTE on it is inert.
  ('rls_auto_enable',             'ensure_rls event-trigger function; cannot be called directly, so EXECUTE is inert'),
  -- SECURITY INVOKER pure helpers: run with anon's own rights, read nothing
  ('ticket_hold_window', 'constant'), ('door_grace_window', 'constant'),
  ('audit_is_secret_key', 'pure'), ('audit_redact', 'pure'), ('audit_uuid_or_null', 'pure'),
  ('round_half_even_div', 'pure'), ('order_tax_cents', 'pure'),
  ('canonical_tier_name', 'pure'), ('ticket_discount_cents', 'pure'),
  ('processing_fee_cents', 'pure')
),
-- Functions neither anon nor authenticated may EXECUTE: service role only.
service_only(f) AS (VALUES
  ('audit_bulk_begin'), ('audit_bulk_end'), ('resolve_account_id'),
  ('price_ticket_order'), ('redeem_film_pass'), ('activate_film_pass'),
  ('admit_with_film_pass'), ('check_rate_limit'), ('qbo_get_active_tokens'),
  ('qbo_save_tokens_service'), ('run_square_catalog_guard_check')
),
rels AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
),
funcs AS (
  SELECT p.oid, p.proname, p.prosecdef
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.prokind = 'f'
    AND p.prorettype <> 'trigger'::regtype
),
violations(kind, object, detail) AS (
  -- 1. Table-level SELECT outside the table allowlist.
  SELECT 'table select', r.relname,
         CASE WHEN r.relname IN (SELECT t FROM column_allow)
              THEN 'table-level grant on a column-restricted table: a blanket GRANT has undone its column list'
              ELSE 'anon can SELECT this table and it is not in table_allow' END
  FROM rels r
  WHERE has_table_privilege('anon', r.oid, 'SELECT')
    AND r.relname NOT IN (SELECT t FROM table_allow)

  -- 2. Column-level SELECT outside the column allowlist.
  UNION ALL
  SELECT 'column select', r.relname || '.' || a.attname,
         'anon can SELECT this column and it is not in column_allow'
  FROM rels r
  JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE NOT has_table_privilege('anon', r.oid, 'SELECT')
    AND has_column_privilege('anon', r.oid, a.attnum, 'SELECT')
    AND (r.relname, a.attname::text) NOT IN (SELECT t, c FROM column_allow)

  -- 3. Any write-class privilege at all. Every public write goes through an
  --    edge function or a SECURITY DEFINER RPC.
  UNION ALL
  SELECT 'table write', r.relname, 'anon holds ' || p.priv
  FROM rels r
  CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
  WHERE CASE WHEN p.priv IN ('INSERT', 'UPDATE')
             THEN has_any_column_privilege('anon', r.oid, p.priv)
             ELSE has_table_privilege('anon', r.oid, p.priv) END

  -- 4. Anything anon can read must sit behind RLS.
  UNION ALL
  SELECT 'rls off', r.relname, 'anon can SELECT and row level security is disabled'
  FROM rels r
  WHERE r.relkind IN ('r', 'p') AND NOT r.relrowsecurity
    AND has_any_column_privilege('anon', r.oid, 'SELECT')

  -- 5. Functions anon can execute outside the allowlist.
  UNION ALL
  SELECT 'function execute', f.oid::regprocedure::text,
         CASE WHEN f.prosecdef THEN 'SECURITY DEFINER, ' ELSE '' END
           || 'anon can EXECUTE and it is not in function_allow'
  FROM funcs f
  WHERE has_function_privilege('anon', f.oid, 'EXECUTE')
    AND f.proname NOT IN (SELECT f FROM function_allow)

  -- 6. Service-only functions reachable from any client session.
  UNION ALL
  SELECT 'service only', f.oid::regprocedure::text, r || ' can EXECUTE'
  FROM funcs f CROSS JOIN (VALUES ('anon'), ('authenticated')) x(r)
  WHERE f.proname IN (SELECT f FROM service_only)
    AND has_function_privilege(x.r, f.oid, 'EXECUTE')

  -- 7. The other direction: a policy anon evaluates that calls a function
  --    anon cannot execute. Postgres checks EXECUTE on every function in a
  --    policy before running it, so this is every public read of that table
  --    failing with 42501. Catches an over-eager revoke.
  UNION ALL
  SELECT 'policy needs function', r.relname || ': ' || pol.polname,
         'anon evaluates this policy and cannot EXECUTE ' || d.refobjid::regprocedure::text
  FROM pg_policy pol
  JOIN rels r ON r.oid = pol.polrelid
  JOIN pg_depend d ON d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
                  AND d.refclassid = 'pg_proc'::regclass
  WHERE (0 = ANY (pol.polroles) OR 'anon'::regrole = ANY (pol.polroles))
    AND pol.polcmd IN ('r', '*')
    AND has_any_column_privilege('anon', r.oid, 'SELECT')
    AND NOT has_function_privilege('anon', d.refobjid, 'EXECUTE')

  -- 8. Storage: no policy may let anon read storage.objects. Public buckets
  --    serve files by URL without one; a SELECT policy only adds listing.
  UNION ALL
  SELECT 'storage policy', pol.polname,
         'anon can list storage objects: ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), 'true')
  FROM pg_policy pol
  WHERE pol.polrelid = 'storage.objects'::regclass
    AND pol.polcmd IN ('r', '*')
    AND (0 = ANY (pol.polroles) OR 'anon'::regrole = ANY (pol.polroles))
)
SELECT kind, object, detail FROM violations ORDER BY kind, object;
