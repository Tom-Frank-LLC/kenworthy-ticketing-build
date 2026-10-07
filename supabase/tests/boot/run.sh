#!/bin/sh
# Does every edge function bundle and boot in the real edge runtime?
#
# `deno check` and `deno test` passing proves nothing about whether a function
# boots once deployed (docs/TICKET-DELIVERY.md: npm: specifiers that fail only
# as BOOT_ERROR). This runs the two steps a deploy runs, locally and without
# deploying anything, in the same edge-runtime image `supabase functions deploy`
# bundles with:
#
#   1. `edge-runtime bundle` — what the CLI's Docker bundler runs for each
#      function before upload. It resolves every import (esm.sh, npm:, jsr:,
#      relative) exactly as a deploy would. A failure here is a failed deploy.
#   2. `edge-runtime start --main-service <fn>` — evaluates the module and serves
#      it, then sends an OPTIONS preflight, which every function answers before
#      touching the network or a secret. A failure here is a BOOT_ERROR.
#
# Env is dummy (SUPABASE_URL points at a closed port), so nothing reaches
# Supabase, Square, or anyone else. Needs Docker.
#
#   sh supabase/tests/boot/run.sh                 # every function
#   sh supabase/tests/boot/run.sh ticket-checkout # some
#   EDGE_RUNTIME=v1.74.3 sh supabase/tests/boot/run.sh
set -u
cd "$(dirname "$0")/../../.."
FN="$PWD/supabase/functions"
# Mounted at a neutral path: binding a host path onto the same path inside the
# container proved flaky under Docker Desktop (the directory was intermittently
# empty), which read as "entrypoint path does not exist".
C=/work/functions
IMG="public.ecr.aws/supabase/edge-runtime:${EDGE_RUNTIME:-v1.74.3}"
OUT=$(mktemp -d)
PORT=19123
fail=0

if [ $# -gt 0 ]; then names="$*"; else
  names=$(cd "$FN" && for d in */; do d=${d%/}; [ "$d" = _shared ] && continue; [ -f "$d/index.ts" ] && echo "$d"; done)
fi

for n in $names; do
  if ! docker run --rm -v "$FN:$C:ro" -v "$OUT:/out" -e DENO_NO_PACKAGE_JSON=1 "$IMG" \
       bundle --entrypoint "$C/$n/index.ts" --output "/out/$n.eszip" >"$OUT/$n.bundle.log" 2>&1 \
     || [ ! -s "$OUT/$n.eszip" ]; then
    echo "BUNDLE FAIL  $n"; tail -5 "$OUT/$n.bundle.log"; fail=1; continue
  fi
  docker rm -f kwboot >/dev/null 2>&1
  docker run -d --name kwboot -p $PORT:9000 -v "$FN:$C:ro" -e DENO_NO_PACKAGE_JSON=1 \
    -e SUPABASE_URL=http://127.0.0.1:9 -e SUPABASE_ANON_KEY=boot-test -e SUPABASE_SERVICE_ROLE_KEY=boot-test \
    "$IMG" start --main-service "$C/$n" -p 9000 >/dev/null
  code=""
  i=0
  while [ $i -lt 40 ]; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 -X OPTIONS \
      -H 'Origin: https://kenworthy.org' -H 'Access-Control-Request-Method: POST' "http://127.0.0.1:$PORT/" 2>/dev/null)
    case "$code" in 2??) break;; esac
    if ! docker ps -q -f name=kwboot | grep -q .; then break; fi
    i=$((i + 1)); sleep 0.5
  done
  case "$code" in
    2??) echo "ok           $n ($(wc -c < "$OUT/$n.eszip" | tr -d ' ') bytes)";;
    *) echo "BOOT FAIL    $n (OPTIONS -> ${code:-none})"; docker logs kwboot 2>&1 | tail -8; fail=1;;
  esac
  docker rm -f kwboot >/dev/null 2>&1
done
rm -rf "$OUT"
[ $fail = 0 ] && echo "ALL BOOT" || { echo "FAILED"; exit 1; }
