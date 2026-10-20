---
brief: data-api-explicit-grants
title: A schema rebuilt from migrations after Supabase's Oct 30 change keeps every Data API grant production has
status: closed-not-a-bug
track: ops
date: 2026-10-20
verified: true
closed_reason: The migrations already reproduce production's grants with no Supabase default ACL. `seats` is granted by the loop in 20260810165116, which a text search for GRANT cannot see.
evidence: anon_surface replay (staging-model pass, no default privileges) diffed against live pg privileges on both projects, 2026-10-20. Identical for every table that is in the migrations.
---

# Backfill explicit Data API grants before Supabase's Oct 30 change

**Closed, no migration needed.** The brief proposed a migration granting
`public.seats`, plus an audit for other tables with no grant. The audit shows
there is no gap, for `seats` or anything else.

## The question

From 30 Oct 2026, Supabase stops granting `anon`, `authenticated` and
`service_role` on new tables in `public`. Existing tables keep what they have,
so production is unaffected. The risk is a schema rebuilt from migrations (a
new project, a preview branch, `db reset`, a staging reset). Any table that
relied on the implicit grant would come up "permission denied".

The brief's evidence was a text diff: `CREATE TABLE public.seats` appears, and
no `GRANT … ON public.seats` does. The browser reads `seats` for the seat map
(`src/pages/Showing.tsx`) and the box office (`src/pages/staff/StaffPOS.tsx`).

## Why the text diff was wrong

Two migrations grant every table that existed when they ran, by looping over
`pg_tables` with `EXECUTE format(...)`. A grep for the table name finds neither:

- `20260810165116_grant_public_read_access.sql`: `SELECT` to `anon,
  authenticated` on every public table, `seats` included.
- `20260811190137_grant_service_role_crud.sql`: CRUD to `service_role` on every
  public table. It also sets `ALTER DEFAULT PRIVILEGES … TO service_role` for
  later tables.

`20260814214233` then revokes writes on `seats` from `authenticated`. Tables
created after August grant themselves explicitly, which is now the house style.

## How it was measured

Neither project could answer this on its own. Production carries the legacy
default ACL, so it can't show what a rebuild without one would get. The test
was the existing replay harness instead:

1. `KEEP=1 sh supabase/tests/anon_surface/run.sh` replays all 167 migrations
   into a plain `postgres:15` twice. Its second pass, the staging model, has
   **no default privileges for anon or authenticated at all**. That is at
   least as strict as a post-Oct-30 project. All 61 behaviour cases passed.
2. In that container, and on both live projects (read-only), list every public
   table's effective `SELECT/INSERT/UPDATE/DELETE` for the three API roles via
   `has_table_privilege`, plus whether any column-level `SELECT` exists.
3. Diff them.

Result:

- **Rebuild vs staging: identical.** Staging was built from migrations with no
  legacy defaults, so it already behaves like a post-Oct-30 project, and the
  seat map works there.
- **Rebuild vs production: identical** for all 65 tables in the migrations.
  The only extra rows are production's three Aug-14/15 incident snapshot tables
  (`square_catalog_snapshot_20260814`, `square_item_images_20260815`,
  `square_poster_matches_20260815`). They are service-role only and were never
  in a migration, so a rebuild correctly lacks them.
- `seats`, in all three: anon `SELECT`, authenticated `SELECT`, service_role
  CRUD. That is the grant the brief proposed, already in place.

## Going forward

Nothing changes. A new `CREATE TABLE public.X` migration must carry its own
`GRANT`s, as every migration since August has. The loops above covered only
the tables that existed in August. `anon_surface/run.sh`'s staging-model pass
is the check: a table the site reads that comes up ungranted fails
`behaviour.sql` there, provided the read is in `behaviour.sql`.
