#!/usr/bin/env bash
# Live rig for the auth router hardening (plan 022): the deploy.yml labels on
# a throwaway traefik:v3.7.15 (Docker provider), SSE through the real image's
# Next rewrite and backend, and the cookie-drop label. See README.md.
#
#   ./rig.sh                         build the auth image once, run, tear down
#   RIG_IMAGE=<tag> ./rig.sh         reuse an image you built (not removed)
#
# Safety, because the production Traefik watches the same Docker daemon:
#   - no rig container carries traefik.enable=true (production Traefik runs
#     with exposedByDefault=false and ignores them)
#   - the rig Traefik only sees containers labelled hardening-rig=1, mounts
#     the socket read-only and publishes no port
#   - every router, service and middleware name starts with rig-, every host
#     is under rig.test
#   - docker logs lilnas-traefik-1 is checked for `rig-` and new errors; on a
#     hit the rig tears down at once and exits 3
# Teardown always runs: containers, network, temp dir, and the image when
# this script built it.

set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$KIT_DIR/.." && pwd)"
ROOT="$(cd "$KIT_DIR/../../../.." && pwd)"
TRAEFIK_IMAGE="${TRAEFIK_IMAGE:-traefik:v3.7.15}"
PROD_TRAEFIK="${PROD_TRAEFIK:-lilnas-traefik-1}"

RIG="hardening-rig-$(openssl rand -hex 3)"
NETWORK="$RIG-net"
RUN_LABEL="hardening-rig.run=$RIG"
TMP="$(mktemp -d "/tmp/$RIG.XXXXXX")"
DOMAIN="rig.test"
SSE_EMAIL="sse@rig.test"
ADMIN_EMAIL="admin@rig.test"
HOLD_EMAIL="hold@rig.test"
RIG_START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STATUS=1
BUILT_IMAGE=""

log() { printf '\n== %s\n' "$*"; }

cleanup() {
  set +e
  log "teardown"
  local ids
  ids="$(docker ps -aq --filter "label=$RUN_LABEL")"
  [ -n "$ids" ] && docker rm -f $ids >/dev/null
  docker network rm "$NETWORK" >/dev/null 2>&1
  [ -n "$BUILT_IMAGE" ] && docker image rm "$BUILT_IMAGE" >/dev/null
  rm -rf "$TMP"
  echo "containers left: $(docker ps -a --format '{{.Names}}' | grep -c "^$RIG")"
  echo "networks left:   $(docker network ls --format '{{.Name}}' | grep -c "^$RIG")"
  [ -n "$BUILT_IMAGE" ] &&
    echo "image left:      $(docker image ls -q "$BUILT_IMAGE" | wc -l)"
  echo "temp dir left:   $([ -e "$TMP" ] && echo yes || echo no)"
  exit "$STATUS"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Production Traefik must not have noticed the rig: no line naming a rig-
# router/middleware/service, no error since the rig started.
check_prod_traefik() {
  local mentions errors
  mentions="$(docker logs "$PROD_TRAEFIK" --since 5m 2>&1 | grep -c 'rig-' || true)"
  errors="$(docker logs "$PROD_TRAEFIK" --since "$RIG_START" 2>&1 |
    grep -cE ' ERR |"level":"error"|level=error' || true)"
  echo "production traefik ($1): lines mentioning rig- in 5m: $mentions; errors since $RIG_START: $errors"
  if [ "$mentions" != 0 ] || [ "$errors" != 0 ]; then
    docker logs "$PROD_TRAEFIK" --since "$RIG_START" 2>&1 |
      grep -E 'rig-| ERR |"level":"error"|level=error' | cut -c1-300 >&2
    echo "production traefik reacted to the rig: tearing down" >&2
    STATUS=3
    exit 3
  fi
}

docker image inspect "$TRAEFIK_IMAGE" >/dev/null 2>&1 ||
  { echo "missing local image $TRAEFIK_IMAGE" >&2; exit 2; }
docker inspect "$PROD_TRAEFIK" >/dev/null 2>&1 ||
  { echo "no $PROD_TRAEFIK container to watch" >&2; exit 2; }

if [ -n "${RIG_IMAGE:-}" ]; then
  IMAGE="$RIG_IMAGE"
  docker image inspect "$IMAGE" >/dev/null
else
  # This host is the production server: one heavy job at a time.
  if pgrep -af 'docker(-buildx)? (buildx )?build|jest' | grep -v pgrep >/dev/null; then
    echo "another docker build or jest run is going; not building now" >&2
    exit 2
  fi
  IMAGE="hardening-rig-auth:$(openssl rand -hex 4)"
  log "build $IMAGE from $ROOT"
  BUILT_IMAGE="$IMAGE"
  docker build -f "$ROOT/apps/auth/Dockerfile" -t "$IMAGE" "$ROOT"
