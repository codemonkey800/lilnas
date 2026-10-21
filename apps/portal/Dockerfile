# Multi-stage Dockerfile for @lilnas/portal

# Dependency caching stage
FROM ghcr.io/codemonkey800/lilnas-monorepo-builder:latest AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/portal/package.json apps/portal/
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

# Build the portal package
#
# Builds go through the self-hosted Turbo remote cache (docs/deploy.md) when
# CI passes the TURBO_* BuildKit secrets; without them turbo compiles locally.
# A cache hit restores packages/*/dist but skips pnpm's injected-deps sync, so
# the dependencies build first and the offline install re-syncs their copies
# in apps/portal/node_modules/@lilnas/* before the app build reads them.
RUN --mount=type=secret,id=TURBO_API,env=TURBO_API \
    --mount=type=secret,id=TURBO_TEAM,env=TURBO_TEAM \
    --mount=type=secret,id=TURBO_TOKEN,env=TURBO_TOKEN \
    --mount=type=secret,id=TURBO_REMOTE_CACHE_SIGNATURE_KEY,env=TURBO_REMOTE_CACHE_SIGNATURE_KEY \
    pnpm build --filter='@lilnas/portal^...' \
    && pnpm install --frozen-lockfile --offline --filter='@lilnas/portal...' \
    && pnpm build --filter=@lilnas/portal

# Verify the standalone server was emitted
RUN test -f /source/apps/portal/.next/standalone/apps/portal/server.js || (echo "ERROR: Standalone server not found" && exit 1)

# Runtime stage
FROM ghcr.io/codemonkey800/lilnas-nextjs-runtime:latest AS runtime

# Copy the Next standalone build (server.js, package.json, traced node_modules)
COPY --from=builder /source/apps/portal/.next/standalone /app

# The standalone build does not include static assets or public/
COPY --from=builder /source/apps/portal/.next/static /app/apps/portal/.next/static
COPY --from=builder /source/apps/portal/public /app/apps/portal/public

WORKDIR /app/apps/portal

# The standalone tree has no pnpm workspace, so skip pnpm's pre-run dependency check
ENV pnpm_config_verify_deps_before_run=false

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["pnpm", "start"]
