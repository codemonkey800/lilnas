# Build stage
FROM lilnas-monorepo-builder AS builder
RUN pnpm build --filter=@lilnas/me-token-tracker
RUN pnpm --filter=me-token-tracker --prod deploy /app

# Runtime stage
FROM lilnas-node-runtime AS runtime
COPY --from=builder /app /app
ENTRYPOINT ["pnpm", "start"]
