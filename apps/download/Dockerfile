# Dependency caching stage
FROM ghcr.io/codemonkey800/lilnas-monorepo-builder:latest AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/download/package.json apps/download/
COPY packages/cli/package.json packages/cli/
COPY packages/media/package.json packages/media/
COPY packages/utils/package.json packages/utils/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/
COPY packages/tsc7/ packages/tsc7/

# Install dependencies (this layer gets cached)
RUN pnpm install --frozen-lockfile

# Build stage
FROM deps AS builder

# COPY . . brings in every workspace package.json, so pnpm's verify-deps-before-run
# would run a full-workspace install before the first build. The deps stage's
# install already covers this app's subset.
ENV pnpm_config_verify_deps_before_run=false

# Copy source code (this layer changes frequently)
COPY . .

# Build the download package
#
# Builds go through the self-hosted Turbo remote cache (docs/deploy.md) when
# CI passes the TURBO_* BuildKit secrets; without them turbo compiles locally.
# A cache hit restores packages/*/dist but skips pnpm's injected-deps sync, so
# the dependencies build first and the offline install re-syncs their copies
# in apps/download/node_modules/@lilnas/* before the app build reads them.
RUN --mount=type=secret,id=TURBO_API,env=TURBO_API \
    --mount=type=secret,id=TURBO_TEAM,env=TURBO_TEAM \
    --mount=type=secret,id=TURBO_TOKEN,env=TURBO_TOKEN \
    --mount=type=secret,id=TURBO_REMOTE_CACHE_SIGNATURE_KEY,env=TURBO_REMOTE_CACHE_SIGNATURE_KEY \
    pnpm build --filter='@lilnas/download^...' \
    && pnpm install --frozen-lockfile --offline --filter='@lilnas/download...' \
    && pnpm build --filter=@lilnas/download

# Deploy production dependencies
RUN pnpm --filter=download --prod deploy /app

# Copy the Next standalone build next to the backend. It carries only the
# frontend's traced node_modules, so the frontend packages stay out of /app's
# prod dependencies. (`files` in package.json already put dist/ in /app.)
RUN cp -a apps/download/.next/standalone /app/frontend \
    && cp -a apps/download/.next/static /app/frontend/apps/download/.next/static \
    && if [ -d apps/download/public ]; then \
         cp -a apps/download/public /app/frontend/apps/download/public; \
       fi

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

# Verify the standalone server landed where start:frontend expects it
RUN test -f /app/frontend/apps/download/server.js || (echo "ERROR: Standalone server not found" && exit 1)

# Production stage
FROM ghcr.io/codemonkey800/lilnas-nextjs-runtime:latest AS production

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
