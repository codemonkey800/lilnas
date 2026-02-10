#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Integration test runner
#
# Spins up a disposable Postgres container, runs the integration tests,
# then tears the container down regardless of test outcome.
# ---------------------------------------------------------------------------

CONTAINER_NAME="sync-test-db"
POSTGRES_IMAGE="postgres:16-alpine"
POSTGRES_PORT=5433
POSTGRES_USER="sync_test"
POSTGRES_PASSWORD="testpass"
POSTGRES_DB="sync_test"

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

trap cleanup EXIT

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

echo "Pushing schema to test database..."
DATABASE_URL="$DATABASE_URL" npx drizzle-kit push --force

# ---------------------------------------------------------------------------
# Run tests
# ---------------------------------------------------------------------------

echo "Running integration tests..."
DATABASE_URL="$DATABASE_URL" vitest run -c vitest.config.integration.ts
