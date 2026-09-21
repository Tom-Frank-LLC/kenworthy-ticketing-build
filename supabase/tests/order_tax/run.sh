#!/bin/sh
# Runs the order-level tax trigger tests against a throwaway postgres:15.
# From the repo root:  sh supabase/tests/order_tax/run.sh
set -e
cd "$(dirname "$0")/../../.."
T=supabase/tests/order_tax
docker rm -f pgordertax >/dev/null 2>&1 || true
docker run --rm -d --name pgordertax -e POSTGRES_PASSWORD=pw postgres:15 >/dev/null
until docker exec pgordertax pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2 # pg_isready answers during the init restart; the real server follows it
docker exec pgordertax psql -U postgres -q -c \
  "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;"
run() { docker exec -i pgordertax psql -U postgres -v ON_ERROR_STOP=1 -q < "$1"; }
run $T/stub.sql
# The OLD rule, from the real migration, so the baseline is what production does today.
run supabase/migrations/20260819040000_film_pass_redemption_untaxed.sql
run $T/trigger.sql
# The migration under test.
run supabase/migrations/20260921200433_order_level_tax.sql
# The same vectors the Deno and vitest suites assert: Square's own totals.
docker cp supabase/functions/_shared/pricing_vectors.json pgordertax:/tmp/pricing_vectors.json
docker exec -i pgordertax psql -U postgres -v ON_ERROR_STOP=1 -q < $T/order_tax_test.sql
docker rm -f pgordertax >/dev/null
