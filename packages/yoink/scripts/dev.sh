#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Development server runner
#
# Loads environment from infra/.env.yoink (auth, admin config), spins up a
# disposable Postgres container with dev-only credentials, pushes the schema,
# then starts the Next.js dev server. The container is torn down regardless
# of how the process exits (success, failure, or Ctrl+C).
# ---------------------------------------------------------------------------

ROOT_DIR="$(git rev-parse --show-toplevel)"
ENV_FILE="${ROOT_DIR}/infra/.env.yoink"

# ---------------------------------------------------------------------------
# Load environment from .env.yoink, then override DB vars for local dev
# ---------------------------------------------------------------------------

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "Warning: infra/.env.yoink not found — AUTH_* and ADMIN_EMAIL will be unset."
fi

# Load local dev overrides from .env.dev (gitignored). Values here take
# precedence over infra/.env.yoink. Copy .env.dev.example to get started.
LOCAL_ENV="${ROOT_DIR}/packages/yoink/.env.dev"
if [ -f "$LOCAL_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$LOCAL_ENV"
  set +a
fi

# Keep GOOGLE_CALLBACK_URL in sync with PORT for local dev so changing PORT
# in .env.dev doesn't silently break the OAuth redirect.
export GOOGLE_CALLBACK_URL="http://localhost:${PORT:-8080}/api/auth/google/callback"

# Derive WebSocket URL from BACKEND_PORT so the browser's Socket.IO client
# connects to the correct backend port rather than the hardcoded default.
export NEXT_PUBLIC_WS_URL="http://localhost:${BACKEND_PORT:-8081}"

CONTAINER_NAME="yoink-dev-db"
POSTGRES_IMAGE="postgres:17-alpine"
POSTGRES_PORT=5432

# Build DATABASE_URL from components so special chars in the password are
# properly percent-encoded (the raw value from .env.yoink is not URL-safe).
ENCODED_PASSWORD=$(python3 -c "import urllib.parse, os; print(urllib.parse.quote(os.environ['POSTGRES_PASSWORD'], safe=''))")
export DATABASE_URL="postgresql://${POSTGRES_USER}:${ENCODED_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}"

# ---------------------------------------------------------------------------
# Cleanup — always runs on exit (success, failure, or interrupt)
# ---------------------------------------------------------------------------

cleanup() {
  echo ""
  echo "Stopping and removing ${CONTAINER_NAME}..."
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
}

trap cleanup EXIT            # normal exit or set -e
trap 'exit 130' INT          # Ctrl+C  → triggers EXIT trap
trap 'exit 143' TERM         # kill    → triggers EXIT trap

# ---------------------------------------------------------------------------
# Start Postgres
# ---------------------------------------------------------------------------

echo "Starting ${CONTAINER_NAME} on port ${POSTGRES_PORT}..."

# Build the docker run args; conditionally add a volume mount for persistence.
DOCKER_RUN_ARGS=(
  -d
  --name "$CONTAINER_NAME"
  -e "POSTGRES_USER=${POSTGRES_USER}"
  -e "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}"
  -e "POSTGRES_DB=${POSTGRES_DB}"
  -p "${POSTGRES_PORT}:5432"
)

if [ -n "${DB_PATH:-}" ]; then
  echo "Mounting persistent DB storage at ${DB_PATH}"
  DOCKER_RUN_ARGS+=(-v "${DB_PATH}:/var/lib/postgresql/data")
else
  echo "No DB_PATH set — database will be ephemeral (set DB_PATH in .env.dev to persist data)."
fi

docker run "${DOCKER_RUN_ARGS[@]}" "$POSTGRES_IMAGE" > /dev/null

# Wait for Postgres to accept connections
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

echo "Pushing schema to dev database..."
npx drizzle-kit push --force

# ---------------------------------------------------------------------------
# Start backend and frontend dev servers
# ---------------------------------------------------------------------------

echo ""
echo "Starting backend and frontend dev servers..."
pnpm run dev:servers
