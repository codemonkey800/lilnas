#!/usr/bin/env bash
set -euo pipefail

# Forced SSH command for the `deploy` user. Installed by install-host.sh to
# /home/deploy/bin/lilnas-deploy-entry — outside the repo, so a bad commit can
# never replace the code that decides what CI is allowed to run.
#
# Accepts exactly, via $SSH_ORIGINAL_COMMAND:
#   deploy <40-hex-sha> [--dry-run] [--full] [--decrypt]
#                       [--pull a,b] [--up c,d] [--force-recreate e,f]
#   deploy --help
# Anything else — extra words, shell metacharacters, unknown flags — is rejected.
#
# Then: take the deploy lock, fetch, confirm the sha is on some origin/* ref,
# check it out detached, and run a *copy* of scripts/deploy/lilnas-deploy.sh
# from a temp dir (bash reads scripts lazily; never run the file being swapped).

DEPLOY_ROOT=/opt/lilnas
KEYS_FILE="$DEPLOY_ROOT/.env.keys"
LOCK_FILE="$DEPLOY_ROOT/.deploy.lock"
LOCK_WAIT=600
LOG_TAG=lilnas-deploy-entry

usage() {
  cat <<'EOF'
usage: deploy <40-hex-sha> [--dry-run] [--full] [--decrypt]
              [--pull a,b] [--up c,d] [--force-recreate e,f]
       deploy --help
EOF
}

reject() {
  echo "lilnas-deploy-entry: rejected: $*" >&2
  logger -t "$LOG_TAG" "rejected: $*" || true
  exit 2
}

cmd="${SSH_ORIGINAL_COMMAND:-}"
[[ -n "$cmd" ]] || reject "no command (interactive login is not allowed)"

# Whole-string allowlist first: words, hex, commas, dashes, single spaces.
[[ "$cmd" =~ ^[A-Za-z0-9,-]+(\ [A-Za-z0-9,-]+)*$ ]] || reject "bad characters in command"

read -r -a words <<<"$cmd"
[[ "${words[0]}" == "deploy" ]] || reject "unknown command: ${words[0]}"

if [[ ${#words[@]} -eq 2 && "${words[1]}" == "--help" ]]; then
  usage
  exit 0
fi

[[ ${#words[@]} -ge 2 ]] || reject "missing sha"
sha="${words[1]}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || reject "not a 40-hex sha: $sha"

args=("$sha")
i=2
while [[ $i -lt ${#words[@]} ]]; do
  w="${words[$i]}"
  case "$w" in
    --dry-run | --full | --decrypt)
      args+=("$w")
      ;;
    --pull | --up | --force-recreate)
      next=$((i + 1))
      [[ $next -lt ${#words[@]} ]] || reject "$w needs a service list"
      list="${words[$next]}"
      [[ "$list" =~ ^[a-z0-9-]+(,[a-z0-9-]+)*$ ]] || reject "bad service list for $w: $list"
      args+=("$w" "$list")
      i=$next
      ;;
    *) reject "unknown flag: $w" ;;
  esac
  i=$((i + 1))
done

logger -t "$LOG_TAG" "accepted: ${args[*]}" || true

cd "$DEPLOY_ROOT"
exec 9>"$LOCK_FILE"
flock -w "$LOCK_WAIT" 9 || reject "another deploy is still running after ${LOCK_WAIT}s"

git fetch --prune origin
git cat-file -e "$sha^{commit}" 2>/dev/null || reject "sha $sha not found after fetch"
if [[ -z "$(git branch -r --contains "$sha" 'origin/*' 2>/dev/null)" ]]; then
  reject "sha $sha is not reachable from any origin/* ref"
fi

git checkout --quiet --detach "$sha"
echo "lilnas-deploy-entry: checked out $sha"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp scripts/deploy/lilnas-deploy.sh scripts/deploy/decrypt-env.sh "$tmp/"
chmod 0700 "$tmp"/*.sh

# Run the copy (not exec: the EXIT trap removes the temp dir and fd 9 keeps
# the lock for the whole deploy either way).
DEPLOY_ROOT="$DEPLOY_ROOT" KEYS_FILE="$KEYS_FILE" "$tmp/lilnas-deploy.sh" "${args[@]}"
