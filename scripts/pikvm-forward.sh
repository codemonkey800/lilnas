#!/bin/bash
set -e

# Forwards a local port to the pikvm's HTTPS port through lilnas.io over SSH.
# Runs in the foreground (Ctrl+C to stop) and never allocates a remote shell/tty.

DEFAULT_PORT=8443
PORT="$DEFAULT_PORT"
PIKVM_HOST="192.168.1.216"
PIKVM_PORT=443
SSH_HOST="lilnas.io"
SSH_PORT=22

usage() {
    echo "Usage: $0 [--port <local-port>]"
    echo ""
    echo "  --port   Local port to forward to the pikvm (default: ${DEFAULT_PORT})"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --port)
            PORT="$2"
            shift 2
            ;;
        -h | --help)
            usage
            ;;
        *)
            echo "Unknown argument: $1"
            usage
            ;;
    esac
done

echo "Forwarding localhost:${PORT} -> ${PIKVM_HOST}:${PIKVM_PORT} via ${SSH_HOST}"
echo "Once connected, browse https://localhost:${PORT}"

exec ssh -N -L "${PORT}:${PIKVM_HOST}:${PIKVM_PORT}" -p "${SSH_PORT}" "${SSH_HOST}"
