# Testing `search_film_passes` and the pass-number backfill

`npm run build` and `vitest` cover `src/` only, and `deno check` covers the
edge functions. Neither of them executes a line of SQL, so a migration that
does the wrong thing convincingly — a backfill that assigns the right *set* of
numbers in the wrong *order*, a search that quietly misses bearer passes —
ships green.

This runs the two migrations against a real Postgres with just enough stub
schema around them, then asserts on the results.

## Running it

```sh
docker run -d --name pgtest -e POSTGRES_PASSWORD=pw -p 55442:5432 postgres:15
until docker exec pgtest pg_isready -U postgres; do sleep 1; done

docker exec -i pgtest psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/film_pass_search/stub.sql
docker exec -i pgtest psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20260814214733_film_pass_number.sql
docker exec -i pgtest psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20260814214812_search_film_passes.sql
docker exec -i pgtest psql -U postgres -q < supabase/tests/film_pass_search/assert.sql

docker rm -f pgtest
```

Every assertion prints `OK …`; the last line is `=== all assertions passed ===`.
A failure raises, so the exit status is meaningful.

## What the stub supplies, and why

`stub.sql` is not a copy of the schema — it is the smallest surface the two
migrations actually touch, plus the Supabase built-ins that do not exist in a
bare Postgres:

- **`anon` / `authenticated` / `service_role`** must exist before the migrations
  run, or every `GRANT` fails.
- **`auth.uid()` and `has_role()`** are stand-ins driven by a one-row
  `auth._who` table. Writing to that table is how a test changes who it is —
  which is what makes the role gate testable at all.
- **Four seeded passes** covering the shapes that behave differently: an
  account-linked active pass, a used-up one, a **bearer pass whose only contact
  details are on its order**, and a blank sticker. The bearer pass is the one
  that matters most: it is invisible to any search that only joins `profiles`,
  and it is also the hardest pass to find any other way.
- **Deliberately messy phone numbers** (`(208) 555-1234`, `208.555.9876`,
  `+1 (208) 555-7777`), because a phone search that only works on
  consistently-formatted input does not work.

## What is deliberately not covered here

RLS policies and grants are declared but not exercised — the stub roles have no
policies attached, and `SECURITY DEFINER` bypasses RLS anyway. The gate that
matters for these functions is the explicit `has_role` check inside them, and
that *is* tested. Verify the grants themselves against staging.
