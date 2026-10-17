---
nexus-plan: 2
title: Push-to-deploy CI/CD (GHCR, Tailscale, /opt/lilnas, dotenvx)
branch: feat/push-to-deploy
base: main
setup:
  - pnpm install --frozen-lockfile
checks:
  - pnpm --filter @lilnas/cli lint
  - pnpm --filter @lilnas/cli type-check
  - pnpm --filter @lilnas/cli run --if-present test
  - pnpm --filter @lilnas/utils exec jest --maxWorkers=2
  - for f in scripts/deploy/*.sh; do [ -e "$f" ] || continue; bash -n "$f" || exit 1; done
  - docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -shellcheck=
parallel: 3
review: per-phase
commit-style: "conventional with scope, e.g. ci: …, feat(cli): …, chore(compose): …, chore(docker): …, docs: …"
---

# Push-to-deploy CI/CD

## Goal
A push to `main` redeploys whatever it changed, so Jeremy stops running
`docker compose` by hand. The pipeline detects what changed, runs the existing
tests/lint/type-check, builds only the affected app images on GitHub-hosted
runners, pushes them to GHCR (`ghcr.io/codemonkey800/lilnas-<name>`, `:<sha>` and
`:latest`), joins the tailnet as an ephemeral node, and SSHes to this server as a
forced-command `deploy` user that checks the commit out in a dedicated clone at
`/opt/lilnas`, decrypts the committed dotenvx-encrypted env files with the
host-held `.env.keys`, and runs `docker compose pull`/`up -d` for just the
affected services. Secrets move into git, encrypted; `/home/jeremy/lilnas`
becomes a dev-only checkout. Out of scope: auto-tracking `:latest` upstream
images (no Watchtower), notifications beyond GitHub's own, moving `tdr-code`
into a container.

## Decisions
- **Builds on GitHub-hosted runners, pushed to GHCR.** Repo is public, so
  packages are public and free. The four base images (`node-base`,
  `monorepo-builder`, `node-runtime`, `nextjs-runtime`) are published to GHCR too
  and every `FROM lilnas-*` is repointed to the GHCR name; `lilnas-dev` stays
  local-only. buildx with registry layer cache. Verified: no `ARG`/`NEXT_PUBLIC_*`
  baked into Dockerfiles, no Dockerfile `COPY`s an env file.
- **CI reaches the host over Tailscale** via `tailscale/github-action@v4` (OAuth
  client, `tag:ci`, ephemeral) and plain OpenSSH to `lilnas.tail77e8b0.ts.net`
  (100.110.234.82). Not Tailscale SSH. The key in GitHub is bound to a forced
  command that can only run the deploy entrypoint; SSH carries only
  "deploy SHA X: pull/up these services" — no secrets, files, or images.
- **Dedicated `deploy` system user and `/opt/lilnas` clone** (confirmed
  2026-10-17). The user is in the `docker` group, owns `/opt/lilnas` and its
  `.env.keys` copy, and is added to sshd's `AllowUsers` (currently `jeremy` only).
  `name: lilnas` goes in the root compose so the running project (34 containers)
  carries over. Ruled out: forced-command key on `jeremy`; deploying from
  `/home/jeremy/lilnas`; symlinked secrets.
- **Secrets committed, encrypted with `@dotenvx/dotenvx` 2.38.0** (root
  devDependency; no system packages — sops/age ruled out). Compose reads a
  gitignored `<file>.decrypted` sibling, so the committed file stays encrypted.
  One `.env.keys` at the repo root (gitignored; T8 copies it to
  `/storage/backups/lilnas-secrets/`, a different disk; an off-box copy is
  Jeremy's call) holds every private key. Verification of the encrypted
  commit is automated (three independent checks in T8 plus the phase review);
  Jeremy asked for no human checkpoint there. `lilnas secrets decrypt` for dev; the host decrypts via
  `pnpm dlx @dotenvx/dotenvx@2.38.0` so `/opt/lilnas` never needs `node_modules`.
  CI never holds a key.
- **Only env files compose actually loads get encrypted** (15 files). The four
  unreferenced `infra/.env.{auth,forward-auth-truereflection,monitoring,truereflection-dev-db}`
  and the stale `infra/env/` directory are deleted from disk, not committed
  (Jeremy, 2026-10-17: "we should delete them"). T8 does the deletion; no
  human step.
- **theater gets a real `.env.prod` and deploys like every other app** (Jeremy,
  2026-10-17). Today the file is missing, which makes every `docker compose`
  command in `/home/jeremy/lilnas` fail at config time. T8 builds it from
  `apps/theater/.env.dev-remote` (same Emby creds and password, fresh session
  secret) — Jeremy asked that an agent do this rather than a checkpoint.
- **One workflow, `ci.yml`, replaces `test.yml`.** Tests/lint still run on PRs and
  pushes; build and deploy only on push to `main` or `workflow_dispatch`.
  `concurrency: deploy` serializes deploys. `build:` stays beside `image:` in
  every `deploy.yml` so emergency `--build` from the dev tree still works;
  `LILNAS_TAG=<sha>` is the rollback lever (`:latest` otherwise).
- **Change detection lives in the CLI (`lilnas ci detect`)**, not inline bash, so
  it is unit-tested and the service/env-file/bind-mount maps are derived from
  the compose files rather than hand-maintained.
- **The first real deploy happens from the run branch via `workflow_dispatch`**,
  before Land, so the whole path is proven end to end. After Land, the merge
  commit triggers one more full run (rebuilds everything, recreates the ten
  locally built services once more) — accepted.

## Context
- pnpm monorepo (`apps/*`, `packages/*`), Turbo 2.5.8. Root `docker-compose.yml`
  `include`s `infra/*.yml` and `apps/*/deploy.yml`; `docker-compose.dev.yml`
  (project `lilnas-dev`) includes `infra/*.dev.yml` + `apps/*/deploy.dev.yml`.
- **This machine is production.** The `lilnas` compose project (34 containers) runs
  from `/home/jeremy/lilnas`. A task may run `docker compose ps/ls/config`,
  `docker ps/inspect`, and `curl`, but never `up`, `down`, `restart`, `pull`, or
  `--build` against project `lilnas` or `lilnas-dev`. Host changes needing root
  or the `deploy` user are human checkpoints: agents have no passwordless sudo.
- Host facts: Docker 29.7.2, Compose 5.5.1, buildx 0.37. System `/usr/bin/node` 26,
  `/usr/bin/pnpm` 11, `/usr/bin/npm` 12 (what a `deploy` user sees); Jeremy's shell
  uses nvm node 24. `pnpm dlx @dotenvx/dotenvx@2.38.0 --version` works from `/tmp`.
  sshd: key-only, `AllowUsers jeremy` in `/etc/ssh/sshd_config.d/10-hardening.conf`.
  Tailnet: this node is `lilnas` / `lilnas.tail77e8b0.ts.net` / 100.110.234.82,
  untagged, owned by Jeremy's account. GitHub: `codemonkey800/lilnas`, public,
  default workflow token permissions = read (declare `permissions:` explicitly).
- Images: `ghcr.io/codemonkey800/lilnas-<name>`. Locally built services and their
  build context/Dockerfile (from their compose files): `auth`, `dashcam`,
  `download`, `equations`, `me-token-tracker`, `portal`, `tdr-bot`, `theater`
  (context repo root, `apps/<x>/Dockerfile`); `dev-idle-reaper` (context
  `apps/dev-idle-reaper`, `build: .`); `l4d2` (context repo root,
  `infra/l4d2/Dockerfile`, in `infra/l4d2.yml`). `tdr-code` is host-native
  (`apps/tdr-code/deploy.yml` is just an nginx proxy); never build it. Base images
  in `infra/base-images/*.Dockerfile`, built in order node-base → monorepo-builder
  → node-runtime → nextjs-runtime by `build-base-images.sh`.
- Env files compose loads (the 15 to encrypt): `apps/{auth,download,equations,me-token-tracker,tdr-bot,theater}/.env.prod`,
  `infra/.env` (immich), `infra/.env.{design,l4d2,nexus-code,palworld,storage,traefik,turbo,valheim}`.
  `env_file:` references: `apps/*/deploy.yml`, `apps/tdr-bot/deploy.dev.yml`
  (`.env.prod`), `infra/{design,immich,l4d2,palworld,proxy,shared,shared.dev,valheim}.yml`,
  and the root compose `include:` entry `env_file: ./infra/.env.nexus-code`. Plain
  dev files (`apps/*/.env`, `.env.dev-remote`, `apps/tdr-code/.env`) are untouched.
- **Encrypted-file discovery rule** (CLI and deploy script must agree): tracked
  files (`git ls-files`) matching `apps/*/.env.prod`, `infra/.env`, `infra/.env.*`,
  excluding `*.example` and `*.decrypted`. Decrypted sibling = `<file>.decrypted`,
  mode 0600, written atomically, with dotenvx's header comment and the
  `DOTENV_PUBLIC_KEY` line stripped so the container env is identical to today's.
- To validate compose files in a worktree (the `.decrypted` files don't exist
  there): `touch` empty placeholders at every referenced `.decrypted` path (they
  are gitignored), then `docker compose -f docker-compose.yml config -q`.
- CLI: `packages/cli` (oclif, runs TS via tsx from `packages/cli/bin/run.js`;
  invoke as `pnpm lilnas <cmd>` from the repo root). Imitate
  `src/commands/redeploy.ts`, `src/base-service-command.ts`, `src/utils/services.ts`
  (js-yaml compose parsing), `src/utils/docker.ts`. Lint: `pnpm --filter @lilnas/cli lint`;
  prettier + eslint must pass. `packages/utils/jest.config.js` is the jest
  pattern to copy.
- Shell scripts: `#!/usr/bin/env bash`, `set -euo pipefail`, no `sudo` inside
  scripts meant for `deploy`; `install-host.sh` is the one run as root.
