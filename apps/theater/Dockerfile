# Dependency caching stage
FROM ghcr.io/codemonkey800/lilnas-monorepo-builder:latest AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/theater/package.json apps/theater/
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

# Build the theater package
#
# Builds go through the self-hosted Turbo remote cache (docs/deploy.md) when
# CI passes the TURBO_* BuildKit secrets; without them turbo compiles locally.
# A cache hit restores packages/*/dist but skips pnpm's injected-deps sync, so
# the dependencies build first and the offline install re-syncs their copies
# in apps/theater/node_modules/@lilnas/* before the app build reads them.
RUN --mount=type=secret,id=TURBO_API,env=TURBO_API \
    --mount=type=secret,id=TURBO_TEAM,env=TURBO_TEAM \
    --mount=type=secret,id=TURBO_TOKEN,env=TURBO_TOKEN \
    --mount=type=secret,id=TURBO_REMOTE_CACHE_SIGNATURE_KEY,env=TURBO_REMOTE_CACHE_SIGNATURE_KEY \
    pnpm build --filter='@lilnas/theater^...' \
    && pnpm install --frozen-lockfile --offline --filter='@lilnas/theater...' \
    && pnpm build --filter=@lilnas/theater

# Deploy production dependencies
RUN pnpm --filter=theater --prod deploy /app

# Copy the Next standalone build next to the backend. It carries only the
# frontend's traced node_modules, so next/react/three/etc. stay out of /app's
# prod dependencies (they are devDependencies). static/ and public/ go inside
# it, beside the standalone server.js: Next's standalone server resolves both
# relative to its OWN location (frontend/apps/theater/).
RUN cp -a apps/theater/.next/standalone /app/frontend \
    && cp -a apps/theater/.next/static /app/frontend/apps/theater/.next/static \
    && if [ -d apps/theater/public ]; then \
         cp -a apps/theater/public /app/frontend/apps/theater/public; \
       fi

# Verify the standalone server was copied correctly
RUN test -f /app/frontend/apps/theater/server.js || (echo "ERROR: Standalone server not found" && exit 1)

# Verify the Nest backend build output landed where start:backend expects it
# (node dist/main)
RUN test -f /app/dist/main.js || (echo "ERROR: dist/main.js not found" && exit 1)

# Production stage
FROM ghcr.io/codemonkey800/lilnas-nextjs-runtime:latest AS production

# Copy built application from builder stage
COPY --from=builder /app /app

WORKDIR /app

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["pnpm", "start"]
