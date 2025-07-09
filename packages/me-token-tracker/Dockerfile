# Dependency caching stage
FROM lilnas-monorepo-builder AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/me-token-tracker/package.json packages/me-token-tracker/
COPY packages/utils/package.json packages/utils/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/

# Install dependencies (this layer gets cached)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install

# Build stage
FROM deps AS builder

# Copy source code (this layer changes frequently)
COPY . .

# Build the service
RUN pnpm build --filter=@lilnas/me-token-tracker
RUN pnpm --filter=me-token-tracker --prod deploy /app

# Runtime stage
FROM lilnas-node-runtime AS runtime
COPY --from=builder /app /app
ENTRYPOINT ["pnpm", "start"]
