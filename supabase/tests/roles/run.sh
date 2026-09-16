#!/bin/sh
# Runs the user_roles RLS policy tests against a throwaway postgres:15.
# From the repo root:  sh supabase/tests/roles/run.sh
set -e
cd "$(dirname "$0")/../../.."
T=supabase/tests/roles
docker rm -f pgroles >/dev/null 2>&1 || true
docker run --rm -d --name pgroles -e POSTGRES_PASSWORD=pw postgres:15 >/dev/null
until docker exec pgroles pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
# The roles must exist first -- the GRANTs die without them.
docker exec pgroles psql -U postgres -q -c \
  "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;"
run() { docker exec -i pgroles psql -U postgres -v ON_ERROR_STOP=1 -q < "$1"; }
run $T/stub.sql
run supabase/migrations/20260812063211_has_role_hierarchy.sql
run $T/baseline.sql
run supabase/migrations/20260916080513_admin_scoped_role_management.sql
docker exec -i pgroles psql -U postgres -v ON_ERROR_STOP=1 < $T/roles_test.sql
docker rm -f pgroles >/dev/null
