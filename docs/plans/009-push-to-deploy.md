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
- **Image affectedness follows runtime workspace deps, not turbo** (C3 from T4,
  2026-10-17). Every app lists `@lilnas/cli` as a devDependency for `lilnas dev`,
  so `turbo ls --affected` would rebuild all eight root-context images on any
  CLI change. T11 replaces it with a `dependencies`-only graph walk in
  `ci detect`; `pnpm-lock.yaml` / root `package.json` / `pnpm-workspace.yaml` /
  `.npmrc` / `turbo.json` still rebuild every image. Ruled out: dropping the
  CLI devDependency from eight apps (bigger change, breaks `pnpm dev`).
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
- C3 (T4): turbo `--affected` output can't say *why* a package is listed, so the
  dev-edge false positive can't be filtered after the fact; hence T11's own walk.
  Workspace runtime deps in use: `@lilnas/utils` (several apps), `@lilnas/media`
  (two); `@lilnas/cli`, `@lilnas/eslint`, `@lilnas/prettier` appear only in
  devDependencies. T6 is unaffected (turbo ran inside the command).
- C4 (T9, 2026-10-18): Compose interpolates `${VAR}` inside an included file
  from that file's directory `.env` unless the include entry sets `env_file`;
  encrypting `infra/.env` broke `infra/immich.yml`'s `${DB_*}` (the only file
  relying on it — every other `${…}` is `LILNAS_TAG` or the nexus-code include).
  R4 fixes the include; R5 pushes + dispatches the redeploy (full run, since a
  root compose change is `full`); T9 round 2 waits on R5 (a redeploy task must be an R task to sit in the defects phase). Journal-group tweak
  for jeremy lives in the installer, applied whenever it is rerun.
- C5 (T9, 2026-10-18): `workflow_dispatch` diffs `HEAD~1..HEAD` only, so a
  dispatch after a multi-commit push (or when the tip is a plan-docs commit)
  says "Nothing to deploy" and the host stays put — this is why the first
  redeploy attempt for R4 did nothing. R5 (planned with `full=false`) was
  skipped as superseded by the runner's R6, which redeploys with `full=true`;
  T13 adds a `base` dispatch input (verified with `git rev-parse --verify`,
  warning when omitted) and documents the three dispatch forms. Push events
  are unaffected (`github.event.before` spans the whole push). The deployed
  sha is readable without sudo via `git -C /opt/lilnas rev-parse HEAD`.
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

