# Brief (for Claude Code): Full RLS / permissions audit before launch

**Status:** ✅ Shipped — corrective migration `20260814214233_rls_permissions_hardening.sql`. See `FINDINGS-rls-security-audit.md` for the full role x table audit.
**Date:** August 14, 2026
**Requested by:** Tom — now that member login is removed, sweep **every** table's RLS + grants for the correct posture across **anon, staff, admin, superadmin** (and service_role).

## The trust model changed — anchor the whole audit on this
With patron/member login gone, **`authenticated` now means "staff / admin / superadmin only."** Patrons are **anon**, and they reach their own data **only** through token-gated `SECURITY DEFINER` functions and service-role edge functions (`ticket-access`, `film-pass-checkout`, etc.). So every policy must be re-read against these five principals:
- **anon** — the public (patrons included). Read only what's meant to be public; write only the couple of intended public inserts (e.g. `rental_requests`). **No PII, no financials, no config.**
- **staff** — box office / door. Operational reads/writes, no finance/config/role management.
- **admin** — full operations + finance/accounting/config.
- **superadmin** — admin + the dangerous surface (role assignment, signing keys, destructive toggles).
- **service_role** — edge functions; bypasses RLS by design. Confirm each bypass is intentional and the function does its own auth/role check.

Any policy shaped "user sees their own row" (`user_id = auth.uid()`) was written for **patrons** and is now largely **dead** (no patron sessions). Keep or drop them, but ensure a table is **never** protected *only* by a now-dead patron policy.