fi

log "versions"
echo "traefik: $(docker run --rm "$TRAEFIK_IMAGE" traefik version | grep -m1 -i '^Version' | tr -s ' ')"
echo "node:    $(docker run --rm --entrypoint node "$IMAGE" --version) ($IMAGE)"

mkdir -p "$TMP/db" "$TMP/work"
: > "$TMP/db/auth.db"
chmod 777 "$TMP/db" "$TMP/work"
chmod 666 "$TMP/db/auth.db"

# Test values only; the signing secret never leaves this run.
SECRET="$(openssl rand -hex 32)"

docker network create --label "$RUN_LABEL" "$NETWORK" >/dev/null

log "backend: node dist/main from the image, throwaway database, alias auth"
docker run -d --name "$RIG-auth" --label "$RUN_LABEL" --network "$NETWORK" \
  --network-alias auth --no-healthcheck --entrypoint node \
  -v "$TMP/db:/work" \
  -v "$SCRIPTS_DIR/cookie-rig/mint-session.mjs:/app/scripts/cookie-rig/mint-session.mjs:ro" \
  -e NODE_ENV=production -e BACKEND_PORT=8081 -e DATABASE_PATH=/work/auth.db \
  -e AUTH_HOST="https://auth.$DOMAIN" -e COOKIE_DOMAIN=".$DOMAIN" \
  -e REDIRECT_ALLOWED_SUFFIX="$DOMAIN" -e GOOGLE_CLIENT_ID=rig-test \
  -e GOOGLE_CLIENT_SECRET=rig-test -e BETTER_AUTH_SECRET="$SECRET" \
  -e OIDC_IMMICH_CLIENT_SECRET=rig-test -e ADMIN_EMAILS="$ADMIN_EMAIL" \
  -e SSE_KEEPALIVE_MS=1000 -e TZ=America/Los_Angeles \
  "$IMAGE" dist/main >/dev/null

healthy() {
  docker exec "$RIG-auth" node -e \
    "fetch('http://127.0.0.1:8081/health').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))" \
    2>/dev/null
}
for _ in $(seq 1 60); do healthy && break; sleep 1; done
if ! healthy; then
  echo "backend did not become healthy; last log lines (cookies masked):" >&2
  docker logs --tail 40 "$RIG-auth" 2>&1 | sed -E 's/("cookie":")[^"]*/\1<masked>/Ig' >&2
  exit 2
fi

log "mint sessions in the throwaway database (values not printed)"
for who in sse admin hold; do
  email_var="$(echo "$who" | tr a-z A-Z)_EMAIL"
  docker exec -e MINT_EMAIL="${!email_var}" "$RIG-auth" \
    node scripts/cookie-rig/mint-session.mjs --json > "$TMP/work/mint-$who.json"
  echo "minted ${!email_var}"
done

log "rig traefik (Docker provider, constraint hardening-rig=1, no ports)"
docker run -d --name "$RIG-traefik" --label "$RUN_LABEL" --network "$NETWORK" \
  --network-alias "auth.$DOMAIN" --network-alias "drop.$DOMAIN" \
  --network-alias "keep.$DOMAIN" \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  "$TRAEFIK_IMAGE" \
  --providers.docker=true \
  --providers.docker.exposedByDefault=true \
  "--providers.docker.constraints=Label(\`hardening-rig\`,\`1\`)" \
  --providers.docker.network="$NETWORK" \
  --entrypoints.web.address=:80 --entrypoints.websecure.address=:443 \
  --log.level=INFO >/dev/null

# auth-frontend as deploy.yml runs it, with rig values for its literals and
# the rig copy of its labels (labels.mjs).
start_frontend() {
  local labels=() label
  while IFS= read -r label; do labels+=(--label "$label"); done \
    < <(node "$KIT_DIR/labels.mjs" --domain "$DOMAIN" "$@")
  docker rm -f "$RIG-frontend" >/dev/null 2>&1 || true
  sleep 2
  docker run -d --name "$RIG-frontend" --label "$RUN_LABEL" "${labels[@]}" \
    --network "$NETWORK" --network-alias frontend --no-healthcheck \
    --entrypoint node \
    -e AUTH_HOST="https://auth.$DOMAIN" -e REDIRECT_ALLOWED_SUFFIX="$DOMAIN" \
    -e AUTH_BACKEND_URL=http://auth:8081 -e TZ=America/Los_Angeles \
    "$IMAGE" frontend/apps/auth/server.js >/dev/null
  echo "frontend labels: $*"
  printf '  %s\n' "${labels[@]}" | grep -v -- '^  --label$' | grep -E 'inflight|middlewares='
}