### 2026-10-17 · T4 · done
- Command: `pnpm lilnas ci detect --base <sha> --head <sha> [--full] [--json]`; `--head` defaults to HEAD. Without `--json` it prints a human summary; with `--json` one compact JSON line on stdout (nothing else on stdout; pnpm's WARN lines go to stderr). Base is "unusable" (→ full) when unset, all zeros, not a commit, or not an ancestor of head (`git merge-base --is-ancestor`). Turbo is run via `pnpm exec turbo ls --affected --output json` with TURBO_SCM_BASE/HEAD; it is skipped entirely when full.
- Decisions beyond the spec: under `full`, `decrypt: true` (decrypt all) and the pull-removes-from-up rule is applied uniformly, so `pull ∪ up` = every service (up alone is not every service). `ImageBuild.image` is tag-less (`ghcr.io/codemonkey800/lilnas-auth`); the workflow adds its own tag. `context` is `.` for the repo root. A non-`.decrypted` env_file ref (tdr-code's plain `.env`) still yields `up` but never `decrypt`.
- Image rule also fires when the changed file is `apps/<x>/deploy.yml` or `apps/<x>/.env.prod` (they live under the Dockerfile's directory) — so those changes rebuild the image too; harmless since `pull` then subsumes `up`.
- Bind-mount matching is symmetric (file == mount, file under mounted dir, or mount under changed path). `auth` bind-mounts every compose file `:ro`, so any `infra/*.yml` / `apps/*/deploy.yml` change force-recreates `auth` — correct, just expected noise.
- `testPackages` keeps test.yml semantics exactly, so `apps/tdr-code` (has a `test` script) IS included when its files change; the tdr-code exclusion only applies to images/services.
- Turbo semantics T6 should know: `@lilnas/cli` is a root `package.json` dependency, so turbo marks ALL packages affected (`RootInternalDepChanged`) whenever `packages/cli/package.json` changes — and likewise for root `package.json`/`pnpm-lock.yaml` — producing all 8 app images. Also turbo includes uncommitted working-tree changes; CI checkouts are clean so that is fine.
- After adding CLI commands run `pnpm install` (inject-workspace quirk from T3) — I did; lockfile unchanged.
- No docker compose lifecycle commands were run; no env file contents were printed.

### 2026-10-17 · T10 · done
- The comment handling lives entirely in `unquote()` in `packages/cli/src/utils/secrets.ts`, which `parseEnvLines` calls, so `isFullyEncrypted` (verify) and `encryptedKeysIn` (decrypt's still-encrypted check) agree by construction.
- Rule: a value starting with `"`, `'` or `` ` `` ends at the next matching quote; if the remainder is `^\s*(#.*)?$` the inner text is the value (so `KEY="encrypted:x"#c` and `KEY="a # b"` both work). If something else follows the closing quote, the raw trimmed string is returned unchanged (previous behavior). Unquoted values strip `\s+#.*$` (dotenv's rule; `KEY=a#b` keeps the `#`).
- `stripDotenvxHeader` and the `.decrypted` writing path are untouched; decrypted output is still byte-identical to dotenvx's.
- `pnpm install` made no lockfile change; only the injected CLI copy re-synced.

### 2026-10-17 · T6 · done
Decisions beyond the spec:
- `deploy` also `needs` test / lint-and-typecheck / base-images (guarded `!= 'failure'`), not just detect + build-images. Otherwise, with no images to build, `build-images` is skipped and a failing test would not block an `--up`/`--decrypt` deploy.
- Both `build-images` and `deploy` additionally require `needs.detect.result == 'success'`: if detect fails its outputs are empty strings and `'' != '[]'` would be true.
- Under `--full` the deploy command omits `--decrypt`/`--pull`/`--up`/`--force-recreate` (lilnas-deploy.sh ignores service lists when full, and full implies decrypt).
- "Nothing to do" = not full, no decrypt, and empty pull/up/forceRecreate; the job still runs (hits the `production` environment) but writes a summary line and skips Tailscale/SSH entirely. If the environment gets required reviewers, no-op runs will wait for approval too.
- detect's `images` output is trimmed to `{name, context, dockerfile, image}` so every matrix value is a scalar (the `services` array is dropped). Dispatch BASE is `git rev-parse HEAD~1`.
- `build-push-action` uses `pull: true` for app images and for the three base images that are FROM a sibling base image, so a freshly pushed `:latest` base is picked up in the same run. Base-image job needs only `detect` (does not wait for tests), as specified.
- Test artifact names replace `/` with `-` (`test-results-apps-download`), since upload-artifact v4 rejects `/`; added `if-no-files-found: ignore`.
- The deploy step sparse-checks-out `scripts/deploy` only (for `known_hosts`); SSH output is tee'd into the step summary and the ssh exit status is propagated.
For T7 docs: dispatch inputs are `dry_run` (default true), `full`, `build_base_images`; required secrets are `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `DEPLOY_SSH_KEY`; the `production` environment must exist (or be created on first run); the required status check for branch protection is the `summary` job.
No docker compose lifecycle commands were run; no env file contents were printed.

### 2026-10-17 · T11 · done
- The task's "T3 commit must show images: []" expectation cannot hold as written: T3 (98fa2dbe) also changed root `package.json` and `pnpm-lock.yaml`, which the task's own global-build-input rule marks as rebuild-everything (and it says that trade-off is accepted). Verified `images: []` instead on the two genuinely CLI-only commits in range (T4 20e3d2b8, which includes a `packages/cli/package.json` change, and 33e1df24). T3's range correctly yields all 10 images with `full: false`.
- Utils-only range was synthesized with `git commit-tree` on a temp index (dangling commit, no branch/index/working-tree change) and produced exactly the eight apps with `@lilnas/utils` in `dependencies`.
- `workspacePackages` is optional on `DetectInputs` (defaults to `readWorkspacePackages(root)`), so existing callers/tests that only pass `root`+`changedFiles` keep working; the command passes it explicitly. `listTestPackages` is unchanged in behaviour and now shares the manifest reader.
- A `dependencies` entry counts as a workspace dep if its spec starts with `workspace:` OR its name matches another workspace package; dev/peer/optional deps are ignored.
- CLI flags and JSON shape are unchanged, so T6's workflow needs no edits. `pnpm install` left the lockfile unchanged.
- No docker compose lifecycle commands were run; no env file contents were printed.

### 2026-10-17 · T7 · done
Decisions:
- On-host manual deploy is documented as `sudo -u deploy env SSH_ORIGINAL_COMMAND="deploy <sha> …" /home/deploy/bin/lilnas-deploy-entry` (`env` rather than `sudo -E`, which depends on sudoers env policy).
- Rollback written as `sudo -u deploy env LILNAS_TAG=<sha> docker compose up -d <svc>` from /opt/lilnas, since the clone is deploy-owned.
- "Installer's copy step" for a new key is spelled out as the equivalent `sudo install -o deploy -g deploy -m 0600 /home/jeremy/lilnas/.env.keys /opt/lilnas/.env.keys` (or re-running install-host.sh, which is idempotent).
- Added the shared-PROD-key caveat from the plan: a new `apps/*/.env.prod` must carry the existing `DOTENV_PUBLIC_KEY_PROD` line before `dotenvx encrypt`, or dotenvx mints a new keypair.
- Key names use dotenvx's spelling (`DOTENV_PRIVATE_KEY_NEXUS-CODE`), verified against the key names (not values) in /home/jeremy/lilnas/.env.keys.
- Upstream `:latest` row explains why `up -d` won't upgrade and that a tag bump in `infra/<name>.yml` is needed.
- The dev-checkout snippet moves plaintext files to `.decrypted` before `git pull`; it is meant to run before pulling (after a pull the same paths are tracked).
No env file contents were printed; no compose lifecycle commands were run.

### 2026-10-17 · Phase 1 · review cycle 1
Pass 1 (T1, T2, T5): T1/T2 compose, Dockerfile and base-image changes match their task bodies; T5 scripts are careful about input validation, locking, atomic writes and secret handling. One blocking seam: the prod compose still loads the gitignored apps/tdr-code/.env, so `docker compose config -q` fails in the fresh /opt/lilnas clone and every deploy aborts before touching anything.
Pass 2 (T3): T3 implements the discovery rule, gitignore flip, secrets decrypt/verify, and tests as specified; gitignore proof list, oclif command mapping, monorepo root resolution, and dotenvx key-name convention all verified. One leak path: the atomic-write temp file for infra/ env files is not gitignored.
Pass 3 (T8): All 15 committed env files contain only encrypted values or DOTENV_PUBLIC_KEY lines; the six .env.prod files share one PROD public key, the theater file has exactly the keys the task listed, and the dotenvx `# -fk` hint on the public-key line is stripped by both the CLI and the deploy script and ignored because both pass the key file explicitly. No defects; two stale-comment notes only.
Pass 4 (T4, T10): T4's ci-detect rules and the T10 unquote change are correct and tested against the task's cases; the real tree's Dockerfile FROM lines, volume sources and root compose shape all fit the parser's assumptions. Only two notes for a human, no defects.
Pass 5 (T6, T11): Pass 5 (T6 ci.yml, T11 runtime-dep detect) is clean. Verified the detect command runs unbuilt with clean JSON stdout, the deploy command string agrees with the T5 entrypoint parser and allowlist, known_hosts exists, and no compose service name would be rejected. Only a note for a human.
Pass 6 (T7): T7 is docs-only; every command, flag, path, and detect rule in docs/deploy.md and the rewritten CLAUDE.md sections matches the T3–T6/T11 implementation (entrypoint grammar, decrypt-env usage, secrets/ci-detect flags, workflow dispatch inputs and jobs, installer steps, base-image script flags, gitignore). No findings.
Seams pass: Seams pass over T1–T11: ci.yml consumes the exact DetectResult fields, the SSH command grammar matches lilnas-deploy-entry.sh, the discovery regex is identical in secrets.ts / decrypt-env.sh / .gitignore, every env_file points at a .decrypted sibling, and the docs cite real flags. One real disagreement: the --full deploy path pulls with --ignore-buildable, which skips every service T1 left a build: on, so a full deploy never fetches the app images CI just pushed.

- F1 · P0 · Every deploy aborts: compose config fails on missing apps/tdr-code/.env in /opt/lilnas — scripts/deploy/lilnas-deploy.sh:123 → R1
- F4 · P1 · Decrypt temp file for infra/ env files is not gitignored — packages/cli/src/utils/secrets.ts:258 → R2
- F11 · P1 · --full deploy skips pulling every locally built image — scripts/deploy/lilnas-deploy.sh:127 → R3

Notes:
- F2 · P2 · --full never pulls the GHCR app images — scripts/deploy/lilnas-deploy.sh:128
- F3 · P2 · Temp-copy script executed via shebang from /tmp — scripts/deploy/lilnas-deploy-entry.sh:99
- F5 · P2 · DOTENV_PRIVATE_KEY_NEXUS-CODE is not a valid shell identifier — packages/cli/src/utils/secrets.ts:73
- F6 · P2 · theater .env.prod keeps a dev-specific comment block — apps/theater/.env.prod:24
- F7 · P2 · auth .env.prod header comment says 'Not committed' — apps/auth/.env.prod:8
- F8 · P2 · Env-only change rebuilds the app image — packages/cli/src/utils/ci-detect.ts:400
- F9 · P2 · Unusable-base logic is untested — packages/cli/src/commands/ci/detect.ts:15
- F10 · P2 · Root tsconfig changes do not rebuild any image — packages/cli/src/utils/ci-detect.ts:109
- F12 · P2 · Header-strip rules differ between CLI and decrypt-env.sh — scripts/deploy/decrypt-env.sh:64

### 2026-10-17 · R1 · done
Fixed F1 by removing `env_file: - .env` from apps/tdr-code/deploy.yml and setting
`LOCAL_PORT: '8790'` in the environment (the live value of PORT in the host's
apps/tdr-code/.env, which entrypoint.sh used as its fallback). I did not use the
suggested `required: false`: with the file missing, PORT would be unset, nginx would
render proxy_pass with no port, and the proxy would break the first time it was
recreated in /opt/lilnas. Removing the file also keeps the host process's
Discord/GitHub/auth secrets out of the nginx container.
Verified: in a fresh clone with only the 15 `.decrypted` placeholders touched,
`docker compose -f docker-compose.yml config -q` passes (one expected warning about
NEXUS_PROXY_TOKEN, because the placeholder is empty). All plan checks pass.
docs/deploy.md now says the port is pinned in deploy.yml and must be kept in sync
with PORT in the host .env. On the next deploy the tdr-code proxy container will be
recreated (its environment changed) with the same port.

### 2026-10-17 · R2 · done
writeFileAtomic0600 now writes plaintext to `<target>.tmp-<pid>.decrypted`, via the new exported atomicTempPathFor(target, pid?), so `*.decrypted` covers it.
.gitignore gains `*.decrypted.*` after `*.decrypted` as a backstop. This also covers scripts/deploy/decrypt-env.sh, whose `mktemp "$dest.XXXXXX"` temp (`infra/.env.x.decrypted.Ab12Cd`) had the same trackable-orphan problem. I left the script unchanged because the ignore rule handles it.
The proof comment lists both temp names; checked by hand with `git check-ignore --no-index`.
New tests: name format, a git check-ignore of the temp path for all 15 encrypted files (runs real `git` from the repo root), and a writeFileAtomic0600 round-trip that checks mode 0600 and that no temp file is left.
All six checks pass: cli lint, type-check, 67 cli tests, utils jest 593, bash -n, actionlint.

### 2026-10-17 · R3 · done
--full now runs `docker compose pull` (no --ignore-buildable) then `up -d`. Dry-run prints both via the existing `run` helper.
I checked compose's behaviour in a throwaway project: plain pull does pull image+build services, and it exits 1 if one of their images can't be pulled. So a missing GHCR image fails the deploy instead of leaving stale :latest running. This relies on CI's full-mode build matrix (detect's listImages = every image+build service) pushing all of them, which it does.
I couldn't run an end-to-end --dry-run --full in the worktree: --full always decrypts, and the worktree has no .env.keys.
docs/deploy.md host-setup paragraph now says --full pulls the lilnas-* images too.
All plan checks pass.

### 2026-10-17 · Phase 1 · review cycle 2
Remediation diff fixes F1, F4 and F11 as described: tdr-code no longer loads the gitignored .env and the entrypoint honours the pinned LOCAL_PORT; decrypt temp files end in .decrypted and are covered by the ignore rules (verified with git check-ignore and a new test); --full now runs a plain docker compose pull and every build: service has a ghcr.io image to pull. No new defects in the remediation diff; only a stale comment in infra/local-proxy/entrypoint.sh line 4.

Earlier findings: F1 fixed, F4 fixed, F11 fixed.

### 2026-10-18 · H3 · approved
H3 done. Installer ran (deploy user, /opt/lilnas clone, .env.keys 0600, forced-command entry, CI key, AllowUsers + sshd reload). Branch head 7bcc552c already on origin. Dry-run over tailnet (sudo ssh -i ci-deploy-key deploy@lilnas.tail77e8b0.ts.net "deploy 7bcc552c… --dry-run --full"): checked out 7bcc552c, 15 `decrypted …` lines, [dry-run] docker compose pull / up -d / image prune -f / ps, "lilnas-deploy: done". Forced command rejected `id` ("unknown command: id", exit 2) and `deploy <sha>; id` ("bad characters in command", exit 2). DEPLOY_SSH_KEY set via gh (confirmed in `gh secret list`); host copy of ci-deploy-key shredded.

### 2026-10-18 · H4 · approved
Approved.

### 2026-10-18 · H5 · approved
Green dry run: https://github.com/codemonkey800/lilnas/actions/runs/39157513703 (sha 740a5a19). All test/lint jobs passed, base-images plus all 10 app images were built and pushed, and the deploy job joined the tailnet and ran `deploy 740a5a19 --dry-run --full`. The host log shows the decrypt lines for all 15 env files, and the only commands were `[dry-run] docker compose pull / up -d / image prune -f / ps`. Host unchanged: `docker compose ls` shows lilnas running(34).

GHCR: all 14 lilnas-* packages already serve manifests anonymously (HTTP 200 with an anonymous token), so no visibility change was needed. An unauthenticated `docker pull ghcr.io/codemonkey800/lilnas-auth:latest` with an empty DOCKER_CONFIG succeeded. Pull only, no `up`.

Fixes needed to get here, already merged to main and then into the branch: tdr-bot cron timezone (b14c25a4), auth infra/browser.yml mount (f97b9ed6), equations @nestjs/testing devDependency (e17ce428), equations Dockerfile bullseye→bookworm because bullseye-security pool files now 404 (93b981d0). Also, ci.yml has a workflow_dispatch-only stub on main (d958d10f) so the workflow can be dispatched; the real ci.yml replaces it when the branch merges.

### 2026-10-18 · H6 · approved
Approved.

### 2026-10-18 · T9 · partial
Read-only verification; nothing committed. Deploy of bdf7e52e from /opt/lilnas
succeeded: 9 ghcr app containers up with the right revision/labels, all five
endpoints 2xx/3xx, 15 .decrypted files present 0600, CI run 39165171151 green.
journalctl -t lilnas-deploy can't show the deploy user's lines to jeremy (not
in systemd-journal group); the CI deploy log shows start/done instead.
11 unchanged containers still carry working_dir=/home/jeremy/lilnas (harmless).

Defects:

- blocking · immich-database env interpolated from encrypted infra/.env · docker-compose.yml:12 (include ./infra/immich.yml) / infra/immich.yml:57-59
  docker inspect lilnas-immich-database-1: 3 env values '=encrypted:…'; health log 'pg_isready: error: invalid connection option "encrypted:…"'; status unhealthy. Worktree `docker compose config` renders 7 'encrypted:' values, all in immich-database (environment + healthcheck). Compose include interpolates ${DB_*} from infra/.env, not infra/.env.decrypted. Fix: add `env_file: ./infra/.env.decrypted` to the immich.yml include entry (like nexus-code) and force-recreate immich-database.
- not blocking · games-profile containers exited (minecraft 0, palworld 137) · infra/minecraft.yml, infra/palworld.yml
  docker ps: lilnas-minecraft-1 Exited (0) 20:27:40Z (log: 'Stopping server'), lilnas-palworld-1 Exited (137) 20:28:10Z (log: 'Save data is corrupted', segfault — pre-existing). Not caused by scripts/deploy/*.sh (no stop/down); deploy leaves inactive-profile services alone by design. Human decision whether to start minecraft.

No commits: nothing to integrate.

### 2026-10-18 · T9 · defects → R4
T9 reported 1 blocking defect at attempt 1, sent to R4; it runs again at round 2 to re-check.

- R4 · immich-database env interpolated from encrypted infra/.env (`docker-compose.yml:12 (include ./infra/immich.yml) / infra/immich.yml:57-59`): docker inspect lilnas-immich-database-1: 3 env values '=encrypted:…'; health log 'pg_isready: error: invalid connection option "encrypted:…"'; status unhealthy. Worktree `docker compose config` renders 7 'encrypted:' values, all in immich-database (environment + healthcheck). Compose include interpolates ${DB_*} from infra/.env, not infra/.env.decrypted. Fix: add `env_file: ./infra/.env.decrypted` to the immich.yml include entry (like nexus-code) and force-recreate immich-database.

### 2026-10-18 · R4 · done
Changed the root include `./infra/immich.yml` to
`{ path: ./infra/immich.yml, env_file: ./infra/.env.decrypted }`. Compose
interpolates an include from its project dir's `.env` (encrypted infra/.env)
unless env_file is set.
Regression test compose-include-env.spec.ts walks every root include, works out
the env file(s) used for interpolation, and fails if a `${VAR}` in the included
file matches a key in a tracked encrypted env file. It reads key names only,
never values. It fails on HEAD~ (DB_DATABASE_NAME, DB_PASSWORD from infra/.env)
and passes now. Other infra/*.yml string includes still default to infra/.env,
but none of them interpolate any of its keys, so they pass.
Verified in the worktree with placeholder .decrypted files (since removed):
`docker compose config -q` OK, 0 'encrypted:' values, immich-database
POSTGRES_* and the pg_isready healthcheck take the placeholder values.
All six plan checks pass.
Running immich-database is still broken until this is deployed. The
container's env is fixed at create time, so it needs
`docker compose up -d --force-recreate immich-database` in /opt/lilnas
(deploy user / CI). Agents may not do this. If the deploy only recreates
services whose config hash changed, this change does recreate
immich-database, because its rendered environment changes.

### 2026-10-18 · T12 · done
Added `ADMIN_USER=jeremy` beside `DEPLOY_USER` (the script had no admin-user constant; `KEYS_SOURCE` still hardcodes `/home/jeremy/lilnas/.env.keys`, left as-is). The group check reuses the script's existing `id -nG | tr ' ' '\n' | grep -qx` idiom rather than `grep -qw`. Step inserted as #2 (right after the deploy-user step) and steps 2–6 renumbered to 3–7; nothing outside the script referenced the numbers. The printed "next steps" block is not a rerun hint, so it was not changed. Script was not run; takes effect when Jeremy next reruns `sudo scripts/deploy/install-host.sh` and logs in again.

### 2026-10-18 · T9 · partial
Read-only; nothing committed. All 9 running lilnas-* app containers are Up
(auth healthy), l4d2/palworld/minecraft are in the games profile and not
started (expected). Compose labels: project=lilnas, working_dir=/opt/lilnas.
HTTP: auth 307, portal 302, download 302, tdr 302, theater 200, immich 200.
journalctl -t lilnas-deploy is not visible to jeremy for today's entries
(needs adm/systemd-journal group); the CI deploy step log shows
'lilnas-deploy: done' instead.
Follow-up needed (human/CI, agents may not run it): redeploy with a diff
that includes 85305904, e.g. `gh workflow run ci.yml -f dry_run=false
-f full=true` on feat/push-to-deploy, or merge to main (push events diff
against event.before). A full deploy re-renders immich-database's env and
recreates it; otherwise `docker compose up -d --force-recreate
immich-database` in /opt/lilnas as deploy.

Defects:

- blocking · immich-database still running with encrypted DB_* env (R4 fix not deployed) · /opt/lilnas/docker-compose.yml:12 (host at bdf7e52e; fix is 85305904 on origin/feat/push-to-deploy)
  docker inspect lilnas-immich-database-1: created 2026-10-18T20:08:54Z, State unhealthy, 3 Config.Env values '=encrypted:…', health log 'pg_isready: error: invalid connection option "encrypted:…"'. CI run 39168569885 at ff453469 (dry_run=false) deploy step printed 'Nothing to deploy for ff453469…' because workflow_dispatch diffs HEAD~1 (ci.yml:91), which covered only the docs commit. Host HEAD unchanged at bdf7e52e; /opt/lilnas/docker-compose.yml line 12 is still '- ./infra/immich.yml'.

No commits: nothing to integrate.

### 2026-10-18 · T9 · defects → R6
T9 reported 1 blocking defect at attempt 3, sent to R6; it runs again at round 3 to re-check.

- R6 · immich-database still running with encrypted DB_* env (R4 fix not deployed) (`/opt/lilnas/docker-compose.yml:12 (host at bdf7e52e; fix is 85305904 on origin/feat/push-to-deploy)`): docker inspect lilnas-immich-database-1: created 2026-10-18T20:08:54Z, State unhealthy, 3 Config.Env values '=encrypted:…', health log 'pg_isready: error: invalid connection option "encrypted:…"'. CI run 39168569885 at ff453469 (dry_run=false) deploy step printed 'Nothing to deploy for ff453469…' because workflow_dispatch diffs HEAD~1 (ci.yml:91), which covered only the docs commit. Host HEAD unchanged at bdf7e52e; /opt/lilnas/docker-compose.yml line 12 is still '- ./infra/immich.yml'.
