# Multi-stage Dockerfile for @lilnas/apps

# Dependency caching stage
FROM ghcr.io/codemonkey800/lilnas-monorepo-builder:latest AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/apps/package.json packages/apps/
COPY packages/utils/package.json packages/utils/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/

# Install dependencies (this layer gets cached)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install

# Build stage
FROM deps AS builder

# Copy source code (this layer changes frequently)
COPY . .

# Build the apps package
RUN pnpm build --filter=@lilnas/apps

# Deploy production dependencies
RUN pnpm --filter=apps --prod deploy /app

# Copy the built Next.js application
RUN cp -r /source/packages/apps/.next /app/.next

# Copy the standalone server to the correct location
RUN cp /source/packages/apps/.next/standalone/packages/apps/server.js /app/server.js

# Copy public directory if it exists
RUN if [ -d /source/packages/apps/public ]; then \
      cp -r /source/packages/apps/public /app/.next/standalone/; \
    fi

# Copy static files to standalone directory
RUN if [ -d /app/.next/static ]; then \
      cp -r /app/.next/static /app/.next/standalone/.next/; \
    fi

# Verify the standalone server was copied correctly
RUN test -f /app/server.js || (echo "ERROR: Standalone server not found" && exit 1)

# Runtime stage
FROM ghcr.io/codemonkey800/lilnas-nextjs-runtime:latest AS runtime

# Copy the built application
COPY --from=builder /app /app

WORKDIR /app

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["pnpm", "start"]
