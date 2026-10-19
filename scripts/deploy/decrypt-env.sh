#!/usr/bin/env bash
set -euo pipefail

# Host twin of `lilnas secrets decrypt`: writes a plaintext `<file>.decrypted`
# sibling (mode 0600, written atomically) next to every encrypted env file the
# compose stack loads, with dotenvx's banner and the DOTENV_PUBLIC_KEY line
# stripped so the container env is identical to the pre-encryption files.
#
# Usage: decrypt-env.sh [root] [keys-file]
#        decrypt-env.sh --list [root]      # print the discovered files, no decrypt
#
# Discovery rule (must match packages/cli): tracked files matching
# apps/*/.env.prod, infra/.env, infra/.env.*, excluding *.example and *.decrypted.

DEPLOY_ROOT=/opt/lilnas
DOTENVX=@dotenvx/dotenvx@2.38.0
PNPM=/usr/bin/pnpm

# The repo's package.json pins a different pnpm via `packageManager`; stop
# corepack from refusing the system pnpm on the deploy host.
export COREPACK_ENABLE_STRICT=0

list_only=0
if [[ "${1:-}" == "--list" ]]; then
  list_only=1
  shift
fi

ROOT="${1:-$DEPLOY_ROOT}"
KEYS="${2:-$ROOT/.env.keys}"

discover() {
  git -C "$ROOT" ls-files -- 'apps/*/.env.prod' 'infra/.env' 'infra/.env.*' |
    grep -E '^(apps/[^/]+/\.env\.prod|infra/\.env(\.[^/]+)?)$' |
    grep -v -E '\.(example|decrypted)$' || true
}

if [[ "$list_only" == 1 ]]; then
  discover
  exit 0
fi

if [[ ! -r "$KEYS" ]]; then
  echo "decrypt-env: keys file not readable: $KEYS" >&2
  exit 1
fi

mapfile -t files < <(discover)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "decrypt-env: no encrypted env files tracked under $ROOT" >&2
  exit 1
fi

status=0
for rel in "${files[@]}"; do
  src="$ROOT/$rel"
  dest="$src.decrypted"
  tmp="$(mktemp "$dest.XXXXXX")"
  chmod 0600 "$tmp"

  # Decrypt to stdout, then drop the dotenvx banner (`#/ ... /` lines) and the
  # public key line. Never echo the content anywhere but the destination file.
  (cd "$ROOT" && "$PNPM" dlx "$DOTENVX" decrypt -fk "$KEYS" -f "$src" --stdout) 2>/dev/null |
    grep -v -E '^#/|^DOTENV_PUBLIC_KEY' >"$tmp" || true
  # dotenvx's exit code is not the signal (`grep -v` also exits 1 on an empty
  # result); what matters is whether any value is still encrypted or missing.
  if [[ ! -s "$tmp" ]] || grep -q -E '^[A-Za-z_][A-Za-z0-9_]*=.?encrypted:' "$tmp"; then
    echo "decrypt-env: FAILED $rel" >&2
    rm -f "$tmp"
    status=1
    continue
  fi

  mv -f "$tmp" "$dest"
  echo "decrypted $rel"
done

exit "$status"
