#!/usr/bin/env bash
# Isolated Traefik rig for the lilnas-auth cookie strip. Builds the real Nest
# backend from this checkout, runs it with a throwaway SQLite database behind
# traefik:v3.7.15 (file provider, web + websecure with the default self-signed
# certificate), mints a session, runs client.mjs against three routes over
# HTTP/1.1 cleartext, HTTP/1.1 TLS and HTTP/2 TLS, and always tears down.
#
#   ./rig.sh                run the whole matrix (exit 1 on any mismatch)
#   SKIP_BUILD=1 ./rig.sh   reuse apps/auth/dist from an earlier build
#   NODE_IMAGE=node:26.12.0 ./rig.sh   override the Node image
#   TRAEFIK_DYNAMIC=/path/to/other.yml ./rig.sh   use another file-provider
#                           config (for example one with Cookie removed from
#                           authResponseHeaders, to prove the matrix fails)
#
# Everything lives on one new docker network with a unique name and no
# published ports. Nothing here touches the `lilnas` compose project, the
# production database or any real cookie.

set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$KIT_DIR/../../../.." && pwd)"
TRAEFIK_IMAGE="${TRAEFIK_IMAGE:-traefik:v3.7.15}"
NODE_IMAGE="${NODE_IMAGE:-node:$(node --version | sed 's/^v//')}"
TRAEFIK_DYNAMIC="${TRAEFIK_DYNAMIC:-$KIT_DIR/traefik-dynamic.yml}"

RIG="cookierig-$(openssl rand -hex 3)"
NETWORK="$RIG-net"
TMP="$(mktemp -d "/tmp/$RIG.XXXXXX")"
LABEL="cookie-rig=$RIG"
OWNER="$(id -u):$(id -g)"
DOMAIN="rig.test"
MINT_EMAIL="cookie-rig@example.test"
STATUS=1

log() { printf '\n== %s\n' "$*"; }

cleanup() {
  set +e
  log "teardown"
  local ids
  ids="$(docker ps -aq --filter "label=$LABEL")"
  [ -n "$ids" ] && docker rm -f $ids >/dev/null
  docker network rm "$NETWORK" >/dev/null 2>&1
  rm -rf "$TMP"
  echo "containers left: $(docker ps -aq --filter "label=$LABEL" | wc -l)"
  echo "networks left:   $(docker network ls -q --filter "name=$RIG" | wc -l)"
  echo "temp dir left:   $([ -e "$TMP" ] && echo yes || echo no)"
  exit "$STATUS"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

docker image inspect "$NODE_IMAGE" >/dev/null 2>&1 ||
  { echo "missing local image $NODE_IMAGE (host node is $(node --version))" >&2; exit 2; }
docker image inspect "$TRAEFIK_IMAGE" >/dev/null 2>&1 ||
  { echo "missing local image $TRAEFIK_IMAGE" >&2; exit 2; }

if [ -z "${SKIP_BUILD:-}" ]; then
  log "build the backend"
  (cd "$ROOT" &&
    pnpm --filter @lilnas/utils build &&
    pnpm --filter @lilnas/ui build &&
    pnpm --filter @lilnas/auth build:backend)
fi
[ -f "$ROOT/apps/auth/dist/main.js" ] || { echo "apps/auth/dist/main.js missing" >&2; exit 2; }

log "versions"
echo "node:    $(docker run --rm "$NODE_IMAGE" node --version) ($NODE_IMAGE)"
echo "traefik: $(docker run --rm "$TRAEFIK_IMAGE" traefik version | grep -m1 -i '^Version' | tr -s ' ')"

# Test values only: a random signing secret that never leaves this run.
SECRET="$(openssl rand -hex 32)"
mkdir -p "$TMP/db" "$TMP/client"
: > "$TMP/db/auth.db"

docker network create --label "$LABEL" "$NETWORK" >/dev/null

log "start the real backend (node dist/main)"
docker run -d --name "$RIG-auth" --label "$LABEL" --network "$NETWORK" \
  --network-alias auth --user "$OWNER" \
  -v "$ROOT:/repo:ro" -v "$TMP/db:/work" -w /repo/apps/auth \
  -e NODE_ENV=production -e BACKEND_PORT=8081 -e DATABASE_PATH=/work/auth.db \
  -e AUTH_HOST="https://auth.$DOMAIN" -e COOKIE_DOMAIN=".$DOMAIN" \
  -e REDIRECT_ALLOWED_SUFFIX="$DOMAIN" -e GOOGLE_CLIENT_ID=rig-test \
  -e GOOGLE_CLIENT_SECRET=rig-test -e BETTER_AUTH_SECRET="$SECRET" \
  -e ADMIN_EMAILS="$MINT_EMAIL" -e SSE_KEEPALIVE_MS=25000 \
  "$NODE_IMAGE" node dist/main >/dev/null

for _ in $(seq 1 60); do
  docker exec "$RIG-auth" node -e \
    "fetch('http://127.0.0.1:8081/health').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))" \
    2>/dev/null && break
  sleep 1
done || true
if ! docker exec "$RIG-auth" node -e \
  "fetch('http://127.0.0.1:8081/health').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))" 2>/dev/null; then
  echo "backend did not become healthy; last log lines (cookie headers masked):" >&2
  docker logs --tail 40 "$RIG-auth" 2>&1 | sed -E 's/("cookie":")[^"]*/\1<masked>/Ig' >&2
  exit 2
fi

log "mint a session in the throwaway database"
docker exec "$RIG-auth" node scripts/cookie-rig/mint-session.mjs --json > "$TMP/client/mint.json"
echo "minted $MINT_EMAIL (cookie not printed)"

log "start echo, traefik and the client"
docker run -d --name "$RIG-echo" --label "$LABEL" --network "$NETWORK" \
  --network-alias echo --user "$OWNER" \
  -v "$KIT_DIR/echo.mjs:/echo.mjs:ro" -e PORT=3000 -e ECHO_VALUES=1 \
  "$NODE_IMAGE" node /echo.mjs >/dev/null

docker run -d --name "$RIG-traefik" --label "$LABEL" --network "$NETWORK" \
  --network-alias "gated.$DOMAIN" --network-alias "open.$DOMAIN" \
  --network-alias "baseline.$DOMAIN" \
  -v "$TRAEFIK_DYNAMIC:/etc/traefik/dynamic.yml:ro" \
  "$TRAEFIK_IMAGE" \
  --providers.file.filename=/etc/traefik/dynamic.yml \
  --entrypoints.web.address=:80 --entrypoints.websecure.address=:443 \
  --log.level=INFO >/dev/null

docker run -d --name "$RIG-client" --label "$LABEL" --network "$NETWORK" \
  --user "$OWNER" -v "$KIT_DIR:/kit:ro" -v "$TMP/client:/work:ro" \
  -e RIG_DOMAIN="$DOMAIN" \
  "$NODE_IMAGE" node -e 'setInterval(() => {}, 1e6)' >/dev/null

client() { docker exec "$RIG-client" node /kit/client.mjs "$@"; }

client ready

log "matrix (cases 1-14 plus direct /verify and /strip-cookie)"
MATRIX_STATUS=0
client matrix || MATRIX_STATUS=$?

log "case 15: echo backend stopped"
docker stop "$RIG-echo" >/dev/null
DOWN_STATUS=0
client down || DOWN_STATUS=$?

if [ "$MATRIX_STATUS" -eq 0 ] && [ "$DOWN_STATUS" -eq 0 ]; then STATUS=0; fi
