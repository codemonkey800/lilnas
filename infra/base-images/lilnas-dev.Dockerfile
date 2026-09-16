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

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    g++ \
    git \
    make \
    python3 \
  && rm -rf /var/lib/apt/lists/*

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
