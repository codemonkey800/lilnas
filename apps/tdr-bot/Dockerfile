# Multi-stage Dockerfile for @lilnas/tdr-bot

# Dependency caching stage
FROM ghcr.io/codemonkey800/lilnas-monorepo-builder:latest AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/tdr-bot/package.json apps/tdr-bot/
COPY packages/cli/package.json packages/cli/
COPY packages/media/package.json packages/media/
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

# Build the tdr-bot package
#
# Builds go through the self-hosted Turbo remote cache (docs/deploy.md) when
# CI passes the TURBO_* BuildKit secrets; without them turbo compiles locally.
# A cache hit restores packages/*/dist but skips pnpm's injected-deps sync, so
# the dependencies build first and the offline install re-syncs their copies
# in apps/tdr-bot/node_modules/@lilnas/* before the app build reads them.
RUN --mount=type=secret,id=TURBO_API,env=TURBO_API \
    --mount=type=secret,id=TURBO_TEAM,env=TURBO_TEAM \
    --mount=type=secret,id=TURBO_TOKEN,env=TURBO_TOKEN \
    --mount=type=secret,id=TURBO_REMOTE_CACHE_SIGNATURE_KEY,env=TURBO_REMOTE_CACHE_SIGNATURE_KEY \
    pnpm build --filter='@lilnas/tdr-bot^...' \
    && pnpm install --frozen-lockfile --offline --filter='@lilnas/tdr-bot...' \
    && pnpm build --filter=@lilnas/tdr-bot

# Deploy production dependencies
RUN pnpm --filter=@lilnas/tdr-bot --prod deploy /app

# Copy the Next standalone build next to the backend. It carries only the
# frontend's traced node_modules, so the frontend packages stay out of /app's
# prod dependencies. (`files` in package.json already put dist/ and drizzle/ in /app.)
RUN cp -a apps/tdr-bot/.next/standalone /app/frontend \
    && cp -a apps/tdr-bot/.next/static /app/frontend/apps/tdr-bot/.next/static \
    && if [ -d apps/tdr-bot/public ]; then \
         cp -a apps/tdr-bot/public /app/frontend/apps/tdr-bot/public; \
       fi

# Verify the backend, migrations and standalone server are all in place
RUN test -f /app/dist/main.js && test -d /app/drizzle/meta && test -f /app/frontend/apps/tdr-bot/server.js \
    || (echo "ERROR: tdr-bot build output is incomplete" && exit 1)

# Runtime stage using shared Next.js runtime
FROM ghcr.io/codemonkey800/lilnas-nextjs-runtime:latest AS runtime

# Copy the built application from builder stage
COPY --from=builder /app /app

# Set environment variables
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080
EXPOSE 8080

WORKDIR /app

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["pnpm", "start"]
