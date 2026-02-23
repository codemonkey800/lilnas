#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Development server runner
#
# Spins up a disposable Postgres container, pushes the schema, then starts
# the Next.js dev server. The container is torn down regardless of how the
# process exits (success, failure, or Ctrl+C).
# ---------------------------------------------------------------------------

CONTAINER_NAME="yoink-dev-db"
POSTGRES_IMAGE="postgres:17-alpine"
POSTGRES_PORT=5432
POSTGRES_USER="yoink"
POSTGRES_PASSWORD="yoink"
POSTGRES_DB="yoink"

DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}"

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
docker run -d \
  --name "$CONTAINER_NAME" \
  -e "POSTGRES_USER=${POSTGRES_USER}" \
  -e "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
  -e "POSTGRES_DB=${POSTGRES_DB}" \
  -p "${POSTGRES_PORT}:5432" \
  "$POSTGRES_IMAGE" > /dev/null

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
DATABASE_URL="$DATABASE_URL" npx drizzle-kit push --force

# ---------------------------------------------------------------------------
# Start Next.js dev server
# ---------------------------------------------------------------------------

echo ""
echo "Starting Next.js dev server..."
DATABASE_URL="$DATABASE_URL" npx next dev --turbopack -p 8080
