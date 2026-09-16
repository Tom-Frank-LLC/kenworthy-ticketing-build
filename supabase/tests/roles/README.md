# user_roles policy tests

`user_roles` is the privilege-escalation table: writing a row there grants a
role. Migration `20260916080513_admin_scoped_role_management.sql` opens it to
admins for the lower roles only, and these cases are what keep that door the
size it was cut. Nothing in `npm run build` or vitest runs a policy. These run
the real migration, with the real hierarchical `has_role()`, against a
throwaway container in under a minute — no Supabase link, no database password,
no risk to staging or production.

```sh
sh supabase/tests/roles/run.sh
```

The runner streams four files into a fresh `postgres:15`: `stub.sql` (auth
schema, enum, table), the real `has_role` migration, `baseline.sql` (the
superadmin policies production already had, copied verbatim, plus probe
helpers), then the migration under test, and finally `roles_test.sql`. It exits
non-zero if any case fails.

**How a probe works.** Every write runs inside a subtransaction and then raises
a private error code to roll itself back, so the verdict comes out while the
fixture stays intact (case 52 checks that). INSERT and UPDATE `WITH CHECK`
denials raise `insufficient_privilege`; DELETE and UPDATE `USING` denials raise
nothing and match zero rows, which is why the row count is the verdict there.
All probes run after `SET ROLE authenticated`, so they see exactly what
PostgREST sees.

**The harness can fail.** Run with the baseline only (skip the migration and
stub `is_protected_user` to return false) and exactly the twelve "admin
allowed" cases fail while every denial holds. Done 2026-09-16; do it again if
you change the probes.

**The other half of this rule is in TypeScript.** `invite-staff` runs as
service_role, which RLS never sees, so it applies the same rule by hand from
`supabase/functions/_shared/role_management.ts`. Its test names the case here it
mirrors. Change one, change both.

See `docs/briefs/BRIEF-admin-account-role-management.md` for the model.