- Workflow lint: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12`
  (with shellcheck) must pass on the final workflow.
- Never print the contents of any `.env.prod`, `infra/.env*`, `.env.keys`, or
  `.decrypted` file into a transcript or log. Copy, grep for patterns, count.

## Done means
Implemented as the task describes; `packages/cli` tests cover every case the
task names and pass; all `checks:` pass; after T6 the workflow passes
`rhysd/actionlint:1.7.12` with shellcheck enabled (it fails at `base` on
`test.yml` only); no committed file contains a plaintext secret value (every
value line in a committed env file is `KEY=encrypted:…` or `DOTENV_PUBLIC_KEY=…`);
no task ran `docker compose up/down/restart/pull/--build` against the `lilnas`
or `lilnas-dev` project; docs updated where the task says so.

## Planner notes
- `apps/theater/.env.prod` is missing on disk; `docker compose config -q` in
  `/home/jeremy/lilnas` exits 1 because of it. theater and `l4d2` are defined but
  not running; a full `up -d` from `/opt/lilnas` starts both.
- Unreferenced env files found: `infra/.env.auth`, `.env.forward-auth-truereflection`,
  `.env.monitoring` (holds a Grafana webhook token), `.env.truereflection-dev-db`,
  and `infra/env/*` (Apr 2025). Jeremy chose to delete them.
- `turbo ls --affected --output json` works (needs `TURBO_SCM_BASE`/`TURBO_SCM_HEAD`
  and full history); it lists `packages/cli` etc. — only `apps/*` with a
  Dockerfile + deploy.yml become images.
- `actionlint` with shellcheck fails at base (SC2086/SC2231 in `test.yml`), so the
  check runs with `-shellcheck=`; full actionlint is a Done-means gate after T6.
- No passwordless sudo for agents (`sudo -n true` fails), so host provisioning,
  Tailscale, GitHub secrets, and the first deploy are H tasks.
- dotenvx 2.x: `ext precommit` is deprecated in favour of `dotenvx protect`; T3
  documents whichever 2.38.0 ships working. Private key names derive from the
  filename suffix (`.env.prod` → `DOTENV_PRIVATE_KEY_PROD`, `infra/.env` →
  `DOTENV_PRIVATE_KEY`, `.env.nexus-code` → `DOTENV_PRIVATE_KEY_NEXUS-CODE` — dotenvx 2.38.0 keeps the hyphen; C1 from T3, T8 and T7 wording fixed), so
  the shared `.env.keys` ends with 10 keys for 15 files.
- Compose recreates a container when its resolved config changes: adding
  `image:` recreates the ten locally built services on the first deploy no
  matter what; stripping `DOTENV_PUBLIC_KEY` from decrypted files keeps every
  other service's env byte-identical so they are left alone.
- Bash reads scripts lazily, so a deploy script that `git checkout`s a new
  version of itself mid-run can break: the forced-command entrypoint lives
  outside the repo and copies the checked-out script to a temp file before
  exec'ing it.
- After Land, `/home/jeremy/lilnas` holds untracked plaintext `.env.prod` files
  at paths main now tracks; `git checkout`/`merge` refuses until they are moved
  (to their `.decrypted` names). H6 and `docs/deploy.md` carry the steps.
- GHCR packages are created private on first push; Jeremy flips each to public
  in the GitHub UI (H5) — there is no API for package visibility.
- Known-hosts entry for the tailnet name (public, committed by T5):
  `lilnas.tail77e8b0.ts.net ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINksAaSTK1UgrlHjsCJ314oQkerOZquHtik8mKu0nGXv`.
- The user asked for Fable at high effort for every task: each T task sets
  `model: frontier`; effort is run config (verify with `nexus_run_get`).

- Session history (2026-10-17): H1 (host env prep) and H2 (verify encrypted
  commit + back up keys) were folded into T8 at Jeremy's request — he wants
  agents to do anything they can; checkpoints only for sudo, admin consoles,
  GitHub UI, and the go/no-go on prod. Apply the same bar to any new task.
- Research already done, don't redo: `pnpm --filter @lilnas/cli run --if-present test`
  exits 0 at base (no test script yet); `@lilnas/utils` jest = 9 suites/593
  tests, ~3 s; `rhysd/actionlint:1.7.12` image works via docker; `pnpm dlx
  @dotenvx/dotenvx@latest` works under system pnpm 11 from `/tmp`; npm latest
  dotenvx is 2.38.0; root `.dockerignore` lacks `.env*` (T1 adds it); no
  Dockerfile references an env file; `/storage/backups` → `/mnt/hdd3`,
  `/storage/app-data` → `/mnt/ssd2`, `/home` is on the boot NVMe.
- `apps/theater/.env.dev-remote` exists with the same key set prod needs
  (minus `NEXT_PUBLIC_SOCKET_URL`); that is T8's source for theater's prod env.
- Ruled out: Watchtower-style `:latest` tracking; sops/age (system packages);
  symlinked secrets; deploying from `/home/jeremy/lilnas`; forced-command key on
  `jeremy`; compose `profiles:` for l4d2/theater (H6 just stops l4d2 if unwanted);
  reusable-workflow split of `test.yml` (one `ci.yml` instead); inline-bash
  change detection (moved into `lilnas ci detect` for tests).
- Workflow gotchas for T6/T7 follow-ups: `github.event.before` is all zeros on
  a new branch → `full`; default token permissions are read-only so
  `permissions:` must be explicit; `needs` on a skipped job needs the
  `!cancelled() && result != 'failure'` idiom; the `production` environment
  must exist (H4 creates it) or the deploy job hangs.
- Open threads: none with Jeremy. Run config: tasks pin `model: frontier`;
  effort was to be set to high on the run by Jeremy before Start — not
  verified from this chat.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report,
     the rollout record. Humans may add notes here too. -->

### 2026-10-17 · T1 · done
Compose now expects these 15 decrypted paths to exist before `up`:
apps/{auth,download,equations,me-token-tracker,tdr-bot,theater}/.env.prod.decrypted,
infra/.env.decrypted, infra/.env.{design,l4d2,nexus-code,palworld,storage,traefik,turbo,valheim}.decrypted.
apps/tdr-bot/deploy.dev.yml (lilnas-dev project) also loads .env.prod.decrypted, so the
dev tree needs a decrypted tdr-bot file too. The image tag var is LILNAS_TAG (default
`latest`). Validating compose in a worktree also needs placeholder plain dev files
(apps/*/.env, apps/{download,theater}/.env.dev-remote, apps/tdr-code/.env) since those
are gitignored and absent there — not caused by this task. .gitignore has no *.decrypted
rule yet (T3); placeholders were removed before committing.

