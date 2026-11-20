#!/bin/sh
# Backend container entrypoint (deploy.yml / deploy.dev.yml, backend service).
#
# icloudpd 1.32.3 has no option for the address or port of its sign-in web
# form (`waitress.serve(app)`), so during a sign-in it listens on every
# interface and any container on the compose network could reach the Apple
# password and code form. Only the backend itself (over 127.0.0.1) may.
#
# This script runs as root with CAP_NET_ADMIN, drops inbound TCP to 8080 on
# every interface but `lo` (IPv4 and IPv6, in this container's own network
# namespace), checks that the rule is really there, and only then replaces
# itself with the backend as uid 1000 with no capabilities. If any step fails
# the container exits and the app never starts. The backend's own port (8081)
# and all outbound traffic are untouched.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "backend-entrypoint: must run as root to install the firewall rule" >&2
  exit 1
fi

table=icloud_backup_fw

# `add` then `delete` makes the load idempotent, and a single `nft -f` is atomic.
nft -f - <<RULES
add table inet $table
delete table inet $table
table inet $table {
  chain input {
    type filter hook input priority 0; policy accept;
    iifname != "lo" tcp dport 8080 drop
  }
}
RULES

# Fail closed: the rule must be in the live ruleset, not just accepted.
ruleset=$(nft list table inet "$table")
case $ruleset in
  *'iifname != "lo" tcp dport 8080 drop'*) ;;
  *)
    echo "backend-entrypoint: the port 8080 drop rule is not in the ruleset" >&2
    echo "$ruleset" >&2
    exit 1
    ;;
esac
echo "backend-entrypoint: inbound tcp/8080 dropped on every interface but lo"

# node ends up as PID 1 (exec chain), uid/gid 1000, no capabilities, so it
# still receives SIGTERM from `docker stop`.
export HOME=/home/node
exec setpriv \
  --reuid 1000 --regid 1000 --clear-groups \
  --inh-caps=-all --bounding-set=-all \
  node dist/main
