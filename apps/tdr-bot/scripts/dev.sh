#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Development server runner
#
# Loads environment from infra/.env.tdr-bot, spins up a disposable Postgres
# container with dev-only credentials, pushes the schema, then starts the
# dev servers. The container is torn down regardless of how the process
# exits (success, failure, or Ctrl+C).
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
# Start Postgres
# ---------------------------------------------------------------------------

CONTAINER_NAME="tdr-bot-dev-db"
POSTGRES_IMAGE="postgres:17-alpine"
POSTGRES_PORT=5433

ENCODED_PASSWORD=$(python3 -c "import urllib.parse, os; print(urllib.parse.quote(os.environ['POSTGRES_PASSWORD'], safe=''))")
export DATABASE_URL="postgresql://${POSTGRES_USER}:${ENCODED_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}"
export POSTGRES_HOST=localhost
export POSTGRES_PORT

# ---------------------------------------------------------------------------
# Cleanup — always runs on exit (success, failure, or interrupt)
# ---------------------------------------------------------------------------

cleanup() {
  echo ""
  echo "Stopping and removing ${CONTAINER_NAME}..."
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---------------------------------------------------------------------------
# Start Postgres container
# ---------------------------------------------------------------------------

echo "Starting ${CONTAINER_NAME} on port ${POSTGRES_PORT}..."

TEMP_ENV=$(mktemp)
chmod 600 "$TEMP_ENV"
printf 'POSTGRES_USER=%s\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=%s\n' \
  "$POSTGRES_USER" "$POSTGRES_PASSWORD" "$POSTGRES_DB" > "$TEMP_ENV"

DOCKER_RUN_ARGS=(
  -d
  --name "$CONTAINER_NAME"
  --env-file "$TEMP_ENV"
  -p "${POSTGRES_PORT}:5432"
)

if [ -n "${DB_PATH:-}" ]; then
  echo "Mounting persistent DB storage at ${DB_PATH}"
  DOCKER_RUN_ARGS+=(-v "${DB_PATH}:/var/lib/postgresql/data")
else
  echo "No DB_PATH set — database will be ephemeral (set DB_PATH in .env.dev to persist data)."
fi

docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
docker run "${DOCKER_RUN_ARGS[@]}" "$POSTGRES_IMAGE" > /dev/null
rm -f "$TEMP_ENV"

echo "Waiting for Postgres to be ready..."
for i in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" > /dev/null 2>&1; then
    echo "Postgres is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Postgres failed to start within 30 seconds."
    exit 1
  fi
  sleep 1
done

# ---------------------------------------------------------------------------
# Push schema from Drizzle models (single source of truth)
# ---------------------------------------------------------------------------

if [ -n "${DB_PATH:-}" ]; then
  echo "Pushing schema to persistent dev database (interactive)..."
  npx drizzle-kit push
else
  echo "Pushing schema to ephemeral dev database..."
  npx drizzle-kit push --force
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