### 2026-10-17 · T2 · done
Every `FROM lilnas-*` now resolves to `ghcr.io/codemonkey800/lilnas-<x>:latest`;
`lilnas-node-base.Dockerfile` still starts from public `node:25.0.0-slim`.
`build-base-images.sh` usage: `./infra/base-images/build-base-images.sh [--push] [--tag <sha>]`.
It builds node-base → monorepo-builder → node-runtime → nextjs-runtime with tags
`ghcr.io/codemonkey800/lilnas-<x>:latest` + local alias `lilnas-<x>` (+ `:<sha>` with --tag),
then `lilnas-dev` local-only; `--push` pushes only the four GHCR images.
Until the GHCR packages exist (bootstrap or the T6 CI job), a local `docker build` of any
app Dockerfile will try to pull the GHCR tag — run the script once locally first (it creates
the GHCR-named tags locally without pushing). `apps/*/deploy.dev.yml` still use `image: lilnas-dev`,
which the script still produces. CLAUDE.md "Docker Base Images" section still lists the short
names; left for the docs task.

### 2026-10-17 · T5 · done
Decisions:
- pnpm dlx works both from /tmp and from inside the repo (inside only emits a
  harmless "pnpm field no longer read" warning), so decrypt-env.sh runs dotenvx
  with cwd=$ROOT and COREPACK_ENABLE_STRICT=0 exported.
