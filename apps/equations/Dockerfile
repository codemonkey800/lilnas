# Optimized Dockerfile using pre-built LaTeX image
FROM node:26.12.0-bookworm AS base

# Install pnpm
RUN npm install -g pnpm@12.14.0

# Build stage
FROM base AS deps

WORKDIR /source

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/equations/package.json apps/equations/
COPY packages/cli/package.json packages/cli/
COPY packages/utils/package.json packages/utils/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/
COPY packages/tsc7/ packages/tsc7/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build stage
FROM deps AS build

# COPY . . brings in every workspace package.json, so pnpm's verify-deps-before-run
# would run a full-workspace install before the first build. The deps stage's
# install already covers this app's subset.
ENV pnpm_config_verify_deps_before_run=false

# Copy source code
COPY . .

# Build the equations package and its dependencies
#
# Builds go through the self-hosted Turbo remote cache (docs/deploy.md) when
# CI passes the TURBO_* BuildKit secrets; without them turbo compiles locally.
# A cache hit restores packages/*/dist but skips pnpm's injected-deps sync, so
# the dependencies build first and the offline install re-syncs their copies
# in apps/equations/node_modules/@lilnas/* before the app build reads them.
RUN --mount=type=secret,id=TURBO_API,env=TURBO_API \
    --mount=type=secret,id=TURBO_TEAM,env=TURBO_TEAM \
    --mount=type=secret,id=TURBO_TOKEN,env=TURBO_TOKEN \
    --mount=type=secret,id=TURBO_REMOTE_CACHE_SIGNATURE_KEY,env=TURBO_REMOTE_CACHE_SIGNATURE_KEY \
    pnpm build --filter='@lilnas/equations^...' \
    && pnpm install --frozen-lockfile --offline --filter='@lilnas/equations...' \
    && pnpm build --filter=@lilnas/equations

# Deploy production build
RUN pnpm --filter=equations --prod deploy /app

# Production stage - use Node base and install LaTeX
FROM node:26.12.0-bookworm-slim AS production

# Install LaTeX packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        texlive-latex-base \
        texlive-latex-extra \
        texlive-latex-recommended \
        texlive-fonts-recommended \
        texlive-fonts-extra \
        texlive-lang-all \
        ghostscript \
        imagemagick \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@12.14.0

# Same as lilnas-node-runtime: keep pnpm 12 from writing the lockfile and
# re-verifying the install on `pnpm start` as the non-root app user.
ENV pnpm_config_pm_on_fail=ignore
ENV pnpm_config_verify_deps_before_run=false

# Create app user
RUN groupadd -r app && useradd -r -g app app

# Copy deployed application, owned by app at copy time. A `chown -R` RUN after
# the COPY would write a second full copy of /app as its own layer.
COPY --from=build --chown=app:app /app /app

# Copy ImageMagick policy (optional); stays root-owned so app cannot rewrite it
COPY --from=build /source/apps/equations/image-magick-policy.xml /etc/ImageMagick-6/policy.xml

# Switch to app user
USER app
WORKDIR /app

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

# Start the application
ENTRYPOINT ["pnpm", "start"]
