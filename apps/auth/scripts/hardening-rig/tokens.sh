#!/usr/bin/env bash
# Live check for plan 022's per-caller internal tokens: each real client
# against a real auth backend, first enforcing (INTERNAL_TOKEN_ENFORCE=true),
# then observing (unset). See README.md, "Internal tokens".
#
#   ./tokens.sh                      build the auth image once, run, tear down
#   RIG_IMAGE=<tag> ./tokens.sh      reuse an image you built (not removed)
#
# Needs packages/utils/dist and apps/dev/dist built from this checkout:
#   pnpm --filter @lilnas/utils build
#   (cd apps/dev && pnpm exec nest build -b swc)
#
# No Traefik and no Traefik labels: nothing here is routed. Containers sit on
# one new network, publish no port and use test tokens generated per run;
# the tokens live in files under the temp dir and reach containers through
# --env-file and a read-only mount, never the command line. Teardown always
# runs: containers, network, temp dir, and the image when this script built it.

set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$KIT_DIR/../../../.." && pwd)"
REAPER_IMAGE="${REAPER_IMAGE:-ghcr.io/codemonkey800/lilnas-dev-idle-reaper:latest}"

RIG="tokens-rig-$(openssl rand -hex 3)"
NETWORK="$RIG-net"
RUN_LABEL="tokens-rig.run=$RIG"
TMP="$(mktemp -d "/tmp/$RIG.XXXXXX")"
DOMAIN="rig.test"
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

for f in packages/utils/dist/auth/client.js apps/dev/dist/activity/host-activity.service.js; do
  [ -f "$ROOT/$f" ] || { echo "missing $f: build it first (see the header)" >&2; exit 2; }
done
docker image inspect "$REAPER_IMAGE" >/dev/null 2>&1 ||
  { echo "missing local image $REAPER_IMAGE (alpine + curl + jq)" >&2; exit 2; }

if [ -n "${RIG_IMAGE:-}" ]; then
  IMAGE="$RIG_IMAGE"
  docker image inspect "$IMAGE" >/dev/null
else
  # This host is the production server: one heavy job at a time.
  if pgrep -af 'docker(-buildx)? (buildx )?build|jest' | grep -v pgrep >/dev/null; then
    echo "another docker build or jest run is going; not building now" >&2
    exit 2
  fi
  IMAGE="tokens-rig-auth:$(openssl rand -hex 4)"
  log "build $IMAGE from $ROOT"
  BUILT_IMAGE="$IMAGE"
  docker build -f "$ROOT/apps/auth/Dockerfile" -t "$IMAGE" "$ROOT"
fi

# Test tokens, new every run, one file each. `wrong` is held by no caller.
chmod 700 "$TMP"
mkdir -p "$TMP/tokens" "$TMP/db"
for name in download icloud-backup dev dev-idle-reaper wrong; do
  openssl rand -hex 32 > "$TMP/tokens/$name"
done
chmod 600 "$TMP/tokens/"*
: > "$TMP/db/auth.db"
tok() { cat "$TMP/tokens/$1"; }

# Backend env: rig test values, no file shared with production.
backend_env() {
  {
    echo "NODE_ENV=production"
    echo "BACKEND_PORT=8081"
    echo "DATABASE_PATH=/work/auth.db"
    echo "AUTH_HOST=https://auth.$DOMAIN"
    echo "COOKIE_DOMAIN=.$DOMAIN"
    echo "REDIRECT_ALLOWED_SUFFIX=$DOMAIN"
    echo "GOOGLE_CLIENT_ID=rig-test"
    echo "GOOGLE_CLIENT_SECRET=rig-test"
    echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
    echo "OIDC_IMMICH_CLIENT_SECRET=rig-test"
    echo "ADMIN_EMAILS=admin@$DOMAIN"
    echo "TZ=America/Los_Angeles"
    echo "INTERNAL_TOKEN_DOWNLOAD=$(tok download)"
    echo "INTERNAL_TOKEN_ICLOUD_BACKUP=$(tok icloud-backup)"
    echo "INTERNAL_TOKEN_DEV=$(tok dev)"
    echo "INTERNAL_TOKEN_DEV_IDLE_REAPER=$(tok dev-idle-reaper)"
    [ "$1" = enforce ] && echo "INTERNAL_TOKEN_ENFORCE=true"
  } > "$TMP/backend.env"
  chmod 600 "$TMP/backend.env"
}

