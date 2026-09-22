#!/bin/sh
# Price-tier reconcile tests against a throwaway postgres:15. From the repo root:
#   sh supabase/tests/price_tiers/run.sh
# before.sql seeds production's duplicate-tier damage and proves the mechanism
# against the SHIPPED trigger; the migration then runs; after.sql asserts the
# repair, the unique index and set_showing_price_tiers().
set -e
cd "$(dirname "$0")/../../.."
T=supabase/tests/price_tiers
docker rm -f pgtiers >/dev/null 2>&1 || true
docker run --rm -d --name pgtiers -e POSTGRES_PASSWORD=pw postgres:15 >/dev/null
until docker exec pgtiers pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2 # pg_isready answers during the init restart; the real server follows it
docker exec pgtiers psql -U postgres -q -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;"
run() { docker exec -i pgtiers psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
run < $T/stub.sql
# The shipped no-ticket trigger, straight from its migration, so the baseline
# is what production runs today.
sed -n '195,224p' supabase/migrations/20260827113402_showings_no_ticket_required.sql | run
run < $T/before.sql
run < supabase/migrations/20260922174957_price_tiers_reconcile.sql
run < $T/after.sql
[ -n "$KEEP" ] || docker rm -f pgtiers >/dev/null
