#!/bin/sh
# Entrypoint for the tdr-dev container in deploy.dev.yml.
#
# This replaces `pnpm dev` (`lilnas dev`), which can't run inside a container:
# it starts its own Postgres with `docker run` and connects to it on localhost,
# and it reloads apps/tdr-bot/.env over the environment compose already built.
# The compose file supplies a Postgres sidecar and the full environment instead.
set -eu

APP_DIR=/source/apps/tdr-bot

# deploy.dev.yml layers .env over .env.prod, so a Discord key missing from .env
# silently falls through to the production bot's value. Two gateway sessions
# on one token double every reply, and the dev bot would register commands in
# the production guild. Refuse to boot instead.
prod_value() {
  grep -E "^$1=" "$APP_DIR/.env.prod" | tail -n 1 | cut -d= -f2- |
    sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

for key in DISCORD_API_TOKEN DISCORD_GUILD_ID; do
  eval "current=\${$key:-}"
  if [ -z "$current" ] || [ "$current" = "$(prod_value "$key")" ]; then
    echo "Refusing to start: $key is unset or matches .env.prod." >&2
    echo "Set the dev bot's $key in apps/tdr-bot/.env (see .env.example)." >&2
    exit 1
  fi
done

cd /source

# The node_modules volume starts empty. --frozen-lockfile keeps the install
# honest and stops it from rewriting the bind-mounted pnpm-lock.yaml.
pnpm install --frozen-lockfile

# Workspace packages (@lilnas/utils, @lilnas/media) export from dist/, which a
# fresh checkout doesn't have. Changes to them need a container restart.
#
# Not `pnpm run build`: .npmrc's sync-injected-deps-after-scripts makes pnpm
# hard-link each build into its injected copies under node_modules/.pnpm, and
# that volume is a different device from the bind-mounted packages/, so the
# sync dies with EXDEV. So compile with tsc directly and copy dist/ into the
# injected copies by hand.
#
# The tsbuildinfo is removed first because these are composite projects: with
# a buildinfo present, tsc trusts it and emits nothing even when dist/ is gone.
for pkg in utils media; do
  (cd "packages/$pkg" && rm -f tsconfig.tsbuildinfo && pnpm exec tsc -p .)
  for dest in node_modules/.pnpm/@lilnas+$pkg@file+packages+$pkg*/node_modules/@lilnas/$pkg; do
    [ -d "$dest" ] || continue
    rm -rf "$dest/dist"
    cp -R "packages/$pkg/dist" "$dest/"
  done
done

cd "$APP_DIR"
pnpm run db:migrate
exec pnpm run dev:start
