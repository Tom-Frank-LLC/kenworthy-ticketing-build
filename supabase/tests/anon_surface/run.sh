#!/bin/sh
# Replays every migration into a throwaway postgres:15, twice — once with
# Supabase's legacy default privileges (production-like) and once without
# (staging-like) — and in each:
#   1. runs surface.sql, the anon allowlist; any row it returns fails the run;
#   2. runs behaviour.sql, the role-switched cases for the 2026-10-06 fixes.
# From the repo root:  sh supabase/tests/anon_surface/run.sh
# KEEP=1 leaves the last container (kwanon) running for poking at.
set -e
cd "$(dirname "$0")/../../.."
T=supabase/tests/anon_surface
C=kwanon

# The one migration that cannot replay: a data fix whose anchor showing only
# exists on the real databases. It creates no schema.
KNOWN_FAIL="20260812180000_showings_pacific_not_mountain.sql"

# The app's own select strings, so a column added to one of them without a
# grant fails here rather than on the live site.
const() { sed -n "/$2 *=/,/;/p" "$1" | tr -d '\n' | sed -E "s/.*=[^']*'([^']*)'.*/\1/"; }
MOVIE_COLS=$(const src/lib/movieColumns.ts MOVIE_PUBLIC_COLUMNS)
STAFF_COLS=$(const src/lib/staffBios.ts STAFF_BIO_PUBLIC_COLUMNS)
SLIDE_COLS=$(const src/lib/featuredSlides.ts SLIDE_COLUMNS)
DISCOUNT_COLS=$(const src/lib/discounts.ts COLUMNS)
for v in "$MOVIE_COLS" "$STAFF_COLS" "$SLIDE_COLS" "$DISCOUNT_COLS"; do
  case "$v" in id*) ;; *) echo "could not read a column constant from src/: '$v'"; exit 1;; esac
done

fail=0
for model in legacy staging; do
  echo "=============== $model default privileges ==============="
  docker rm -f $C >/dev/null 2>&1 || true
  docker run --rm -d --name $C -e POSTGRES_PASSWORD=pw postgres:15 >/dev/null
  until docker exec $C pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  sleep 2
  psql_() { docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
  psql_ < $T/stub.sql
  [ $model = legacy ] && psql_ < $T/legacy_defaults.sql

  for f in $(ls supabase/migrations/*.sql | sort); do
    b=$(basename $f)
    # pg_net / pg_cron are not in the stock image; the stub provides their schemas.
    if ! sed -E 's/^[[:space:]]*CREATE EXTENSION IF NOT EXISTS (pg_net|pg_cron)[^;]*;/-- stripped/I' $f \
         | psql_ >/tmp/kwanon.$$ 2>&1; then
      if [ "$b" = "$KNOWN_FAIL" ]; then :; else
        echo "MIGRATION FAILED: $b"; cat /tmp/kwanon.$$; fail=1
      fi
    fi
  done
  rm -f /tmp/kwanon.$$

  echo "--- surface.sql (rows are violations)"
  out=$(docker exec -i $C psql -U postgres -At -F ' | ' < $T/surface.sql)
  if [ -n "$out" ]; then echo "$out"; fail=1; else echo "none"; fi

  echo "--- behaviour.sql"
  psql_ < $T/behaviour_setup.sql
  docker exec -i $C psql -U authenticator -d postgres -v ON_ERROR_STOP=1 -q -P pager=off \
    -v movie_cols="$MOVIE_COLS" -v staff_cols="$STAFF_COLS" \
    -v slide_cols="$SLIDE_COLS" -v discount_cols="$DISCOUNT_COLS" \
    < $T/behaviour.sql || fail=1
done

[ -n "$KEEP" ] || docker rm -f $C >/dev/null
[ $fail = 0 ] && echo "ALL PASS" || { echo "FAILED"; exit 1; }
