#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Development server runner
#
# Loads environment from infra/.env.tdr-bot, applies local overrides from
# .env.dev, then starts the backend and frontend dev servers in parallel.
#
# Usage:
#   ./scripts/dev.sh           # start both backend + frontend
#   ./scripts/dev.sh backend   # start backend only (used by dev:graph-test)
# ---------------------------------------------------------------------------

ROOT_DIR="$(git rev-parse --show-toplevel)"
ENV_FILE="${ROOT_DIR}/infra/.env.tdr-bot"

# ---------------------------------------------------------------------------
# Load environment from .env.tdr-bot, then apply local dev overrides
# ---------------------------------------------------------------------------

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "Warning: infra/.env.tdr-bot not found — env vars will be unset."
fi

LOCAL_ENV="${ROOT_DIR}/apps/tdr-bot/.env.dev"
if [ -f "$LOCAL_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$LOCAL_ENV"
  set +a
fi

# ---------------------------------------------------------------------------
# Start dev servers
# ---------------------------------------------------------------------------

MODE="${1:-servers}"

case "$MODE" in
  backend)
    echo "Starting backend dev server..."
    pnpm run dev:backend
    ;;
  *)
    echo "Starting backend and frontend dev servers..."
    pnpm run dev:servers
    ;;
esac
