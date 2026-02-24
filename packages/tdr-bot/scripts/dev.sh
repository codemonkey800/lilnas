#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Development server runner
#
# Loads environment from infra/.env.tdr-bot, then starts the NestJS dev
# server with SWC and pino-pretty log formatting.
# ---------------------------------------------------------------------------

ROOT_DIR="$(git rev-parse --show-toplevel)"
ENV_FILE="${ROOT_DIR}/infra/.env.tdr-bot"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "Warning: infra/.env.tdr-bot not found — env vars will be unset."
fi

npx nest start -w -b swc | pino-pretty
