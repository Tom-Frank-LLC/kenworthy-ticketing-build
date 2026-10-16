#!/bin/sh
# Contracts: blank_contracts, contract_versions and the signed-contracts bucket
# (20261016204420), against a throwaway postgres:15 holding EVERY migration,
# replayed in order. From the repo root:
#   sh supabase/tests/contracts/run.sh
#
# A full replay because the version triggers sit on rental_requests beside the
# audit and updated_at triggers, and the policies lean on has_role as the MFA
# migrations left it; a stub would model neither.
set -e
cd "$(dirname "$0")/../../.."
C=pgcontracts
docker rm -f $C >/dev/null 2>&1 || true
docker run --rm -d --name $C -e POSTGRES_PASSWORD=pw postgres:15 >/dev/null
until docker exec $C pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/staff_boundaries/stub.sql
failed=""
for f in $(ls supabase/migrations/*.sql | sort); do
  b=$(basename $f)
  # pg_net / pg_cron are not in the stock image; the stub provides the schemas.
  if ! sed -E 's/^[[:space:]]*CREATE EXTENSION IF NOT EXISTS (pg_net|pg_cron)[^;]*;/-- stripped/I' $f \
       | docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q >/dev/null 2>/tmp/$C.err; then
    failed="$failed $b"
  fi
done
# 20260812180000 is a one-off data fix that aborts on an empty database by
# design ("Anchor showing not found"). Anything else failing is a real problem.
for b in $failed; do
  [ "$b" = "20260812180000_showings_pacific_not_mountain.sql" ] && continue
  echo "migration failed to replay: $b"; exit 1
done
docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/contracts/test.sql
[ -n "$KEEP" ] || docker rm -f $C >/dev/null
