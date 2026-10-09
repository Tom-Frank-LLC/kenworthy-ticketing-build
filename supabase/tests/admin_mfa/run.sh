#!/bin/sh
# Admin MFA enforcement tests (security audit 2026-10-06, M9)
# against a throwaway postgres:15 holding EVERY migration, replayed in order.
# From the repo root:
#   sh supabase/tests/admin_mfa/run.sh
#   BEFORE=1 sh supabase/tests/admin_mfa/run.sh   # main, without the fix
#
# A full replay rather than a stub schema, because the fix is in has_role, which
# about 210 policies and RPCs call: the real policies are what has to refuse an
# aal1 admin and still serve everyone else. stub.sql is staff_boundaries' copy.
# With BEFORE=1 the enforcement cases fail (the functions do not exist).
set -e
cd "$(dirname "$0")/../../.."
T=supabase/tests/admin_mfa
C=pgmfa
FIX="20261008233835_admin_mfa_enforcement.sql 20261009003240_mfa_guard_inline.sql"
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
       | docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q >/dev/null 2>/tmp/pgmfa.err; then
    failed="$failed $b"
  fi
done
# 20260812180000 is a one-off data fix that aborts on an empty database by
# design ("Anchor showing not found"). Anything else failing is a real problem.
for b in $failed; do
  [ "$b" = "20260812180000_showings_pacific_not_mountain.sql" ] && continue
  echo "migration failed to replay: $b"; exit 1
done
docker exec -i $C psql -U postgres -v ON_ERROR_STOP=1 -q < $T/admin_mfa_test.sql
[ -n "$KEEP" ] || docker rm -f $C >/dev/null