- decrypt-env.sh has an extra `--list [root]` mode that prints the discovered
  files; lilnas-deploy.sh uses it to detect missing .decrypted siblings so the
  discovery rule lives in one place. Header strip = lines matching `^#/` plus
  `^DOTENV_PUBLIC_KEY` (dotenvx 2.38.0 writes `DOTENV_PUBLIC_KEY_PROD="…" # -fk …`).
  Decrypted values came out byte-identical to the plaintext source.
- Decrypt success is judged by content (non-empty, no `encrypted:` values
  remaining), not dotenvx's exit code.
- lilnas-deploy.sh reads DEPLOY_ROOT/KEYS_FILE from the environment with the
  /opt/lilnas defaults (the entrypoint passes them explicitly); the entrypoint
  and installer keep them as hard constants.
- Entrypoint runs the temp copy as a child (not exec) so an EXIT trap removes
  the mktemp dir; fd 9 holds the flock for the whole deploy either way.
  Rejections exit 2, deploy failures exit 1.
- install-host.sh prints `sudo cat <key> | gh secret set DEPLOY_SSH_KEY -R
  codemonkey800/lilnas` rather than a bare redirect, since gh auth belongs to
  jeremy, not root. If the sshd drop-in has no AllowUsers line it warns and
  skips instead of adding one (adding `AllowUsers deploy` alone would lock
  jeremy out). The sshd unit on this host is `sshd.service`.
