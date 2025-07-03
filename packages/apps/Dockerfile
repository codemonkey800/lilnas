# Multi-stage Dockerfile for @lilnas/apps
FROM lilnas-monorepo-builder AS builder

# Build the apps package
RUN pnpm build --filter=@lilnas/apps

# Deploy production dependencies
RUN pnpm --filter=apps --prod deploy /app

# Runtime stage
FROM lilnas-nextjs-runtime AS runtime

# Copy the built application
COPY --from=builder /app /app

WORKDIR /app
ENTRYPOINT ["pnpm", "start"]