docker network create --label "$RUN_LABEL" "$NETWORK" >/dev/null

start_backend() {
  docker rm -f "$RIG-auth" >/dev/null 2>&1 || true
  backend_env "$1"
  docker run -d --name "$RIG-auth" --label "$RUN_LABEL" --network "$NETWORK" \
    --network-alias auth --no-healthcheck --entrypoint node \
    --user "$(id -u):$(id -g)" -v "$TMP/db:/work" --env-file "$TMP/backend.env" \
    "$IMAGE" dist/main >/dev/null
  local _
  for _ in $(seq 1 60); do healthy && break; sleep 1; done
  if ! healthy; then
    echo "backend did not become healthy; last log lines (cookies masked):" >&2
    docker logs --tail 40 "$RIG-auth" 2>&1 | sed -E 's/("cookie":")[^"]*/\1<masked>/Ig' >&2
    exit 2
  fi
  echo "backend up, mode $1; enforce var set: $(docker exec "$RIG-auth" sh -c '[ -n "${INTERNAL_TOKEN_ENFORCE:-}" ] && echo yes || echo no')"
}

healthy() {
  docker exec "$RIG-auth" node -e \
    "fetch('http://127.0.0.1:8081/health').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))" \
    2>/dev/null
}

log "client container (the auth image's node, this checkout read-only at $ROOT)"
docker run -d --name "$RIG-client" --label "$RUN_LABEL" --network "$NETWORK" \
  --no-healthcheck --entrypoint node --user "$(id -u):$(id -g)" \
  -v "$ROOT:$ROOT:ro" -v "$TMP/tokens:/tokens:ro" \
  -e RIG_ROOT="$ROOT" -e RIG_TOKENS=/tokens -e RIG_AUTH_URL=http://auth:8081 \
  "$IMAGE" -e 'setInterval(() => {}, 1e6)' >/dev/null

log "reaper container ($REAPER_IMAGE, sh only, no docker socket)"
sed -n '/^fetch_host_activity() {/,/^}/p' "$ROOT/apps/dev-idle-reaper/reaper.sh" > "$TMP/fetch_host_activity.sh"
echo "fetch_host_activity: $(wc -l < "$TMP/fetch_host_activity.sh") lines taken from reaper.sh"
docker run -d --name "$RIG-reaper" --label "$RUN_LABEL" --network "$NETWORK" \
  --no-healthcheck --entrypoint sh --user "$(id -u):$(id -g)" \
  -v "$TMP/fetch_host_activity.sh:/fetch_host_activity.sh:ro" -v "$TMP/tokens:/tokens:ro" \
  "$REAPER_IMAGE" -c 'sleep 1000000' >/dev/null
echo "reaper: $(docker exec "$RIG-reaper" sh -c 'echo "alpine $(cat /etc/alpine-release), $(curl --version | head -1 | cut -d" " -f1-2), $(jq --version)"')"

RESULTS="$TMP/results.md"
FAILED=0
row() {
  printf '| %s | %s | %s | %s |\n' "$1" "$2" "$3" "$([ "$4" = 1 ] && echo PASS || echo FAIL)" | tee -a "$RESULTS"
}

# The reaper's function, unmodified, with AUTH_INTERNAL_TOKEN read from a
# token file inside the container ("none" leaves it empty).
reaper() {
  docker exec -e TOKEN_NAME="$1" "$RIG-reaper" sh -c '
    AUTH_URL=http://auth:8081
    AUTH_INTERNAL_TOKEN=""
    [ "$TOKEN_NAME" = none ] || AUTH_INTERNAL_TOKEN="$(cat "/tokens/$TOKEN_NAME")"
    . /fetch_host_activity.sh
    if out=$(fetch_host_activity app.rig.test 2); then echo "ok $out"; else echo "failed rc=$?"; fi'
}

