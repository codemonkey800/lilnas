# Multi-stage Dockerfile for @lilnas/tdr-bot

# Dependency caching stage
FROM ghcr.io/codemonkey800/lilnas-monorepo-builder:latest AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/tdr-bot/package.json packages/tdr-bot/
COPY packages/utils/package.json packages/utils/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/

# Install dependencies (this layer gets cached)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install

# Build stage
FROM deps AS builder

# Copy source code (this layer changes frequently)
COPY . .

# Build the tdr-bot package
RUN pnpm build --filter=@lilnas/tdr-bot

# Deploy production dependencies
RUN pnpm --filter=tdr-bot --prod deploy /app

# Copy the built Next.js application
RUN cp -r /source/packages/tdr-bot/.next /app/.next

# Copy public directory if it exists
RUN if [ -d /source/packages/tdr-bot/public ]; then \
      cp -r /source/packages/tdr-bot/public /app/.next/standalone/; \
    fi

# Copy static files to standalone directory
RUN if [ -d /app/.next/static ]; then \
      cp -r /app/.next/static /app/.next/standalone/.next/; \
    fi

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
