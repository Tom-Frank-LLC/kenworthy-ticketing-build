#!/bin/sh
# Two buyers race for the last Preferred ticket. Run by run.sh, against its
# container, after test.sql (which leaves Preferred with a limit of 1 and the
# showing with room to spare). Needs two real sessions, which one psql script
# cannot be.
#
# A inserts and holds its transaction open for 3 seconds. B starts 1 second
# later. The trigger locks the showing row before counting, so B waits for A to
# commit, counts A's row, and must be refused. Without the lock both would
# count zero and both would land.
set -e
run() { docker exec -i pgtierlim psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

order() {
  run <<SQL 2>&1
BEGIN;
INSERT INTO public.tickets (showing_id, tier_id)
  VALUES ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000b0001');
SELECT pg_sleep($1);
COMMIT;
SQL
}

A_FILE=$(mktemp)
order 3 > "$A_FILE" &
A=$!
sleep 1
B_OUT=$(order 0 || true)
wait $A || true
A_OUT=$(cat "$A_FILE"); rm -f "$A_FILE"

N=$(run -c "SELECT count(*) FROM public.tickets WHERE tier_id = '00000000-0000-0000-0000-0000000b0001'")
echo "race: A -> ${A_OUT:-ok}"
echo "race: B -> $B_OUT"
if [ "$N" != "1" ]; then echo "race FAILED: $N Preferred tickets for a limit of 1"; exit 1; fi
case "$B_OUT" in *"Preferred Seating is sold out"*) ;; *) echo "race FAILED: B was not refused"; exit 1;; esac
echo "race ok: the last Preferred ticket went to exactly one buyer"
