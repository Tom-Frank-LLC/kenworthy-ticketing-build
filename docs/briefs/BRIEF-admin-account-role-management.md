---
brief: admin-account-role-management
title: Admins manage staff and host accounts; only a superadmin touches admins and superadmins
status: shipped
track: security
severity: P1
date: 2026-09-15
shipped_in: ["#305"]
shipped_at: 2026-09-16
verified: true
evidence: supabase/migrations/20260916080513_admin_scoped_role_management.sql, supabase/tests/roles/, supabase/functions/_shared/role_management.ts
---

# Brief (for Claude Code): Let admins manage accounts & roles (except admins/superadmins)

## Decisions taken (2026-09-16)

All four went the recommended way. Each is enforced in the database, not the page.

1. **Admins cannot grant admin or superadmin.** The INSERT policy's allowed set is
   `staff / host / regular_user`; the function's admin set is `staff / host`.
2. **"Delete" means revoking roles.** No auth-user deletion was added; that is a
   separate brief with retention implications.
3. **Admins are protected from themselves.** `is_protected_user()` is true for any
   holder of admin or superadmin, actor included, so there is no self-elevation
   and no self-lockout. Their own row renders locked.
4. **One page, two shapes.** `/admin/accounts` (AdminOnly) renders
   `AccountsRoles.tsx`; `/superadmin` still resolves to the same page for the
   superadmin's header link. The Re-fetch posters card is superadmin-only.

One addition beyond the brief: an admin-scoped **UPDATE** policy with the same
predicate. `HostManagementTab` assigns hosts with an upsert, and Postgres checks
the UPDATE policy on the conflict path; without it a first host assignment by an
admin would succeed and a re-assignment would fail. It cannot rewrite a row
upward (WITH CHECK guards the new row) — pinned by RLS cases 32–35.

## What shipped

Deployed to production 2026-09-16 (migration pushed, `invite-staff` deployed, worker
version `795d52f7-bfd5-4291-baf3-69bd9de73f7c`; rollback is `22dac98e-767d-4271-85c9-ee1017a71740`).
All three admin policies confirmed live on production with `pg_policies`.

- **RLS** — `20260916080513_admin_scoped_role_management.sql`: `is_protected_user(uuid)`
  plus "Admins insert/delete/update lower roles" policies. Superadmin policies untouched.
- **Tests** — `supabase/tests/roles/` (52 cases against a throwaway `postgres:15`,
  including the harness-can-fail run) and `_shared/role_management_test.ts` (8 cases).
- **invite-staff** — tiered: superadmin any role; admin staff/host only, refused
  onto a protected account; writes a `user_roles.invite` audit row naming the admin.
- **UI** — `src/pages/admin/AccountsRoles.tsx`, routes in `App.tsx`, an
  "Accounts & Roles" button on the admin dashboard.

Verified on staging 2026-09-16 as a real admin account through RLS (writes rolled
back): grant staff → allowed; grant superadmin to self, grant admin, grant staff
to another admin, revoke superadmin, revoke admin from a peer → all denied.

**Status:** 🔴 Security-sensitive. `user_roles` is the privilege-escalation table; today all role management is **superadmin-only by design**. Opening it to admins must be enforced in **RLS + the edge function**, with the UI merely reflecting that — never UI-only.
**Date:** September 15, 2026
**Requested by:** Tom — give **admin** users the account/role management the superadmin has (view / add / edit accounts and roles), **except**: admins cannot delete or edit **superadmin** accounts, nor **other admin** accounts.

## Current state (verified — build `931e141`)
- **The page:** `src/pages/admin/Superadmin.tsx` (`/superadmin`) lists every profile + its `user_roles`, with **grant** (`insert user_roles`), **revoke** (`delete user_roles`), and **invite** (via the `invite-staff` edge function). It self-redirects unless `isSuperadmin`. It also hosts a superadmin-only **"Re-fetch posters"** utility (unrelated to accounts).
- **The real boundary is the server, and it is superadmin-only:**
  - `user_roles` RLS after the `…rls_permissions_hardening` migration: **only superadmin** may INSERT/UPDATE/DELETE roles; SELECT is "own roles" + "superadmins view all." The grant/revoke buttons write directly to `user_roles`, so RLS is what actually authorizes them.
  - `invite-staff` edge function: **`has_role(caller,'superadmin')` or 403**; it runs as `service_role` (bypasses RLS) and its own header comment says that's safe *only* because of the superadmin gate — `user_roles` is "the privilege-escalation table."
- **Roles:** `superadmin, admin, staff, host, regular_user`; `has_role` is hierarchical (superadmin inherits admin/staff).

## The model to implement
Define a **"protected user" = anyone who holds `admin` or `superadmin`.** An **admin actor** may manage only **non-protected** users and only the **lower roles**; a **superadmin** keeps full power.

