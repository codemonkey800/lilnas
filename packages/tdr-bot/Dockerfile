# Multi-stage Dockerfile for @lilnas/tdr-bot

# Build stage using shared monorepo builder
FROM lilnas-monorepo-builder AS builder

# Build the tdr-bot package
RUN pnpm build --filter=@lilnas/tdr-bot

# Deploy production dependencies
RUN pnpm --filter=tdr-bot --prod deploy /app

# Copy Next.js standalone output and static files
RUN cp -r /source/packages/tdr-bot/public/ /app/.next/standalone/ && \
    cp -r /app/.next/static/ /app/.next/standalone/.next/

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
ENTRYPOINT ["pnpm", "start"]