- Only `--decrypt` with no service flags is allowed and runs decrypt +
  config -q + image prune only.
For T6 (workflow): invoke as
`ssh deploy@lilnas.tail77e8b0.ts.net "deploy <sha> --pull a,b --up c,d --force-recreate e,f"`;
write scripts/deploy/known_hosts to ~/.ssh/known_hosts. For T7 (docs):
install-host.sh must be run from a checkout (it copies the entrypoint from
its own directory).

### 2026-10-17 · T3 · done
- `listEncryptedEnvFiles(root, tracked)` returns ABSOLUTE paths (path.join(root, relPath)), sorted by repo path. Rule: `^(apps/[^/]+/\.env\.prod|infra/\.env(\.[^/]+)?)$` minus `*.example` / `*.decrypted`. The deploy script (T5/T6) must use the same rule; the .gitignore comment points at this function.
- dotenvx 2.38.0 key names keep hyphens: `infra/.env.nexus-code` -> `DOTENV_PRIVATE_KEY_NEXUS-CODE` (task text said `_NEXUS_CODE`). `privateKeyNameFor` follows dotenvx (`src/lib/conventions/keynames.js`: `environment(filename).toUpperCase()`); the `.env.keys` written by `dotenvx encrypt` uses that spelling. Also: if a file already has a `DOTENV_PUBLIC_KEY_<X>` line, dotenvx derives the private key name from it.
- `isFullyEncrypted` treats an empty value (`KEY=` / `KEY=""`) as plaintext — dotenvx encrypts empty strings too, so a bare empty value means a hand edit. Non-`KEY=value` lines are reported as `line <n>` rather than echoed.
- `dotenvx decrypt --stdout` output = file contents + one extra trailing "\n" (console.log); it is written as-is after header stripping. dotenvx's own `# .env.<name>` comment line survives (it is a comment, kept verbatim). On a missing/wrong key dotenvx exits 1 with `[DECRYPTION_FAILED]` and no partial output; decrypt additionally fails if any value is still `encrypted:` after the run.
- Pre-commit guard for T7 docs: `pnpm exec dotenvx ext precommit --install` (deprecated but repo-local, installs .git/hooks/pre-commit, blocks root + nested plaintext `.env*`, falls back to `npx dotenvx` so the root devDependency suffices). Do NOT document `dotenvx protect`: it writes filters with absolute machine paths into ~/.gitconfig and ~/.config/git/attributes (global). I ran it once on this host during testing and fully reverted it.
- Workspace quirk: `.npmrc` has `inject-workspace-packages=true`, so `pnpm lilnas` runs an injected COPY of packages/cli; after adding/changing CLI source files, run `pnpm install` (or the `build` script) to re-sync or new commands show "not found".
- `pnpm install` also re-resolved some lockfile peer keys (zod/esbuild dedup) — no package version changes beyond dotenvx + the cli jest devDeps.
- `scripts/deploy/*.sh` doesn't exist yet (check is a no-op); actionlint passes on the current workflows.

