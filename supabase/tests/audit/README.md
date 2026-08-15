# Activity-log migration tests

Nothing in `npm run build` or vitest touches a migration, and the audit trigger
is plpgsql carrying rules that matter — whether a capability token reaches the
log, whether a bulk import can silently blank it. These run the real migration
against a throwaway container in about a minute. No Supabase link, no database
password, no risk to staging or production.

```sh
docker run --rm -d --name pgaudit -e POSTGRES_PASSWORD=pw postgres:15
until docker exec pgaudit pg_isready -U postgres; do sleep 1; done

# The roles must exist first — the migration's GRANTs die without them.
docker exec pgaudit psql -U postgres -c \
  "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;"

docker exec -i pgaudit psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/audit/stub.sql
docker exec -i pgaudit psql -U postgres -v ON_ERROR_STOP=1 -q \
  < supabase/migrations/20260815015037_audit_log_coverage_and_guardrails.sql

docker exec -i pgaudit psql -U postgres -q < supabase/tests/audit/audit_log_test.sql

docker rm -f pgaudit
```

`stub.sql` stands in for the parts of the real schema the migration touches —
`auth.users`, `has_role()`, `admin_audit_log`, and the audited tables with only
the columns whose shape the trigger reacts to. `auth.uid()` is driven by a GUC
(`SET test.uid = '…'`) so a case can switch actor, or clear it to stand in for
service_role.

**The test script is not idempotent** — it seeds users with fixed uuids. Rebuild
the container between runs rather than re-running it.

**T10 is the one that will fail on you.** The redaction rule exists twice, once
in plpgsql (`audit_is_secret_key`) and once in TypeScript
(`supabase/functions/_shared/audit.ts`), because the trigger redacts row diffs
and the Deno copy redacts the `details` an edge function builds by hand, which
no trigger ever sees. T10 runs the same 24 field names through the SQL rule that
`audit_test.ts` runs through the Deno one. If you change either rule, change
both — the side that drifts loose writes a live credential into a table every
admin can read, and nothing in the log looks wrong afterwards.

Read `docs/briefs/BRIEF-activity-log-admin-only-OUTCOME.md` for what each case
is pinning and why.
