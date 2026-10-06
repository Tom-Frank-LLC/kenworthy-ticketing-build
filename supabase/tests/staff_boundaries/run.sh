#!/bin/sh
# Staff-boundary tests (security audit 2026-10-06: L1, L3, L14, M11, RLS-9)
# against a throwaway postgres:15 holding EVERY migration, replayed in order.
# From the repo root:
#   sh supabase/tests/staff_boundaries/run.sh
#   BEFORE=1 sh supabase/tests/staff_boundaries/run.sh   # main, without the fix
#
# A full replay rather than a stub schema, because the fix is a trigger on
# tickets and a guard on admin_audit_log: what it has to coexist with is every
# other trigger on those tables (pricing, capacity, the audit trigger), and a
# stub would only prove the branches it happened to model.
set -e
cd "$(dirname "$0")/../../.."
T=supabase/tests/staff_boundaries
C=pgstaff
FIX="20261006225712_staff_sale_integrity.sql 20261006225810_audit_log_integrity.sql"
docker rm -f $C >/dev/null 2>&1 || true
docker run --rm -d --name $C -e POSTGRES_PASSWORD=pw postgres:15 >/dev/null
until docker exec $C pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q < $T/stub.sql
failed=""
for f in $(ls supabase/migrations/*.sql | sort); do
  b=$(basename $f)
  if [ -n "$BEFORE" ] && echo "$FIX" | grep -q "$b"; then continue; fi
  # pg_net / pg_cron are not in the stock image; the stub provides the schemas.
  if ! sed -E 's/^[[:space:]]*CREATE EXTENSION IF NOT EXISTS (pg_net|pg_cron)[^;]*;/-- stripped/I' $f \
       | docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q >/dev/null 2>/tmp/pgstaff.err; then
    failed="$failed $b"
  fi
done
# 20260812180000 is a one-off data fix that aborts on an empty database by
# design ("Anchor showing not found"). Anything else failing is a real problem.
for b in $failed; do
  [ "$b" = "20260812180000_showings_pacific_not_mountain.sql" ] && continue
  echo "migration failed to replay: $b"; exit 1
done
docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q < $T/staff_boundaries_test.sql
[ -n "$KEEP" ] || docker rm -f $C >/dev/null
