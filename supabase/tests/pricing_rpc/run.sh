#!/bin/sh
# Pricing RPC tests against a throwaway postgres:15. From the repo root:
#   sh supabase/tests/pricing_rpc/run.sh
set -e
cd "$(dirname "$0")/../../.."
T=supabase/tests
docker rm -f pgrpc >/dev/null 2>&1 || true
docker run --rm -d --name pgrpc -e POSTGRES_PASSWORD=pw postgres:15 >/dev/null
until docker exec pgrpc pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
docker exec pgrpc psql -U postgres -q -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;"
run() { docker exec -i pgrpc psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
run < $T/order_tax/stub.sql
run < $T/ticket_discounts/stub_extra.sql
run < $T/pricing_rpc/stub_extra.sql
run < supabase/migrations/20260819040000_film_pass_redemption_untaxed.sql
run < $T/order_tax/trigger.sql
run < supabase/migrations/20260921200433_order_level_tax.sql
run < supabase/migrations/20260921203017_ticket_discounts.sql
run < supabase/migrations/20260921234146_ticket_discounts_eligible_tiers.sql
run < supabase/migrations/20260922001849_pricing_rpc.sql
docker cp supabase/functions/_shared/pricing_vectors.json pgrpc:/tmp/pricing_vectors.json
{ echo "\\set doc \`cat /tmp/pricing_vectors.json\`"; cat $T/pricing_rpc/pricing_rpc_test.sql; } | run
[ -n "$KEEP" ] || docker rm -f pgrpc >/dev/null
