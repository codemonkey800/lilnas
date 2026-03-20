# Multi-stage Dockerfile for @lilnas/token

# Dependency caching stage
FROM lilnas-monorepo-builder AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/token/package.json apps/token/
COPY packages/cli/package.json packages/cli/
COPY packages/utils/package.json packages/utils/
COPY packages/token-client/package.json packages/token-client/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/

# Install dependencies (this layer gets cached)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install

# Build stage
FROM deps AS builder

# Copy source code (this layer changes frequently)
COPY . .

# Generate the apps manifest before building
RUN pnpm --filter=@lilnas/token exec tsx scripts/generate-apps.ts

# Build the token package
RUN pnpm build --filter=@lilnas/token

# Deploy production dependencies
RUN pnpm --filter=@lilnas/token --prod deploy /app

# Copy the built Next.js application
RUN cp -r /source/apps/token/.next /app/.next

# Copy Drizzle migration files
RUN if [ -d /source/apps/token/drizzle ]; then \
      cp -r /source/apps/token/drizzle /app/drizzle; \
    fi

# Copy the standalone server to the correct location
RUN cp /source/apps/token/.next/standalone/apps/token/server.js /app/server.js

# Copy public directory if it exists
RUN if [ -d /source/apps/token/public ]; then \
      cp -r /source/apps/token/public /app/.next/standalone/; \
    fi

# Copy static files to standalone directory
RUN if [ -d /app/.next/static ]; then \
      cp -r /app/.next/static /app/.next/standalone/.next/; \
    fi

# Verify the standalone server was copied correctly
RUN test -f /app/server.js || (echo "ERROR: Standalone server not found" && exit 1)

# Runtime stage using shared Next.js runtime
FROM lilnas-nextjs-runtime AS runtime

# Copy the built application from builder stage
COPY --from=builder /app /app

# Set environment variables
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080
EXPOSE 8080

WORKDIR /app

LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["pnpm", "start"]
