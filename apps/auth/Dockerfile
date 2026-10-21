# Multi-stage Dockerfile for @lilnas/auth
#
# Deliberately minimal compared to apps/download/Dockerfile: download's
# production stage installs ffmpeg/yt-dlp because it needs them at runtime.
# lilnas-auth needs no extra system packages — just the pnpm build +
# lilnas-nextjs-runtime pattern.

# Dependency caching stage
FROM ghcr.io/codemonkey800/lilnas-monorepo-builder:latest AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/auth/package.json apps/auth/
COPY packages/cli/package.json packages/cli/
COPY packages/utils/package.json packages/utils/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/
COPY packages/tsc7/ packages/tsc7/

# Install dependencies (this layer gets cached)
RUN pnpm install --frozen-lockfile

# Build stage
FROM deps AS builder

# COPY . . brings in every workspace package.json, so pnpm's verify-deps-before-run
# would run a full-workspace install before the first build. The deps stage's
# install already covers this app's subset.
ENV pnpm_config_verify_deps_before_run=false

# Copy source code (this layer changes frequently)
COPY . .

# Build the lilnas-auth package — both the NestJS backend and the Next.js
# frontend (package.json's "build" script runs both via run-p).
#
# Builds go through the self-hosted Turbo remote cache (docs/deploy.md) when
# CI passes the TURBO_* BuildKit secrets; without them turbo compiles locally.
# A cache hit restores packages/*/dist but skips pnpm's injected-deps sync, so
# the dependencies build first and the offline install re-syncs their copies
# in apps/auth/node_modules/@lilnas/* before the app build reads them.
RUN --mount=type=secret,id=TURBO_API,env=TURBO_API \
    --mount=type=secret,id=TURBO_TEAM,env=TURBO_TEAM \
    --mount=type=secret,id=TURBO_TOKEN,env=TURBO_TOKEN \
    --mount=type=secret,id=TURBO_REMOTE_CACHE_SIGNATURE_KEY,env=TURBO_REMOTE_CACHE_SIGNATURE_KEY \
    pnpm build --filter='@lilnas/auth^...' \
    && pnpm install --frozen-lockfile --offline --filter='@lilnas/auth...' \
    && pnpm build --filter=@lilnas/auth

# Deploy production dependencies. package.json's "files" field (["./dist"])
# tells pnpm deploy to include the Nest build output.
RUN pnpm --filter=auth --prod deploy /app

# Copy the Next standalone build next to the backend. It carries only the
# frontend's traced node_modules, so next/react/react-dom stay out of /app's
# prod dependencies (they are devDependencies). static/ and public/ go inside
# it, beside the standalone server.js: Next's standalone server resolves both
# relative to its OWN location (frontend/apps/auth/), so public/ anywhere else
# is silently never served (confirmed live: sad-pepe.svg 404'd until it sat
# beside server.js).
RUN cp -a apps/auth/.next/standalone /app/frontend \
    && cp -a apps/auth/.next/static /app/frontend/apps/auth/.next/static \
    && if [ -d apps/auth/public ]; then \
         cp -a apps/auth/public /app/frontend/apps/auth/public; \
       fi

# Verify the standalone server was copied correctly
RUN test -f /app/frontend/apps/auth/server.js || (echo "ERROR: Standalone server not found" && exit 1)

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
FROM ghcr.io/codemonkey800/lilnas-nextjs-runtime:latest AS runtime

# Copy the built application with non-root ownership so the node user
# (UID 1000) can read/execute everything in /app at runtime (matches
# apps/swole/Dockerfile — lilnas-auth also owns a persistent SQLite volume).
COPY --from=builder --chown=node:node /app /app

WORKDIR /app

USER node

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["pnpm", "start"]
