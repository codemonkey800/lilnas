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
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install

# Build stage
FROM deps AS builder

# Copy source code (this layer changes frequently)
COPY . .

# Build the theater package
RUN pnpm build --filter=@lilnas/theater

# Deploy production dependencies
RUN pnpm --filter=theater --prod deploy /app

# Copy the built Next.js application
RUN cp -r /source/apps/theater/.next /app/.next

# Copy the standalone server to the correct location
RUN cp /source/apps/theater/.next/standalone/apps/theater/server.js /app/server.js

# Copy public directory if it exists
RUN if [ -d /source/apps/theater/public ]; then \
      cp -r /source/apps/theater/public /app/.next/standalone/; \
    fi

# Copy static files to standalone directory
RUN if [ -d /app/.next/static ]; then \
      cp -r /app/.next/static /app/.next/standalone/.next/; \
    fi

# Verify the standalone server was copied correctly
RUN test -f /app/server.js || (echo "ERROR: Standalone server not found" && exit 1)

# Production stage
FROM ghcr.io/codemonkey800/lilnas-nextjs-runtime:latest AS production

# Copy built application from builder stage
COPY --from=builder /app /app

WORKDIR /app

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["pnpm", "start"]
