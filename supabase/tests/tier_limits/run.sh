#!/bin/sh
# Per-tier ticket limits against a throwaway postgres:15. From the repo root:
#   sh supabase/tests/tier_limits/run.sh
# before.sql pins the SHIPPED behaviour (no tier has a limit); the migration
# then runs over that data; test.sql asserts the limit, the availability RPC
# and the writer; race.sh proves two buyers cannot both take the last seat of
# a limited tier.
set -e
cd "$(dirname "$0")/../../.."
T=supabase/tests/tier_limits
docker rm -f pgtierlim >/dev/null 2>&1 || true
docker run --rm -d --name pgtierlim -e POSTGRES_PASSWORD=pw postgres:15 >/dev/null
until docker exec pgtierlim pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2 # pg_isready answers during the init restart; the real server follows it
docker exec pgtierlim psql -U postgres -q -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;"
run() { docker exec -i pgtierlim psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
run < $T/stub.sql
run < supabase/migrations/20260812170000_showing_capacity_enforcement.sql
run < supabase/migrations/20260922174957_price_tiers_reconcile.sql
run < $T/before.sql
run < supabase/migrations/20261123060222_tier_ticket_limits.sql
run < $T/test.sql
sh $T/race.sh
[ -n "$KEEP" ] || docker rm -f pgtierlim >/dev/null
