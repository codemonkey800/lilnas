# Multi-stage Dockerfile for @lilnas/apps

# Dependency caching stage
FROM lilnas-monorepo-builder AS deps

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

# Copy Next.js standalone output and static files
RUN cp -r /source/packages/apps/public/ /app/.next/standalone/ && \
    cp -r /app/.next/static/ /app/.next/standalone/.next/

# Runtime stage
FROM lilnas-nextjs-runtime AS runtime

# Copy the built application
COPY --from=builder /app /app

WORKDIR /app
ENTRYPOINT ["pnpm", "start"]
