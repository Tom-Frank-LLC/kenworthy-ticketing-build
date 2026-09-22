#!/bin/sh
# Runs the ticket-discount tests against a throwaway postgres:15.
# From the repo root:  sh supabase/tests/ticket_discounts/run.sh
#
# It first REPLAYS the order_tax suite under the discounts migration, because
# that migration replaces both pricing triggers: everything Ship 1 proved —
# Square's tax vectors, the no-op at 50-cent prices — must still hold.
set -e
cd "$(dirname "$0")/../../.."
T=supabase/tests
docker rm -f pgdiscounts >/dev/null 2>&1 || true
docker run --rm -d --name pgdiscounts -e POSTGRES_PASSWORD=pw postgres:15 >/dev/null
until docker exec pgdiscounts pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
docker exec pgdiscounts psql -U postgres -q -c \
  "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;"
run() { docker exec -i pgdiscounts psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
run < $T/order_tax/stub.sql
run < $T/ticket_discounts/stub_extra.sql
run < supabase/migrations/20260819040000_film_pass_redemption_untaxed.sql
run < $T/order_tax/trigger.sql
run < supabase/migrations/20260921200433_order_level_tax.sql
run < supabase/migrations/20260921203017_ticket_discounts.sql
run < supabase/migrations/20260921234146_ticket_discounts_eligible_tiers.sql
docker cp supabase/functions/_shared/pricing_vectors.json pgdiscounts:/tmp/pricing_vectors.json
echo "== Ship 1 suite, replayed under the discounts migration"
run < $T/order_tax/order_tax_test.sql | tail -4
echo "== discounts"
FIRST=$(docker exec pgdiscounts psql -U postgres -At -c "SELECT max(n) FROM public.results")
{ echo "\\set doc \`cat /tmp/pricing_vectors.json\`"; cat $T/ticket_discounts/discounts_test.sql; } | run -v first_new="$FIRST"
[ -n "$KEEP" ] || docker rm -f pgdiscounts >/dev/null
