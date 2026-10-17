#!/usr/bin/env bash
set -euo pipefail

# Deploys the lilnas compose stack from $DEPLOY_ROOT. Runs as the `deploy`
# user *after* lilnas-deploy-entry has checked out <sha>; the entrypoint runs a
# copy of this file from a temp dir, so decrypt-env.sh is resolved relative to
# wherever this copy lives.
#
# Usage: lilnas-deploy.sh <sha> [--dry-run] [--full] [--decrypt]
#                               [--pull a,b] [--up c,d] [--force-recreate e,f]
#
# LILNAS_TAG is deliberately never set here (images resolve to :latest); it is
# the manual rollback lever for a human running compose by hand.

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/lilnas}"
KEYS_FILE="${KEYS_FILE:-$DEPLOY_ROOT/.env.keys}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DECRYPT_ENV="$SCRIPT_DIR/decrypt-env.sh"
LOG_TAG=lilnas-deploy

usage() {
  sed -n '/^# Usage:/,/^#$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

die() {
  echo "lilnas-deploy: $*" >&2
  logger -t "$LOG_TAG" "failed: $*" || true
  exit 1
}

check_services() {
  # Validated by the entrypoint, re-checked here. Must run in the main shell
  # (not inside a process substitution) so `die` actually exits.
  [[ "$1" =~ ^[a-z0-9-]+(,[a-z0-9-]+)*$ ]] || die "invalid service list: $1"
}

split_services() {
  # "a,b,c" -> one service per line
  tr ',' '\n' <<<"$1"
}

[[ $# -ge 1 ]] || {
  usage >&2
  exit 1
}

sha="$1"
shift
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "expected a 40-hex sha, got: $sha"

dry_run=0
full=0
decrypt=0
pull_services=()
up_services=()
force_services=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --full) full=1 ;;
    --decrypt) decrypt=1 ;;
    --pull)
      [[ $# -ge 2 ]] || die "--pull needs a service list"
      check_services "$2"
      mapfile -t -O "${#pull_services[@]}" pull_services < <(split_services "$2")
      shift
      ;;
    --up)
      [[ $# -ge 2 ]] || die "--up needs a service list"
      check_services "$2"
      mapfile -t -O "${#up_services[@]}" up_services < <(split_services "$2")
      shift
      ;;
    --force-recreate)
      [[ $# -ge 2 ]] || die "--force-recreate needs a service list"
      check_services "$2"
      mapfile -t -O "${#force_services[@]}" force_services < <(split_services "$2")
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

run() {
  if [[ "$dry_run" == 1 ]]; then
    echo "[dry-run] $*"
  else
    echo "+ $*"
    "$@"
  fi
}

cd "$DEPLOY_ROOT"
[[ -x "$DECRYPT_ENV" ]] || die "missing $DECRYPT_ENV"

summary="sha=$sha dry_run=$dry_run full=$full decrypt=$decrypt"
summary+=" pull=${pull_services[*]:-} up=${up_services[*]:-} force=${force_services[*]:-}"
logger -t "$LOG_TAG" "start $summary" || true
echo "lilnas-deploy: start $summary"

# 1. Decrypt env files when asked, on --full, or when any .decrypted sibling is
#    missing (first run on a fresh host). Always real, even under --dry-run.
need_decrypt=$decrypt
[[ "$full" == 1 ]] && need_decrypt=1
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if [[ ! -f "$f.decrypted" ]]; then
    echo "lilnas-deploy: $f.decrypted is missing; decrypting"
    need_decrypt=1
  fi
done < <("$DECRYPT_ENV" --list "$DEPLOY_ROOT")

if [[ "$need_decrypt" == 1 ]]; then
  "$DECRYPT_ENV" "$DEPLOY_ROOT" "$KEYS_FILE" || die "decrypt-env failed"
fi

# 2. Validate the whole stack before touching anything.
docker compose config -q || die "docker compose config failed; nothing deployed"

# 3. Apply.
touched=()
if [[ "$full" == 1 ]]; then
  # No --ignore-buildable: every locally built service keeps a `build:` next
  # to its ghcr.io `image:`, and that flag would skip exactly the images CI
  # just pushed. A buildable image that fails to pull fails the deploy rather
  # than leaving the stale local :latest running.
  run docker compose pull
  run docker compose up -d
else
  if [[ ${#pull_services[@]} -gt 0 ]]; then
    run docker compose pull "${pull_services[@]}"
    run docker compose up -d "${pull_services[@]}"
    touched+=("${pull_services[@]}")
  fi
  if [[ ${#up_services[@]} -gt 0 ]]; then
    run docker compose up -d "${up_services[@]}"
    touched+=("${up_services[@]}")
  fi
  if [[ ${#force_services[@]} -gt 0 ]]; then
    run docker compose up -d --force-recreate "${force_services[@]}"
    touched+=("${force_services[@]}")
  fi
  if [[ ${#touched[@]} -eq 0 ]]; then
    echo "lilnas-deploy: no services requested; only decrypt/config ran"
  fi
fi

# 4. Drop dangling images, then show what we touched.
run docker image prune -f
if [[ "$full" == 1 ]]; then
  run docker compose ps
elif [[ ${#touched[@]} -gt 0 ]]; then
  run docker compose ps "${touched[@]}"
fi

logger -t "$LOG_TAG" "done $summary" || true
echo "lilnas-deploy: done"