log "frontend with the deploy.yml labels as shipped"
start_frontend

log "echo backend with the cookie-drop router and a control router"
docker run -d --name "$RIG-echo" --label "$RUN_LABEL" --network "$NETWORK" \
  --network-alias echo --no-healthcheck --entrypoint node \
  -v "$SCRIPTS_DIR/cookie-rig/echo.mjs:/echo.mjs:ro" -e PORT=3000 -e ECHO_VALUES=1 \
  --label hardening-rig=1 \
  --label 'traefik.http.services.rig-echo.loadbalancer.server.port=3000' \
  --label 'traefik.http.middlewares.rig-drop-cookies.headers.customrequestheaders.Cookie=' \
  --label "traefik.http.routers.rig-drop-web.rule=Host(\`drop.$DOMAIN\`)" \
  --label 'traefik.http.routers.rig-drop-web.entrypoints=web' \
  --label 'traefik.http.routers.rig-drop-web.middlewares=rig-drop-cookies' \
  --label 'traefik.http.routers.rig-drop-web.service=rig-echo' \
  --label "traefik.http.routers.rig-drop-tls.rule=Host(\`drop.$DOMAIN\`)" \
  --label 'traefik.http.routers.rig-drop-tls.entrypoints=websecure' \
  --label 'traefik.http.routers.rig-drop-tls.tls=true' \
  --label 'traefik.http.routers.rig-drop-tls.middlewares=rig-drop-cookies' \
  --label 'traefik.http.routers.rig-drop-tls.service=rig-echo' \
  --label "traefik.http.routers.rig-keep-web.rule=Host(\`keep.$DOMAIN\`)" \
  --label 'traefik.http.routers.rig-keep-web.entrypoints=web' \
  --label 'traefik.http.routers.rig-keep-web.service=rig-echo' \
  --label "traefik.http.routers.rig-keep-tls.rule=Host(\`keep.$DOMAIN\`)" \
  --label 'traefik.http.routers.rig-keep-tls.entrypoints=websecure' \
  --label 'traefik.http.routers.rig-keep-tls.tls=true' \
  --label 'traefik.http.routers.rig-keep-tls.service=rig-echo' \
  "$IMAGE" /echo.mjs >/dev/null

log "client containers A and B (two addresses on the rig network)"
for c in a b; do
  docker run -d --name "$RIG-client-$c" --label "$RUN_LABEL" \
    --network "$NETWORK" --no-healthcheck --entrypoint node \
    -v "$SCRIPTS_DIR:/scripts:ro" -v "$TMP/work:/work" \
    -e RIG_DOMAIN="$DOMAIN" -e RIG_WORK=/work \
    "$IMAGE" -e 'setInterval(() => {}, 1e6)' >/dev/null
  echo "client $c: $(docker inspect -f "{{(index .NetworkSettings.Networks \"$NETWORK\").IPAddress}}" "$RIG-client-$c")"
done

client() { docker exec "$RIG-client-$1" node /scripts/hardening-rig/client.mjs "${@:2}"; }

client a ready auth
client a ready echo
sleep 3
check_prod_traefik "rig up"

RESULTS="$TMP/results.md"
FAILED=0
run() { client "$@" | tee -a "$RESULTS" || FAILED=1; }

log "case 1-2: headers, x-powered-by"
run a headers
log "case 6: sign-in starts"
run a signin
log "case 4: SSE"
run a sse
log "case 5: cookie drop"
run a cookies

inflight_case() {
  local id="$1" expect_b="$2"
  docker exec -d "$RIG-client-a" node /scripts/hardening-rig/client.mjs hold "$id"
  run b inflight "$id" "$expect_b"
  sleep 2
}

log "case 3: in-flight limit, amount 3, ipstrategy kept"
start_frontend --amount 3
client a ready auth
sleep 3
inflight_case limit 200

log "case 3 control: amount 3, ipstrategy line removed"
start_frontend --amount 3 --no-ipstrategy
client a ready auth
sleep 3
inflight_case control 429

check_prod_traefik "after the matrix"

log "rig traefik errors (informational)"
docker logs "$RIG-traefik" 2>&1 | grep -E ' ERR |level=error' | cut -c1-300 || echo "(none)"

log "results"
echo '| case | expected | observed | result |'
echo '| ---- | -------- | -------- | ------ |'
cat "$RESULTS"
echo "passed: $(grep -c '| PASS |$' "$RESULTS"); failed: $(grep -c '| FAIL |$' "$RESULTS")"

if [ "$FAILED" -eq 0 ] && ! grep -q '| FAIL |$' "$RESULTS"; then STATUS=0; fi
