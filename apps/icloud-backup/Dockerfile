# Multi-stage Dockerfile for @lilnas/icloud-backup.
#
# One image, two services (deploy.yml): the NestJS backend and the Next.js
# frontend. The runtime also carries the pinned icloudpd binary the backend
# shells out to.

# Dependency caching stage
FROM ghcr.io/codemonkey800/lilnas-monorepo-builder:latest AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/icloud-backup/package.json apps/icloud-backup/
COPY packages/cli/package.json packages/cli/
COPY packages/utils/package.json packages/utils/
COPY packages/ui/package.json packages/ui/
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

# Build the icloud-backup package: the NestJS backend and the Next.js frontend
# (package.json's "build" script runs both).
#
# Builds go through the self-hosted Turbo remote cache (docs/deploy.md) when
# CI passes the TURBO_* BuildKit secrets; without them turbo compiles locally.
# A cache hit restores packages/*/dist but skips pnpm's injected-deps sync, so
# the dependencies build first and the offline install re-syncs their copies
# in apps/icloud-backup/node_modules/@lilnas/* before the app build reads them.
RUN --mount=type=secret,id=TURBO_API,env=TURBO_API \
    --mount=type=secret,id=TURBO_TEAM,env=TURBO_TEAM \
    --mount=type=secret,id=TURBO_TOKEN,env=TURBO_TOKEN \
    --mount=type=secret,id=TURBO_REMOTE_CACHE_SIGNATURE_KEY,env=TURBO_REMOTE_CACHE_SIGNATURE_KEY \
    pnpm build --filter='@lilnas/icloud-backup^...' \
    && pnpm install --frozen-lockfile --offline --filter='@lilnas/icloud-backup...' \
    && pnpm build --filter=@lilnas/icloud-backup

# Deploy production dependencies. package.json's "files" field (["./dist"])
# tells pnpm deploy to include the Nest build output.
RUN pnpm --filter=icloud-backup --prod deploy /app

# Copy the Next standalone build next to the backend. It carries only the
# frontend's traced node_modules, so next/react/react-dom stay out of /app's
# prod dependencies (they are devDependencies). static/ and public/ go inside
# it, beside the standalone server.js: Next's standalone server resolves both
# relative to its OWN location (frontend/apps/icloud-backup/), so they are
# silently never served from anywhere else.
RUN cp -a apps/icloud-backup/.next/standalone /app/frontend \
    && cp -a apps/icloud-backup/.next/static /app/frontend/apps/icloud-backup/.next/static \
    && if [ -d apps/icloud-backup/public ]; then \
         cp -a apps/icloud-backup/public /app/frontend/apps/icloud-backup/public; \
       fi

# Verify the standalone server was copied correctly
RUN test -f /app/frontend/apps/icloud-backup/server.js || (echo "ERROR: Standalone server not found" && exit 1)

# The frontend's rewrites are baked into the routes manifest at build time.
# Production runs the frontend in its own container (deploy.yml's
# icloud-backup-frontend), where `localhost` is not the backend: fail the build
# if the manifest lacks the backend's compose address or still points at the
# dev one.
RUN set -e; \
    manifest=apps/icloud-backup/.next/routes-manifest.json; \
    grep -q 'http://icloud-backup:8081' "$manifest" \
      || { echo "ERROR: $manifest has no http://icloud-backup:8081 rewrite destination"; exit 1; }; \
    if grep -q 'localhost:8081' "$manifest"; then \
      echo "ERROR: $manifest contains localhost:8081"; exit 1; \
    fi

# Copy migrations into the runtime image so the database module can apply them
# on boot. The folder is resolved from process.cwd() + src/db/migrations
# (WORKDIR below is /app), so it must live at /app/src/db/migrations.
RUN mkdir -p /app/src/db && \
    cp -r /source/apps/icloud-backup/src/db/migrations /app/src/db/migrations

# Verify the Nest backend build output landed where start:backend expects it
# (node dist/main), so a change in pnpm deploy's "files" handling fails here
# rather than at container boot.
RUN test -f /app/dist/main.js || (echo "ERROR: dist/main.js not found" && exit 1)

# Runtime stage
FROM ghcr.io/codemonkey800/lilnas-nextjs-runtime:latest AS runtime

# curl and ca-certificates fetch the icloudpd release over TLS at build time.
# nftables backs the backend entrypoint's packet filter (see below); setpriv
# comes with util-linux.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates nftables \
    && rm -rf /var/lib/apt/lists/*

# The pinned icloudpd binary, checksum-verified by the script.
COPY apps/icloud-backup/scripts/fetch-icloudpd.sh /tmp/fetch-icloudpd.sh
RUN bash /tmp/fetch-icloudpd.sh /usr/local/bin/icloudpd \
    && rm /tmp/fetch-icloudpd.sh
RUN icloudpd --version | grep -q 'version:1.32.3'

# Copy the built application with non-root ownership so the node user
# (UID 1000) can read/execute everything in /app at runtime.
COPY --from=builder --chown=node:node /app /app

# The backend's entrypoint (deploy.yml / deploy.dev.yml): installs the packet
# filter that keeps icloudpd's sign-in form loopback-only, then drops to the
# node user. Root-owned so the node user cannot rewrite it.
COPY --chmod=755 apps/icloud-backup/scripts/backend-entrypoint.sh /usr/local/bin/backend-entrypoint.sh

WORKDIR /app

USER node

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

# Default: both processes in one container (`pnpm start` runs start:backend and
# start:frontend). deploy.yml overrides this per service so the frontend
# container never holds the backend's secrets.
ENTRYPOINT ["pnpm", "start"]
