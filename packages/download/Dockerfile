# Build stage
FROM lilnas-monorepo-builder AS build

# Build the download package
RUN pnpm build --filter=@lilnas/download

# Deploy production dependencies
RUN pnpm --filter=download --prod deploy /app

# Copy Next.js static files to standalone output
RUN cp -r /app/.next/static/ /app/.next/standalone/.next/

# Production stage
FROM lilnas-nextjs-runtime AS production

# Install ffmpeg and dependencies for yt-dlp
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN curl \
        -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
        -o /usr/bin/yt-dlp && \
    chmod a+rx /usr/bin/yt-dlp

# Copy built application from build stage
COPY --from=build /app /app

WORKDIR /app
ENTRYPOINT ["pnpm", "start"]
