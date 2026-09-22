FROM lilnas-node-base

# Dev runtime for every app's deploy.dev.yml. Unlike the other base images this
# one copies no source: the repo is bind-mounted at /source and each app runs
# its own `pnpm --filter=<app> dev`, so the container always sees the working
# tree and hot reload works.
#
# `sh` is the entrypoint because the deploy.dev.yml files pass
# `command: -c "pnpm --filter=<app> dev"`.
#
# ⚠️ node_modules must NOT come from the host bind mount. The host runs node 24
# while this image runs node 25, and the tree contains native modules
# (better-sqlite3, bcrypt — see pnpm-workspace.yaml's onlyBuiltDependencies).
# Host-built binaries fail node's NODE_MODULE_VERSION check. Each compose file
# shadows the node_modules paths with named volumes and installs inside the
# container instead.
#
# The build toolchain below exists for that install: a native module with no
# prebuilt binary for this node version compiles from source via node-gyp.

# ffmpeg/curl/python3 are @lilnas/download's runtime dependencies, mirroring the
# production stage of apps/download/Dockerfile: yt-dlp is a python3 program, it
# shells out to ffmpeg to merge separate video/audio streams, and
# download-video.service.ts spawns /usr/bin/ffmpeg directly for conversion.
#
# procps (for `ps`) is load-bearing for every app's `nest start -w`: on
# recompile, @nestjs/cli's watcher kills the previous instance via tree-kill,
# which shells out to `ps --ppid` to find descendant PIDs. Without it, the
# first backend file change after boot throws an uncaught `spawn ps ENOENT`
# that crashes the whole watch supervisor - the container stays "Up
# (healthy)" (the healthcheck only probes the frontend), but the backend
# freezes on stale code for the rest of the container's life.

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    g++ \
    git \
    make \
    procps \
    python3 \
  && rm -rf /var/lib/apt/lists/*

# yt-dlp, installed exactly the way apps/download/Dockerfile's production stage
# does it: the real binary lives in a node-owned /opt/yt-dlp and /usr/bin/yt-dlp
# is only a symlink to it.
#
# The indirection is not cosmetic. YtdlpUpdateService (apps/download/src/
# ytdlp-update) replaces the binary in place with a move/rename, which needs
# write permission on the *directory* — /usr/bin is root:root drwxr-xr-x, so
# installing the binary there directly would make every auto-update fail.
# Meanwhile download.service.ts / download-video.service.ts hardcode
# spawn('/usr/bin/yt-dlp'), so the symlink has to stay for them.
#
# Unpinned, matching production: yt-dlp breaks whenever an extractor changes
# upstream, so the image ships whatever is latest at build time and
# YtdlpUpdateService keeps it current from there.
RUN mkdir -p /opt/yt-dlp \
  && curl \
    -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /opt/yt-dlp/yt-dlp \
  && chmod a+rx /opt/yt-dlp/yt-dlp \
  && chown -R node:node /opt/yt-dlp \
  && ln -s /opt/yt-dlp/yt-dlp /usr/bin/yt-dlp

# ⚠️ These two directories MUST exist in the image, owned by the `node` user.
#
# Docker only copies content and ownership into an empty named volume when the
# mount point already exists in the image; when it does not, it creates the
# directory owned by root:root. The compose files run as a non-root user to keep
# bind-mount writes owned by the host user, so a root-owned volume fails with
# `EACCES: permission denied, mkdir '/source/node_modules/.pnpm'`.
#
# Pre-creating them here is what makes the volumes land user-writable. Only the
# WORKSPACE ROOT node_modules needs a volume: pnpm fills each package's own
# node_modules with relative symlinks into the root store, so a bind-mounted
# apps/<app>/node_modules resolves against whichever root it is read through —
# the container's node 25 tree here, the host's node 24 tree there.
RUN mkdir -p /source/node_modules /home/node/.local/share/pnpm \
  && chown -R node:node /source /home/node/.local

WORKDIR /source

ENTRYPOINT ["/bin/sh"]
