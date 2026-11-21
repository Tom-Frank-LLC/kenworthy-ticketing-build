#!/bin/sh
# Two buyers race for the last use of a limited promo code. Run by run.sh,
# against its container, after the other tests. Needs two real sessions,
# which one psql script cannot be.
#
# A takes the order and holds its transaction open for 3 seconds. B starts
# 1 second later. create_ticket_order locks the rule before writing, so B waits
# for A to commit, re-prices against A's rows, and must be refused. Without
# the lock both would see zero uses and both would write.
set -e
run() { docker exec -i pgrpc psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

run <<'SQL'
SELECT set_config('test.authrole', 'service_role', false);
INSERT INTO public.showings (id, ticket_price) VALUES ('00000000-0000-0000-0000-00000000d001', 8);
INSERT INTO public.ticket_discounts (id, showing_id, type, value, label, code)
  VALUES ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-00000000d001', 'percent', 50, 'Last one', 'LASTONE');
INSERT INTO public.ticket_discount_limits (discount_id, counts, per, max_uses)
  VALUES ('00000000-0000-0000-0000-00000000d002', 'orders', 'total', 1);
SQL

order() {
  # $1 token, $2 seconds to hold the transaction open after writing
  run <<SQL 2>&1
SELECT set_config('test.authrole', 'service_role', false);
BEGIN;
SELECT count(*) FROM public.create_ticket_order('00000000-0000-0000-0000-00000000d001', '[{}]', 'online',
  NULL, '$1', 'pending', NULL, NULL, NULL, NULL, NULL, 'LASTONE');
SELECT pg_sleep($2);
COMMIT;
SQL
}

A_FILE=$(mktemp)
order race-a 3 > "$A_FILE" &
A=$!
sleep 1
B_OUT=$(order race-b 0 || true)
wait $A || true
A_OUT=$(cat "$A_FILE"); rm -f "$A_FILE"

USED=$(run -c "SELECT count(DISTINCT order_token) FROM public.tickets WHERE discount_id = '00000000-0000-0000-0000-00000000d002'")
echo "race: A said: $(echo "$A_OUT" | tr '\n' ' ')"
echo "race: B said: $(echo "$B_OUT" | tr '\n' ' ')"
echo "race: orders holding the code: $USED"
if [ "$USED" = "1" ] && echo "$B_OUT" | grep -q 'This promo code has been used up'; then
  echo "race: ok — the second buyer waited for the first and was refused"
else
  echo "race: FAIL — expected 1 order and B refused"
  exit 1
fi