Admin actor may:
- **View** all accounts and their roles.
- **Grant** `staff` / `host` / `regular_user` — but **only to non-protected users**.
- **Revoke** `staff` / `host` / `regular_user` — but **only from non-protected users**.
- **Invite** new accounts as **`staff` / `host`** only.

Admin actor may **NOT** (all must be server-enforced):
- Grant or revoke **`admin` or `superadmin`** to anyone (privilege escalation — **Decision 1**, strongly recommend forbidding).
- Modify or delete **any protected user** (no grant, revoke, or invite-elevate touching a user who holds admin/superadmin — including themselves).

## Enforcement — three layers, server first
### 1. RLS on `user_roles` (the true gate — do this first)
Add **admin-scoped** INSERT and DELETE policies alongside the existing superadmin ones. Recommended shape (via a SQL helper, e.g. `public.is_protected_user(uuid)` = "target holds admin or superadmin"):
- **INSERT (admin):** allowed when the actor `has_role('admin')`, the **new row's `role` ∈ {staff,host,regular_user}**, and the **target user is not protected**.
- **DELETE (admin):** allowed when the actor `has_role('admin')`, the **row's `role` ∈ {staff,host,regular_user}**, and the **target user is not protected**.
- Keep the **superadmin** policies unchanged (full power).
- **Guard the escalation edges:** an admin can't insert `admin`/`superadmin` (role not in the allowed set), can't touch a user who already holds admin/superadmin (protected), and therefore can't strip a superadmin to take over. Write RLS **tests** for each of these (a staff-only admin actor: can add staff to a regular user ✅; cannot add admin to anyone ❌; cannot remove any role from an admin/superadmin ❌).

### 2. `invite-staff` edge function
Replace "superadmin or 403" with role-scoped authorization: **superadmin** → any `INVITABLE_ROLES`; **admin** → **only `staff`/`host`**; else 403. Keep it running as `service_role`, but the server-side role check now gates *which* roles each caller may mint. Reject an admin trying to invite `admin`/`superadmin` with a clear 403. (Update the function's header comment — the "superadmin-only" invariant is changing.)

### 3. UI (`Superadmin.tsx` → open to admins in a restricted mode)
- **Access/placement (Decision 4):** expose this to admins as an **"Accounts & Roles"** entry (a new `/admin/accounts` route or an admin-dashboard section) that renders this component; keep `/superadmin` for superadmins. Recommend one component with a `mode`/role-aware render rather than a fork.
- **For an admin viewer:**
  - Rows for **protected users** (any admin/superadmin) render **read-only** — no grant buttons, no revoke "×". Show the roles, greyed, so admins can *see* who's privileged but not touch them.
  - The grantable-role buttons exclude **admin** and **superadmin**; the **invite dialog role dropdown** offers only **staff/host**.
  - Hide the **"Re-fetch posters"** card (superadmin infra).
- **Superadmin viewer:** unchanged (full controls, all roles, poster utility).
- The UI restrictions are cosmetic/clarity; the RLS + function are what actually stop a crafted request.

## Decisions for Tom
1. **Admins granting admin/superadmin:** forbid entirely (recommended — only superadmin mints admins/superadmins) vs allow admins to grant `admin` (not recommended; it lets admins expand the tier they then can't manage).
2. **"Delete accounts":** this page does **role grant/revoke + invite**, not hard auth-account deletion. Scope "delete" to **removing roles / deactivating** (recommended) — or is actual auth-user deletion wanted? (Bigger, separate; data-retention implications.)
3. **Admin editing their own account:** admins are "protected," so an admin cannot self-revoke admin or self-elevate — confirm that's intended (recommended, prevents lockout/escalation).
4. **UI placement:** an admin **"Accounts & Roles"** route/section reusing this component in restricted mode (recommended) vs relabeling `/superadmin` and opening it directly.

## Cross-cutting
- **Audit:** role grants/revokes and invites by admins must be written to the activity/audit log (same as other privileged actions), attributed to the acting admin.
- Never rely on the client gate alone — mirror the existing "browser hides, server refuses" rule; the RLS/function are the boundary.

## Test plan
- **RLS:** an admin can grant/revoke staff/host/regular_user on a non-protected user; **cannot** grant admin/superadmin to anyone; **cannot** grant/revoke *any* role on a user holding admin/superadmin; superadmin can still do everything. (Automated RLS tests for each.)
- **invite-staff:** an admin can invite staff/host; an admin inviting admin/superadmin gets 403; superadmin can invite any role.
- **UI:** an admin sees all accounts; protected rows are read-only; grantable roles and the invite dropdown exclude admin/superadmin; the poster utility is hidden; a superadmin sees the full page unchanged.
- **Escalation attempts fail at the server**, not just the UI: a hand-crafted `user_roles` insert of `admin` by an admin, or a direct `invite-staff` call as admin for role `admin`, are both rejected.
- Admin role changes appear in the audit log; `npm run build` + tests pass.
