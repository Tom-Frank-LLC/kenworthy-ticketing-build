#!/bin/sh
# activate_film_pass against a throwaway postgres:15. From the repo root:
#   sh supabase/tests/film_pass_activation/run.sh
set -e
cd "$(dirname "$0")/../../.."
T=supabase/tests/film_pass_activation
docker rm -f pgfpa >/dev/null 2>&1 || true
docker run --rm -d --name pgfpa -e POSTGRES_PASSWORD=pw postgres:15 >/dev/null
until docker exec pgfpa pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
run() { docker exec -i pgfpa psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
run < $T/stub.sql
# The OLD function, verbatim from the migration that shipped it.
awk '/^CREATE OR REPLACE FUNCTION public.activate_film_pass\(/{p=1} p{print} p&&/^\$function\$;/{exit}' \
  supabase/migrations/20260813000000_film_passes_physical.sql | run
run < $T/before.sql
run < supabase/migrations/20261006225347_activate_film_pass_by_quantity.sql
run < $T/test.sql
[ -n "$KEEP" ] || docker rm -f pgfpa >/dev/null
