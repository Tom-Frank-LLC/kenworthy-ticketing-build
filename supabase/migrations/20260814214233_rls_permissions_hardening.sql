-- RLS / permissions hardening before launch.
--
-- Audit record: docs/briefs/FINDINGS-rls-security-audit.md
--
-- Context: patron/member login is gone, so `authenticated` now means staff /
-- admin / superadmin only. Patrons are `anon` and reach their own data solely
-- through token-gated SECURITY DEFINER functions and service-role edge
-- functions. Every grant and policy below is re-cut against that trust model.
--
-- The audit measured both projects. Their POLICIES are byte-identical; their
-- GRANTS have drifted apart, and each has a different half of the problem:
--
--   * production carries legacy Lovable-era grants that hand `anon`
--     INSERT/UPDATE/DELETE on 20 tables including user_roles, tickets and
--     profiles. Only the RLS policy stands between the public and those writes.
--   * staging was built fresh from migrations and is missing grants the app
--     actually needs, so staff ticket sales fail there.
--
-- So this migration does NOT copy one environment onto the other. It states the
-- intended privilege set for each table explicitly, and both projects converge
-- on it.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. user_roles: writing a row here grants a role, so it is the privilege
--    escalation surface. Measured on production: a plain `admin` could INSERT
--    their own 'superadmin' row and DELETE every other role row, including the
--    real superadmin's. Two layers were wrong -- the policies name `admin`
--    (wrong on BOTH projects), and production also holds the table grant that
--    lets those policies be reached at all.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;

-- "Superadmins insert roles" / "Superadmins delete roles" already exist and are
-- correct; they are now the only INSERT/DELETE policies.
--
-- HostManagementTab assigns the host role with an upsert (ON CONFLICT DO
-- UPDATE), which needs an UPDATE path; there was none, so re-assigning an
-- existing host failed. Adding it superadmin-only keeps all three verbs on this
-- table behind the same principal instead of leaving UPDATE as an odd gap.
DROP POLICY IF EXISTS "Superadmins update roles" ON public.user_roles;
CREATE POLICY "Superadmins update roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'superadmin'::app_role));

-- Layer two. anon has no business here at all. `authenticated` keeps the write
-- privileges because the superadmin UI (Superadmin.tsx, HostManagementTab)
-- writes this table directly from the client -- but the policies above are now
-- the gate, and they name superadmin only.
--
-- Revoking the grant outright was tried and rejected: it also locks superadmin
-- out, since a policy can only be reached through a grant. The escalation is
-- closed by the policy naming the right principal, not by removing the door.
REVOKE ALL ON public.user_roles FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. anon must not hold write privileges anywhere except the one public form.
--    Sweep every table, then re-grant the single intended exception. Written as
--    a loop so tables added by other sessions (or later migrations) are covered
--    rather than silently missed.
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- The public rental enquiry form. Its WITH CHECK already pins status, contract
-- state and every signature/invoice column, so a submitter cannot pre-approve
-- their own booking.
GRANT INSERT ON public.rental_requests TO anon;

-- ---------------------------------------------------------------------------
-- 3. anon SELECT: keep public content readable, revoke everything else.
--    RLS already returns zero rows for anon on these tables, but a grant plus a
--    single policy is one layer of defence. Patron data is reached through
--    ticket-access / film-pass-checkout / get_rental_request_by_token, all of
--    which are SECURITY DEFINER or service-role and so do not need these grants.
-- ---------------------------------------------------------------------------

REVOKE SELECT ON
  public.tickets,
  public.donations,
  public.profiles,
  public.rental_requests,
  public.rental_invoice_lines,
  public.user_film_passes,
  public.film_pass_redemptions,
  public.dvd_rentals,
  public.admin_audit_log,
  public.financial_entries,
  public.payroll_exports,
  public.chart_of_accounts,
  public.account_mappings,
  public.qbo_connection,
  public.qbo_sync_jobs,
  public.labor_settings,
  public.staff_square_links,
  public.shift_requests,
  public.host_event_assignments,
  public.concession_sales,
  public.concession_sale_items,
  public.signing_keys
FROM anon;

-- signing_keys holds the contract-signing crypto keys. Service role only: it
-- has no policies at all, so RLS already denies every client, but neither client
-- role should hold a privilege on it either.
REVOKE ALL ON public.signing_keys FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Finance reference data was readable by ANY authenticated session.
--    Measured: `SELECT USING (true)` to authenticated exposed all 88
--    account_mappings and all 124 chart_of_accounts rows to a staff-only
--    account. Both are admin+ surfaces in the UI.
--
--    resolve_account_id() is SECURITY DEFINER and so keeps working for the
--    posting paths that need a mapping without granting the reader the table.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Authenticated read mappings" ON public.account_mappings;
DROP POLICY IF EXISTS "Admins read mappings" ON public.account_mappings;
CREATE POLICY "Admins read mappings"
  ON public.account_mappings FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Authenticated can read accounts" ON public.chart_of_accounts;
DROP POLICY IF EXISTS "Admins read accounts" ON public.chart_of_accounts;
CREATE POLICY "Admins read accounts"
  ON public.chart_of_accounts FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- ---------------------------------------------------------------------------
-- 5. admin_audit_log: read is admin+, not staff. It is the record of who did
--    what across the whole admin surface (12,280 rows on production) and its
--    only reader is AuditLog.tsx, an admin screen.
--
--    INSERT stays open to staff so the log_audit_event() trigger records their
--    actions; there is deliberately no UPDATE or DELETE policy, which is what
--    makes the log append-only.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admins and staff can view audit log" ON public.admin_audit_log;
DROP POLICY IF EXISTS "Admins can view audit log" ON public.admin_audit_log;
CREATE POLICY "Admins can view audit log"
  ON public.admin_audit_log FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

