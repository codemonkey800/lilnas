# Multi-stage Dockerfile for @lilnas/portal

# Dependency caching stage
FROM lilnas-monorepo-builder AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/portal/package.json apps/portal/
COPY packages/utils/package.json packages/utils/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/

# Install dependencies (this layer gets cached)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install

# Build stage
FROM deps AS builder

# Copy source code (this layer changes frequently)
COPY . .

# Build the portal package
RUN pnpm build --filter=@lilnas/portal

# Deploy production dependencies
RUN pnpm --filter=portal --prod deploy /app

# Copy the built Next.js application
RUN cp -r /source/apps/portal/.next /app/.next

# Copy the standalone server to the correct location
RUN cp /source/apps/portal/.next/standalone/apps/portal/server.js /app/server.js

# Copy public directory if it exists
RUN if [ -d /source/apps/portal/public ]; then \
      cp -r /source/apps/portal/public /app/.next/standalone/; \
    fi

# Copy static files to standalone directory
RUN if [ -d /app/.next/static ]; then \
      cp -r /app/.next/static /app/.next/standalone/.next/; \
    fi

# Verify the standalone server was copied correctly
RUN test -f /app/server.js || (echo "ERROR: Standalone server not found" && exit 1)

# Runtime stage
FROM lilnas-nextjs-runtime AS runtime

# Copy the built application
COPY --from=builder /app /app

WORKDIR /app

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["pnpm", "start"]
