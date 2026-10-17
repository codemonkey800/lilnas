#!/usr/bin/env bash
set -euo pipefail

# One-time host provisioning for push-to-deploy. Run once as root (H3), from a
# checkout of the repo: `sudo scripts/deploy/install-host.sh`. Idempotent — every
# step checks before it acts, so re-running after a partial failure is safe.
#
# What it sets up:
#   - system user `deploy` (home /home/deploy, bash, in `docker`)
#   - /opt/lilnas: a clone of the repo owned by `deploy` (left alone if present)
#   - /opt/lilnas/.env.keys copied from Jeremy's checkout (deploy:deploy 0600)
#   - /home/deploy/bin/lilnas-deploy-entry: the forced SSH command
#   - /home/deploy/.ssh/ci-deploy-key (+ authorized_keys pinned to the entrypoint)
#   - `deploy` appended to AllowUsers in the sshd hardening drop-in
# It never prints key material; the next steps are printed at the end.

DEPLOY_USER=deploy
DEPLOY_HOME=/home/deploy
DEPLOY_ROOT=/opt/lilnas
KEYS_FILE="$DEPLOY_ROOT/.env.keys"
KEYS_SOURCE=/home/jeremy/lilnas/.env.keys
REPO=https://github.com/codemonkey800/lilnas.git
ENTRY_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lilnas-deploy-entry.sh"
ENTRY_DEST="$DEPLOY_HOME/bin/lilnas-deploy-entry"
SSH_DIR="$DEPLOY_HOME/.ssh"
CI_KEY="$SSH_DIR/ci-deploy-key"
SSHD_DROPIN=/etc/ssh/sshd_config.d/10-hardening.conf
TAILNET_HOST=lilnas.tail77e8b0.ts.net

log() { echo "install-host: $*"; }
die() {
  echo "install-host: $*" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || die "run as root (sudo $0)"
[[ -f "$ENTRY_SRC" ]] || die "entrypoint not found next to this script: $ENTRY_SRC"
[[ -f "$KEYS_SOURCE" ]] || die "keys file missing: $KEYS_SOURCE (run \`lilnas secrets\` setup first)"
getent group docker >/dev/null || die "group 'docker' does not exist; is Docker installed?"

# 1. deploy user
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  log "user $DEPLOY_USER exists"
else
  useradd --system --create-home --home-dir "$DEPLOY_HOME" --shell /bin/bash \
    --groups docker "$DEPLOY_USER"
  log "created user $DEPLOY_USER"
fi
if ! id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker; then
  usermod -aG docker "$DEPLOY_USER"
  log "added $DEPLOY_USER to docker"
fi
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0750 "$DEPLOY_HOME" "$DEPLOY_HOME/bin"

# 2. repo clone
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 "$DEPLOY_ROOT"
if [[ -d "$DEPLOY_ROOT/.git" ]]; then
  log "$DEPLOY_ROOT already cloned; leaving it alone"
else
  runuser -u "$DEPLOY_USER" -- git clone "$REPO" "$DEPLOY_ROOT"
  log "cloned $REPO to $DEPLOY_ROOT"
fi

# 3. dotenvx private keys (contents never echoed)
install -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0600 "$KEYS_SOURCE" "$KEYS_FILE"
log "installed $KEYS_FILE (0600)"

# 4. forced-command entrypoint, outside the repo
install -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 "$ENTRY_SRC" "$ENTRY_DEST"
bash -n "$ENTRY_DEST"
log "installed $ENTRY_DEST"

# 5. CI key + authorized_keys pinned to the entrypoint
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0700 "$SSH_DIR"
if [[ -f "$CI_KEY" ]]; then
  log "CI key exists: $CI_KEY"
else
  ssh-keygen -q -t ed25519 -N '' -C "lilnas-ci-deploy" -f "$CI_KEY"
  chmod 0600 "$CI_KEY"
  log "generated $CI_KEY"
fi
if [[ ! -f "$CI_KEY.pub" ]]; then
  ssh-keygen -y -f "$CI_KEY" >"$CI_KEY.pub"
fi
pubkey="$(cut -d' ' -f1,2 "$CI_KEY.pub")"
printf 'command="%s",restrict %s lilnas-ci-deploy\n' "$ENTRY_DEST" "$pubkey" \
  >"$SSH_DIR/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$SSH_DIR/authorized_keys"
chmod 0600 "$SSH_DIR/authorized_keys"
log "wrote $SSH_DIR/authorized_keys (forced command, restrict)"

# 6. sshd AllowUsers
if [[ -f "$SSHD_DROPIN" ]] && grep -qE '^AllowUsers\b' "$SSHD_DROPIN"; then
  if grep -qE "^AllowUsers\b.*\b$DEPLOY_USER\b" "$SSHD_DROPIN"; then
    log "AllowUsers already includes $DEPLOY_USER"
  else
    sed -i -E "s/^(AllowUsers\b.*)$/\1 $DEPLOY_USER/" "$SSHD_DROPIN"
    log "appended $DEPLOY_USER to AllowUsers in $SSHD_DROPIN"
  fi
  sshd -t
  systemctl reload sshd
  log "sshd config valid, reloaded"
else
  log "WARNING: no AllowUsers line in $SSHD_DROPIN; not touching sshd (deploy must be allowed to log in)"
fi

cat <<EOF

install-host: done. Next steps (run as jeremy):

  1. Store the private key as a GitHub Actions secret, then destroy the host copy:
       sudo cat $CI_KEY | gh secret set DEPLOY_SSH_KEY -R codemonkey800/lilnas
       sudo shred -u $CI_KEY

  2. Smoke test the forced command over the tailnet (no containers are touched):
       ssh -i <key> deploy@$TAILNET_HOST "deploy \$(git rev-parse HEAD) --dry-run --full"
     (use a local copy of the key from step 1, or run the test before shredding)
EOF