REVOKE UPDATE, DELETE ON public.admin_audit_log FROM authenticated;

-- ---------------------------------------------------------------------------
-- 6. donations: drop the dead patron INSERT policy. It was written for patrons
--    (`user_id = auth.uid()`), and with patron sessions gone its only remaining
--    effect is to let any staff account file a donation attributed to itself in
--    a financial table. StaffPOS already routes the counter donation through the
--    service role for exactly this reason -- see its comment: "the donations
--    table grants INSERT to service_role alone".
--
--    The dead own-row SELECT policy is left in place: it is harmless, and the
--    membership model is meant to come back.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Authenticated users can insert own donations" ON public.donations;
REVOKE INSERT, UPDATE, DELETE ON public.donations FROM authenticated;

-- ---------------------------------------------------------------------------
-- 7. sponsorship_opportunities: restore the column-level grant.
--    20260701020754 deliberately withheld contact_email and contact_phone from
--    anon. 20260810165116 then ran a blanket `GRANT SELECT ON <every table> TO
--    anon` to fix unrelated inconsistent grants, which silently promoted anon
--    back to full-row access -- a table-wide grant supersedes column grants.
--    Verified before this migration: anon could read the contact email and
--    phone on both projects.
--
--    Columns are listed explicitly rather than derived, so that a column added
--    later is withheld from anon by default instead of being exposed by default.
-- ---------------------------------------------------------------------------

REVOKE SELECT ON public.sponsorship_opportunities FROM anon;
GRANT SELECT (
  id, slug, title, tagline, intro_text, hook_text, cta_label,
  section_heading, section_body, benefits, stats_text, price_text,
  availability_text, contact_name, contact_title, hero_image_url,
  display_order, is_active, created_by, created_at, updated_at
) ON public.sponsorship_opportunities TO anon;

-- ---------------------------------------------------------------------------
-- 8. Grants that the policies already gate but that staging never received.
--    tickets is the live one: StaffPOS.tsx and HostDashboard.tsx insert ticket
--    rows directly from the client, and the audit measured a staff principal
--    being refused on staging -- box office sales fail there today. Production
--    works only by accident of a legacy grant.
--
--    Each privilege below corresponds to an existing policy:
--      tickets  INSERT "Staff can sell tickets", "Hosts can issue tickets..."
--               UPDATE "Admins can update tickets", "Hosts can update tickets..."
--               DELETE "Admins can delete tickets"
--      profiles UPDATE "Users can update own profile" (own row only; used by
--               lib/mailchimp.ts to cache LTV figures on the caller's own row)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO authenticated;
GRANT UPDATE ON public.profiles TO authenticated;

-- profiles INSERT/DELETE stay closed: rows are created by handle_new_user(),
-- which is SECURITY DEFINER, and are never deleted by a client.
REVOKE INSERT, DELETE ON public.profiles FROM authenticated;

-- ---------------------------------------------------------------------------
-- 9. Keep future tables closed by default. The ensure_rls event trigger already
--    turns RLS on for every new table in public; this stops a new table from
--    arriving with write privileges for the public role.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;

-- ---------------------------------------------------------------------------
-- 10. Decouple the showings read policy from a grant on host_event_assignments.
--
--     An RLS policy's subquery runs as the INVOKING role, not as the policy
--     author. "Hosts can view assigned showings" hand-rolls an EXISTS over
--     host_event_assignments, so every role that reads showings also needed
--     SELECT on host_event_assignments just to evaluate the policy -- including
--     anon, reading the public showtimes. Revoking that grant in section 3 above
--     therefore broke anon's read of showings outright (42501), which the
--     post-migration regression run caught.
--
--     is_host_of() is SECURITY DEFINER and already exists; the sibling policies
--     "Hosts can insert/update/delete assigned showings" all use it. Using it
--     here too removes the hidden grant dependency and makes the four showings
--     host policies consistent.
--
--     The predicate is unchanged: `ha.event_id IS NOT NULL AND ha.event_id = X`
--     and `X IS NOT NULL AND ha.event_id = X` are equivalent, since the equality
--     already implies both sides are non-null.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Hosts can view assigned showings" ON public.showings;
CREATE POLICY "Hosts can view assigned showings"
  ON public.showings FOR SELECT
  USING (is_host_of(auth.uid(), event_id, live_performance_id, movie_id));

-- ---------------------------------------------------------------------------
-- 11. Dead privileges: grants held by `authenticated` for which no policy of
--     that command exists, so RLS refuses them anyway. Harmless today, but they
--     are the exact shape that turns into an exposure the moment somebody adds a
--     permissive policy -- and they were the last remaining difference between
--     the two projects. Removing them makes production and staging identical, so
--     the next drift is visible in a diff instead of hiding.
--
--       concession_sale_items  UPDATE  -- no UPDATE policy (voids go through admin)
--       host_event_assignments UPDATE  -- no UPDATE policy (assignments are add/remove)
--       seats                  I/U/D   -- seats has a SELECT policy and nothing else
-- ---------------------------------------------------------------------------

REVOKE UPDATE ON public.concession_sale_items  FROM authenticated;
REVOKE UPDATE ON public.host_event_assignments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.seats  FROM authenticated;

COMMIT;
