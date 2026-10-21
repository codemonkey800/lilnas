# Dependency caching stage
FROM ghcr.io/codemonkey800/lilnas-monorepo-builder:latest AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dev/package.json apps/dev/
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

# Build the dev package
#
# Builds go through the self-hosted Turbo remote cache (docs/deploy.md) when
# CI passes the TURBO_* BuildKit secrets; without them turbo compiles locally.
# A cache hit restores packages/*/dist but skips pnpm's injected-deps sync, so
# the dependencies build first and the offline install re-syncs their copies
# in apps/dev/node_modules/@lilnas/* before the app build reads them.
RUN --mount=type=secret,id=TURBO_API,env=TURBO_API \
    --mount=type=secret,id=TURBO_TEAM,env=TURBO_TEAM \
    --mount=type=secret,id=TURBO_TOKEN,env=TURBO_TOKEN \
    --mount=type=secret,id=TURBO_REMOTE_CACHE_SIGNATURE_KEY,env=TURBO_REMOTE_CACHE_SIGNATURE_KEY \
    pnpm build --filter='@lilnas/dev^...' \
    && pnpm install --frozen-lockfile --offline --filter='@lilnas/dev...' \
    && pnpm build --filter=@lilnas/dev

# Deploy production dependencies. package.json's "files" field (["./dist"])
# tells pnpm deploy to include the Nest build output.
RUN pnpm --filter=dev --prod deploy /app

# Copy the Next standalone build next to the backend. It carries only the
# frontend's traced node_modules, so next/react/react-dom stay out of /app's
# prod dependencies (they are devDependencies). static/ and public/ go inside
# it, beside the standalone server.js: Next's standalone server resolves both
# relative to its OWN location (frontend/apps/dev/), so they are silently never
# served from anywhere else.
RUN cp -a apps/dev/.next/standalone /app/frontend \
    && cp -a apps/dev/.next/static /app/frontend/apps/dev/.next/static \
    && if [ -d apps/dev/public ]; then \
         cp -a apps/dev/public /app/frontend/apps/dev/public; \
       fi

# Verify the standalone server and the backend entrypoint were built
RUN test -f /app/frontend/apps/dev/server.js || (echo "ERROR: Standalone server not found" && exit 1)
RUN test -f /app/dist/main.js || (echo "ERROR: Backend build not found" && exit 1)

# Production stage
FROM ghcr.io/codemonkey800/lilnas-nextjs-runtime:latest AS production

# Docker CLI + compose plugin: the dashboard shells out to `docker compose`
# for start/stop. Both come from official images so versions stay pinned.
COPY --from=docker:29.9.1-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker/compose-bin:v5.6.0 /docker-compose /usr/local/lib/docker/cli-plugins/docker-compose

# Copy built application from builder stage
COPY --from=builder /app /app

WORKDIR /app

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

# No USER: runs as root like apps/portal. It needs the Docker socket (owned by
# the host's docker group, whose GID is not known at build time) and read
# access to root-owned compose directories on the host.
ENTRYPOINT ["pnpm", "start"]
