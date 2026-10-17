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
