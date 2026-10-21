# Dependency caching stage
FROM ghcr.io/codemonkey800/lilnas-monorepo-builder:latest AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/me-token-tracker/package.json apps/me-token-tracker/
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

# Build the service
#
# Builds go through the self-hosted Turbo remote cache (docs/deploy.md) when
# CI passes the TURBO_* BuildKit secrets; without them turbo compiles locally.
# A cache hit restores packages/*/dist but skips pnpm's injected-deps sync, so
# the dependencies build first and the offline install re-syncs their copies
# in apps/me-token-tracker/node_modules/@lilnas/* before the app build reads
# them.
RUN --mount=type=secret,id=TURBO_API,env=TURBO_API \
    --mount=type=secret,id=TURBO_TEAM,env=TURBO_TEAM \
    --mount=type=secret,id=TURBO_TOKEN,env=TURBO_TOKEN \
    --mount=type=secret,id=TURBO_REMOTE_CACHE_SIGNATURE_KEY,env=TURBO_REMOTE_CACHE_SIGNATURE_KEY \
    pnpm build --filter='@lilnas/me-token-tracker^...' \
    && pnpm install --frozen-lockfile --offline --filter='@lilnas/me-token-tracker...' \
    && pnpm build --filter=@lilnas/me-token-tracker
RUN pnpm --filter=me-token-tracker --prod deploy /app

# Drop files Node never loads from the deploy tree: type declarations (and the
# @types packages), source maps and docs. Licenses stay.
RUN rm -rf /app/node_modules/.pnpm/@types+* \
  && find /app/node_modules \( -type f -o -type l \) \( \
    -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \
    -o \( \( -iname '*.md' -o -iname '*.markdown' \) ! -iname 'licen*' \) \
  \) -delete \
  && find /app/node_modules -xtype l -delete

# Runtime stage
FROM ghcr.io/codemonkey800/lilnas-node-runtime:latest AS runtime
COPY --from=builder /app /app

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["pnpm", "start"]
