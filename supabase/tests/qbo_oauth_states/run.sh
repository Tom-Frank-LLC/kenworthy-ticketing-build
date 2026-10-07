#!/bin/sh
# qbo_oauth_states (security audit 2026-10-06, L4): single-use OAuth nonces for
# qbo-sync. Replays EVERY migration into a throwaway postgres:15 (reusing the
# staff_boundaries stub), then runs test.sql.
# From the repo root:  sh supabase/tests/qbo_oauth_states/run.sh
set -e
cd "$(dirname "$0")/../../.."
T=supabase/tests/qbo_oauth_states
C=pgqbo
docker rm -f $C >/dev/null 2>&1 || true
docker run --rm -d --name $C -e POSTGRES_PASSWORD=pw postgres:15 >/dev/null
until docker exec $C pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/staff_boundaries/stub.sql
failed=""
for f in $(ls supabase/migrations/*.sql | sort); do
  b=$(basename $f)
  if ! sed -E 's/^[[:space:]]*CREATE EXTENSION IF NOT EXISTS (pg_net|pg_cron)[^;]*;/-- stripped/I' $f \
       | docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q >/dev/null 2>/tmp/pgqbo.err; then
    failed="$failed $b"
  fi
done
# 20260812180000 is a data fix whose anchor row exists only on the real databases.
for b in $failed; do
  [ "$b" = "20260812180000_showings_pacific_not_mountain.sql" ] && continue
  echo "migration failed to replay: $b"; cat /tmp/pgqbo.err; exit 1
done
docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q < $T/test.sql
[ -n "$KEEP" ] || docker rm -f $C >/dev/null