### 2026-10-17 · T8 · done
- dotenvx 2.38.0 does NOT reuse an existing DOTENV_PRIVATE_KEY_PROD from a `-fk` key file: the first pass produced six distinct PROD keypairs (15 key lines). Fixed by keeping auth's keypair, seeding the other five .env.prod plaintexts with auth's `DOTENV_PUBLIC_KEY_PROD` header before encrypting, and removing the five duplicate entries from .env.keys. Final: 10 keys, one shared PROD public key. Anyone re-encrypting a .env.prod later must keep the existing DOTENV_PUBLIC_KEY_PROD line in the file (dotenvx then reuses it).
- Private key name for infra/.env.nexus-code is `DOTENV_PRIVATE_KEY_NEXUS-CODE` (hyphen), as T3 noted.
- Seven values were single-quoted in the originals (infra/.env, infra/.env.palworld); dotenvx preserves quote style and writes `KEY='encrypted:…'`. The task's grep pattern (`"?encrypted:`) flags those as plaintext; I used `['"]?encrypted:` and the HEAD-blob re-check is also clean. T3's `isFullyEncrypted` accepts single quotes.
- infra/.env.palworld originally had `SERVER_PASSWORD='…' # comment`; dotenvx keeps the trailing comment and T3's `isFullyEncrypted` then reports SERVER_PASSWORD as PLAINTEXT. I moved that comment onto its own line in the worktree copy before encrypting (values unchanged; round trip `same`). The host plaintext file is untouched.
- Host .env.keys lives at /home/jeremy/lilnas/.env.keys (600) with a byte-identical copy at /storage/backups/lilnas-secrets/.env.keys (600, /mnt/hdd3). Later tasks (deploy user / CI) need DOTENV_PRIVATE_KEY* values from it.
- `secrets verify` and `secrets decrypt` only see git-tracked files; they report "nothing to verify" on untracked copies — stage/commit first.
