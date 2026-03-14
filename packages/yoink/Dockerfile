# Multi-stage Dockerfile for @lilnas/yoink

# Dependency caching stage
FROM lilnas-monorepo-builder AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/yoink/package.json packages/yoink/
COPY packages/media/package.json packages/media/
COPY packages/utils/package.json packages/utils/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/

# Install dependencies (this layer gets cached)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install

# Build stage
FROM deps AS builder

# Copy source code (this layer changes frequently)
COPY . .

# Build the yoink package
RUN pnpm exec turbo run build --filter=@lilnas/yoink

# Deploy production dependencies
RUN pnpm --filter=yoink --prod deploy /app

# Copy Drizzle migration files so start:migrate can apply them at runtime
RUN cp -r /source/packages/yoink/drizzle /app/drizzle

# Copy the built Next.js application
RUN cp -r /source/packages/yoink/.next /app/.next

# Copy the standalone server to the correct location
RUN cp /source/packages/yoink/.next/standalone/packages/yoink/server.js /app/server.js

# Copy public directory if it exists
RUN if [ -d /source/packages/yoink/public ]; then \
      cp -r /source/packages/yoink/public /app/.next/standalone/; \
    fi

# Copy static files to standalone directory
RUN if [ -d /app/.next/static ]; then \
      cp -r /app/.next/static /app/.next/standalone/.next/; \
    fi

# Verify the standalone server was copied correctly
RUN test -f /app/server.js || (echo "ERROR: Standalone server not found" && exit 1)

# Runtime stage
FROM lilnas-nextjs-runtime AS runtime

# Install nginx and set up permissions for non-root operation
RUN apt-get update && apt-get install -y --no-install-recommends nginx && rm -rf /var/lib/apt/lists/* \
    && chown -R node:node /var/log/nginx /var/lib/nginx /run

# Copy the built application
COPY --from=builder /app /app

# Copy nginx config and entrypoint
COPY packages/yoink/nginx.conf /etc/nginx/nginx.conf
COPY packages/yoink/docker-entrypoint.sh /docker-entrypoint.sh

WORKDIR /app

USER node

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["/docker-entrypoint.sh"]