## Fix-first findings (already visible — verify + correct)
1. **🔴 Two conflicting role sources.** `is_admin()` (migration `20260217193113`) resolves roles differently from `has_role()`/`user_roles` (`20260402…`, hierarchy in `20260812063211_has_role_hierarchy`). This already bit the app (a staff-only account couldn't see sales it rang up — LAUNCH-READINESS blocker 3). **Standardize on `has_role()` + `user_roles`** (with the role hierarchy: superadmin ⊇ admin ⊇ staff). Redefine `is_admin()` to delegate to `has_role(auth.uid(),'admin')` or replace all its call sites, so there is **one** source of truth.
2. **Confirm the `app_role` enum.** It was created as `('admin','regular_user')` (`20260217193757`) but policies use `'staff'` and the app uses superadmin/admin/staff/host. Verify later `ALTER TYPE … ADD VALUE` migrations actually added `superadmin`, `staff`, `host` — a policy referencing a non-existent enum value is a latent failure.
3. **🔴 `user_roles` is the privilege-escalation table.** Writing a row here grants a role. Its RLS must allow **INSERT/UPDATE/DELETE by superadmin only** (never staff/admin self-promotion), and `has_role()` must be `SECURITY DEFINER` + not spoofable. Audit this first.
4. **`app_config` grants `INSERT, UPDATE` to `authenticated`.** It holds sensitive config (Mailchimp/LGL/webhook secrets, toggles). RLS must restrict writes (and probably reads) to **admin/superadmin**, regardless of the broad grant.
5. **`admin_audit_log` grants `SELECT, INSERT` to `authenticated`.** SELECT should be **admin+**; INSERT is fine (append-only) but never UPDATE/DELETE by anyone.
6. **`signing_keys`** (contract-signing crypto keys) — must be **service-role only**; **no** anon or authenticated SELECT. Verify.
7. **Broad `authenticated` CRUD grants** on: `dvds`, `dvd_rentals`, `sponsorship_opportunities`, `shift_requests`, `rental_invoice_lines`, `labor_settings`, `financial_entries`, `payroll_exports`, `staff_square_links`, `concession_*`, `film_pass_redemptions [INSERT]`. Each is now only reachable by staff+ (no patrons), but the **grant is role-agnostic** — the actual gate is the RLS policy. Verify each has a policy that limits the operation to the intended role (finance/accounting → admin+, not "any authenticated").

## Method — audit every table with a role × operation matrix
For each of the **45 tables**, fill and verify a matrix (expected vs actual):

| table | anon | staff | admin | superadmin | service_role |
|---|---|---|---|---|---|
| … | R? W? | R/W ops | … | … | bypass (intended?) |

For each cell, cross-check **both** layers: the SQL **GRANT** (does the role even have the privilege) **and** the **RLS policy** (`pg_policies`), since either can silently allow/deny. A permissive policy over a broad grant is the real exposure.

Group the tables by sensitivity and apply the target posture:

- **Public content (anon read OK; writes admin/staff):** `movies, events, concerts, showings, venues, seats, venue_seats, showing_price_tiers, showing_seat_tiers, production_price_tiers, production_seat_tiers, sponsorship_opportunities, dvds, dvd_settings, kenworthy_history, historical_screenings, concession_items, concession_menus, concession_combo_items, film_pass_types`. Confirm anon reads only **public-safe columns** (use column-level grants to hide PII/contact, as `20260701020754` already does for `sponsorship_opportunities`).
- **Patron PII / transactions (anon = NONE at the table; staff+ read; writes via service-role fns):** `tickets, donations, film_pass_orders, user_film_passes, film_pass_redemptions, dvd_rentals, rental_requests, rental_invoice_lines, profiles`. anon must not read any of these directly — patron access is only through the token functions. `rental_requests` keeps its **anon INSERT** (public form) but anon must not **read** it back. `profiles` now holds invisible-patron PII → staff+/self only, anon none.
- **Staff / ops (staff+):** `shift_requests, host_event_assignments, staff_square_links, labor_settings, concession_sales, concession_sale_items`.
- **Finance / accounting (admin+):** `financial_entries, chart_of_accounts, account_mappings, qbo_connection, qbo_sync_jobs, payroll_exports`.
- **Config / security (admin or superadmin):** `app_config` (admin+), `admin_audit_log` (read admin+), `user_roles` (**write superadmin only**), `signing_keys` (**service-role only**).

## Coverage & default-deny (do not skip)
- **RLS ENABLED on all 45 tables.** A table with a GRANT but RLS *disabled* is wide open to that role. Enumerate `pg_tables` vs `pg_policies` and flag any table missing RLS.
- **Default deny:** every table should have explicit policies; no operation should be reachable just because a grant exists and no policy denies it. Confirm there's no table where the only "protection" is a now-dead patron `auth.uid()` policy.
- **`WITH CHECK` on writes:** INSERT/UPDATE policies must have `WITH CHECK` (not just `USING`) so a row can't be written into a state the writer couldn't read/own.

## Verification
1. **Static:** a script dumping, per table, `pg_policies` (cmd, roles, using, with_check) + the `information_schema.role_table_grants` — the source of truth to compare against the matrix.
2. **Live probes (the real test):** run representative reads/writes as **(a)** the anon key, **(b)** a staff JWT, **(c)** an admin JWT, **(d)** a superadmin JWT, and confirm each allowed/denied per the matrix. Especially: anon cannot read `tickets/donations/profiles/film_pass_orders/rental_requests`; staff cannot read finance/config or write `user_roles`; nobody but superadmin writes `user_roles`; anon cannot read `signing_keys`/`app_config`.
3. Run on **staging first**, then apply the same corrective migration to production.

## Deliverables
- The filled **role × operation matrix** for all 45 tables (a doc — the audit record).
- A single **corrective migration** that: unifies the role source, enables RLS anywhere missing, tightens the flagged grants/policies, and sets column-level grants to hide PII from anon.
- A short **re-test note** proving the live probes pass after the migration.

## Decisions for Tom
1. **superadmin vs admin split:** confirm which surfaces are superadmin-only — at minimum **role assignment (`user_roles`)** and **`signing_keys`**; likely also destructive config/toggles. Anything else you want reserved to superadmin?
2. **Keep or remove dead patron policies:** drop the now-unused `user_id = auth.uid()` patron policies for cleanliness, or leave them for when membership returns? (Recommend: leave the columns/model, but ensure they're never a table's sole protection.)
