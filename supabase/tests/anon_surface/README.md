# What the public can reach

`anon` is every patron and every stranger: the browser's key is public. This
directory pins what that role can read and call, against an explicit
allowlist, so that the next blanket `GRANT` or the next `REVOKE … FROM PUBLIC`
that does nothing on production fails a check instead of shipping.

Both regressions it was written for were silent. `20260810165116` granted
SELECT on every table to anon and turned two column restrictions back into
full-row grants (sponsor contact details, caught 08-14; film-rental terms on
`movies`, caught 10-06). `audit_bulk_begin` was "revoked" from PUBLIC only,
which leaves anon's direct grant standing on a project with Supabase's legacy
default ACL. Neither raised an error anywhere.

## Run it against the migrations (Docker, about a minute)

```sh
sh supabase/tests/anon_surface/run.sh
```

It replays every migration into a throwaway `postgres:15` twice: once with
Supabase's legacy default privileges (`legacy_defaults.sql`, which is how
production behaves) and once without (how staging behaves). A revoke that only
works under one of them fails the other. In each pass it runs:

- **`surface.sql`**: the allowlist. Any row it returns is a violation, and the
  run fails.
- **`behaviour.sql`**: the 2026-10-06 fixes exercised under `SET ROLE` as
  PostgREST would, as the `authenticator` login (so `session_user` is not
  postgres). It runs the refusals and also the reads the site actually makes.
  The select strings for movies, staff bios, slides and discounts are read out
  of `src/` by `run.sh` (`MOVIE_PUBLIC_COLUMNS`, `STAFF_BIO_PUBLIC_COLUMNS`,
  `SLIDE_COLUMNS`, the `COLUMNS` in `discounts.ts`), so a column added to one of
  those lists without a grant fails here and not on the live site.

One migration cannot replay (`20260812180000`, a data fix whose anchor row
exists only on the real databases); the runner expects that one failure and no
other.

## Run it against a live project (read-only)

`surface.sql` is catalog queries only: no writes, no `SET ROLE`. Run it
against the linked project and expect **zero rows**:

```sh
npx supabase db query --linked -f supabase/tests/anon_surface/surface.sql
```

Check which project is linked first (`supabase/.temp/project-ref`). This is
the check that tells you what production actually grants, which the replay
can only model. Run it after every `db push`.

## What it checks

| # | Rule |
|---|---|
| 1 | Table-level SELECT only on the tables in `table_allow`. A table in `column_allow` holding a table-level grant is reported as a blanket grant undoing its column list. |
| 2 | Column-level SELECT only on the columns in `column_allow`. |
| 3 | No INSERT, UPDATE, DELETE or TRUNCATE for anon anywhere. |
| 4 | RLS is on for every table anon can read. |
| 5 | EXECUTE only on the functions in `function_allow` (trigger functions excluded). |
| 6 | The service-only functions are executable by neither anon nor authenticated. |
| 7 | Every function a policy anon evaluates depends on is executable by anon. Postgres refuses the whole read otherwise; this catches an over-eager revoke (revoking `has_role` breaks 17 public tables). |
| 8 | No storage policy lets anon read `storage.objects`. Public buckets serve by URL without one; such a policy only adds listing. |

## Changing the allowlist

It is a decision, not a fix-up. A new public table, column, or anon-callable
function goes into `surface.sql` once someone has decided the public should
have it, with the reason in the commit. For a column-restricted table
(`movies` and the rest of `column_allow`), the migration that adds a public
column must also `GRANT SELECT (col) … TO anon`, and the page's select string
has to name it.

**The harness can fail.** Run `surface.sql` against a replay that stops before
`20261006225932`: it reports the movies blanket grant, the staff-id columns,
the six listable buckets, `resolve_account_id`, `is_host_of*`, and under
legacy defaults `audit_bulk_*` and TRUNCATE on every table. Revoke `has_role`
from anon on a fixed replay and rule 7 reports 17 policies. Both done
2026-10-06 (BRIEF-sec-rls-regressions).