open_routes() {
  local mode="$1" out
  out="$(docker exec "$RIG-client" node -e "
    const go = (path, init) => fetch('http://auth:8081' + path, { redirect: 'manual', ...init }).then(r => r.status + (r.headers.get('location') ? ' -> ' + new URL(r.headers.get('location')).pathname : ''))
    Promise.all([
      go('/health'),
      go('/verify', { headers: { 'X-Forwarded-Host': 'app.$DOMAIN', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Uri': '/' } }),
      go('/strip-cookie'),
    ]).then(a => console.log(a.join(' | ')))")"
  IFS='|' read -r h v s <<< "$out"
  h="$(echo "$h" | xargs)"; v="$(echo "$v" | xargs)"; s="$(echo "$s" | xargs)"
  row "$mode: /health, no token" 200 "$h" "$([ "$h" = 200 ] && echo 1)"
  row "$mode: /verify, X-Forwarded-Host/Proto, no cookie, no token" "302 to /login" "$v" "$([[ "$v" == 302* ]] && echo 1)"
  row "$mode: /strip-cookie, no token" 200 "$s" "$([ "$s" = 200 ] && echo 1)"
}

run_mode() {
  local mode="$1" out
  log "$mode: backend"
  start_backend "$mode"

  log "$mode: AuthClient and HostActivityService (checks 1-4)"
  docker exec "$RIG-client" node "$KIT_DIR/tokens-client.mjs" clients "$mode" | tee -a "$RESULTS" || FAILED=1

  log "$mode: reaper fetch_host_activity (check 5)"
  out="$(reaper dev-idle-reaper)"
  row "$mode: reaper, reaper token" "succeeds" "$out" "$([[ "$out" == ok* ]] && echo 1)"
  out="$(reaper none)"
  if [ "$mode" = enforce ]; then
    row "$mode: reaper, no token" "fails" "$out" "$([[ "$out" == failed* ]] && echo 1)"
  else
    row "$mode: reaper, no token" "succeeds" "$out" "$([[ "$out" == ok* ]] && echo 1)"
  fi
  out="$(reaper download)"
  if [ "$mode" = enforce ]; then
    row "$mode: reaper, download token" "fails" "$out" "$([[ "$out" == failed* ]] && echo 1)"
  else
    row "$mode: reaper, download token" "succeeds" "$out" "$([[ "$out" == ok* ]] && echo 1)"
  fi

  log "$mode: open routes (check 7)"
  open_routes "$mode"

  log "$mode: backend log (check 6)"
  docker logs "$RIG-auth" > "$TMP/$mode.log" 2>&1
  node "$KIT_DIR/tokens-client.mjs" log "$mode" < "$TMP/$mode.log" | tee -a "$RESULTS" || FAILED=1
  local leaks=0 name
  for name in download icloud-backup dev dev-idle-reaper wrong; do
    leaks=$((leaks + $(grep -cF -f "$TMP/tokens/$name" "$TMP/$mode.log" || true)))
  done
  row "$mode: log lines containing any test token" 0 "$leaks" "$([ "$leaks" = 0 ] && echo 1)"
  local bearer
  bearer="$(grep -ciE 'bearer [0-9a-f]' "$TMP/$mode.log" || true)"
  row "$mode: log lines with a bearer value" 0 "$bearer" "$([ "$bearer" = 0 ] && echo 1)"
}

run_mode enforce
run_mode observe

log "results"
echo '| check | expected | observed | result |'
echo '| ----- | -------- | -------- | ------ |'
cat "$RESULTS"
echo "passed: $(grep -c '| PASS |$' "$RESULTS"); failed: $(grep -c '| FAIL |$' "$RESULTS")"

if [ "$FAILED" -eq 0 ] && ! grep -q '| FAIL |$' "$RESULTS"; then STATUS=0; fi
