# Multi-stage Dockerfile for @lilnas/auth
#
# Deliberately minimal compared to apps/download/Dockerfile: download's
# production stage installs ffmpeg/yt-dlp because it needs them at runtime.
# lilnas-auth needs no extra system packages — just the pnpm build +
# lilnas-nextjs-runtime pattern.

# Dependency caching stage
FROM lilnas-monorepo-builder AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/auth/package.json apps/auth/
COPY packages/cli/package.json packages/cli/
COPY packages/utils/package.json packages/utils/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/

# Install dependencies (this layer gets cached)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install

# Build stage
FROM deps AS builder

# Copy source code (this layer changes frequently)
COPY . .

# Build the lilnas-auth package — both the NestJS backend and the Next.js
# frontend (package.json's "build" script runs both via run-p).
RUN pnpm build --filter=@lilnas/auth

# Deploy production dependencies. package.json's "files" field
# (["./.next", "./dist"]) tells pnpm deploy to include both build outputs.
RUN pnpm --filter=auth --prod deploy /app

# Copy the built Next.js application
RUN cp -r /source/apps/auth/.next /app/.next

# Copy the standalone server to the correct location
RUN cp /source/apps/auth/.next/standalone/apps/auth/server.js /app/server.js

# Copy public directory if it exists — to /app/public, a SIBLING of
# server.js (flattened to /app/server.js above, not left at its original
# nested .next/standalone/apps/auth/server.js path). Next's
# standalone server resolves public/ relative to its OWN location, so it
# must land at /app/public, not /app/.next/standalone/public — the latter
# is silently never served (confirmed live: sad-pepe.svg 404'd until this
# was fixed, since this app had no public/ directory at all before it).
RUN if [ -d /source/apps/auth/public ]; then \
      cp -r /source/apps/auth/public /app/public; \
    fi

# Copy static files to standalone directory
RUN if [ -d /app/.next/static ]; then \
      cp -r /app/.next/static /app/.next/standalone/.next/; \
    fi

# Verify the standalone server was copied correctly
RUN test -f /app/server.js || (echo "ERROR: Standalone server not found" && exit 1)

# Copy migrations into the runtime image so database.module.ts can apply
# them on boot. resolveMigrationsFolder() resolves the path via
# process.cwd() + src/db/migrations (WORKDIR below is /app), so the folder
# must live at /app/src/db/migrations. The MIGRATIONS_FOLDER env var is also
# honored as an override if needed. Mirrors apps/swole/Dockerfile's identical
# requirement.
RUN mkdir -p /app/src/db && \
    cp -r /source/apps/auth/src/db/migrations /app/src/db/migrations

# Verify the Nest backend build output landed where start:backend expects it
# (node dist/main) — fail the build loudly here rather than at container
# boot if pnpm deploy's file-field handling ever changes.
RUN test -f /app/dist/main.js || (echo "ERROR: dist/main.js not found" && exit 1)

# Runtime stage
FROM lilnas-nextjs-runtime AS runtime

# Copy the built application with non-root ownership so the node user
# (UID 1000) can read/execute everything in /app at runtime (matches
# apps/swole/Dockerfile — lilnas-auth also owns a persistent SQLite volume).
COPY --from=builder --chown=node:node /app /app

WORKDIR /app

USER node

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["pnpm", "start"]
