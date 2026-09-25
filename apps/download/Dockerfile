# Dependency caching stage
FROM lilnas-monorepo-builder AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/download/package.json apps/download/
COPY packages/cli/package.json packages/cli/
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

# Build the download package
RUN pnpm build --filter=@lilnas/download

# Deploy production dependencies
RUN pnpm --filter=download --prod deploy /app

# Copy the built Next.js application
RUN cp -r /source/apps/download/.next /app/.next

# Copy the standalone server to the correct location
RUN cp /source/apps/download/.next/standalone/apps/download/server.js /app/server.js

# Copy public directory if it exists
RUN if [ -d /source/apps/download/public ]; then \
      cp -r /source/apps/download/public /app/.next/standalone/; \
    fi

# Copy static files to standalone directory
RUN if [ -d /app/.next/static ]; then \
      cp -r /app/.next/static /app/.next/standalone/.next/; \
    fi

# Verify the standalone server was copied correctly
RUN test -f /app/server.js || (echo "ERROR: Standalone server not found" && exit 1)

# Copy migrations into the runtime image so DbService can apply them on
# boot. resolveMigrationsFolder() resolves the path via process.cwd() +
# src/db/migrations (WORKDIR is /app), so the folder must live at
# /app/src/db/migrations. Mirrors apps/auth/Dockerfile's identical
# requirement.
RUN mkdir -p /app/src/db && \
    cp -r /source/apps/download/src/db/migrations /app/src/db/migrations

# Verify the Nest backend build output landed where start:backend expects
# it (node dist/main) — fail the build loudly here rather than at boot.
RUN test -f /app/dist/main.js || (echo "ERROR: dist/main.js not found" && exit 1)

# Production stage
FROM lilnas-nextjs-runtime AS production

# Install ffmpeg and dependencies for yt-dlp
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl ca-certificates python3 && \
    rm -rf /var/lib/apt/lists/*

# yt-dlp lives in a node-owned directory rather than /usr/bin. YtdlpUpdateService
# runs as `node` and replaces this binary in place (move/rename), which needs
# write permission on the *directory* the binary lives in, not just the file -
# /usr/bin is root:root drwxr-xr-x, so chowning only the file would not have
# been enough. /usr/bin/yt-dlp stays a symlink so every other hardcoded
# '/usr/bin/yt-dlp' call site keeps working unchanged.
RUN mkdir -p /opt/yt-dlp && \
    curl \
        -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
        -o /opt/yt-dlp/yt-dlp && \
    chmod a+rx /opt/yt-dlp/yt-dlp && \
    chown -R node:node /opt/yt-dlp && \
    ln -s /opt/yt-dlp/yt-dlp /usr/bin/yt-dlp

# Copy built application from builder stage
COPY --from=builder --chown=node:node /app /app

WORKDIR /app

# yt-dlp's scratch space. DownloadVideoService hardcodes
# VIDEO_DIR = '/download/videos', and the container runs as `node`, which
# cannot mkdir at the filesystem root - so without this every
# POST /download/videos dies with EACCES before yt-dlp is ever invoked.
#
# Deliberately NOT a volume: reconcileInterruptedJobs() sweeps every
# non-terminal job to `failed` at boot precisely because a partial download
# here is not meant to survive a restart (see DownloadJobStatus.Paused's
# docblock in packages/utils/src/download/schema.ts).
RUN mkdir -p /download/videos && chown -R node:node /download

USER node

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["pnpm", "start"]
