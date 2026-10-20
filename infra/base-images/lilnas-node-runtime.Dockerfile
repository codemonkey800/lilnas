FROM ghcr.io/codemonkey800/lilnas-node-base:latest AS runtime
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080
# Apps start via `pnpm start` as a non-root user from a root-owned /app. pnpm 12 would
# otherwise record its pinned version into pnpm-lock.yaml and re-verify the
# install before every script run, both of which crash the container.
ENV pnpm_config_pm_on_fail=ignore
ENV pnpm_config_verify_deps_before_run=false
EXPOSE 8080
WORKDIR /app

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas
