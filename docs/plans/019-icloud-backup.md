---
nexus-plan: 2
title: 'icloud-backup: a family iCloud photo backup service with Immich accounts'
branch: feat/icloud-backup
base: main
setup:
  - pnpm install --frozen-lockfile
checks:
  - pnpm --filter @lilnas/utils build && pnpm --filter @lilnas/ui build && if [ -f apps/icloud-backup/package.json ]; then pnpm --filter @lilnas/icloud-backup lint && pnpm --filter @lilnas/icloud-backup type-check; fi
  - pnpm --filter @lilnas/utils build && pnpm --filter @lilnas/ui build && (cd apps/auth && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm exec jest src/services/__tests__ --maxWorkers=2) && if [ -f apps/icloud-backup/package.json ]; then cd apps/icloud-backup && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm exec jest --maxWorkers=2; fi
  - pnpm --filter @lilnas/cli build && pnpm mockups && pnpm mockups:lint
  - pnpm exec prettier -c docker-compose.yml docker-compose.dev.yml $(ls apps/icloud-backup/deploy.yml apps/icloud-backup/deploy.dev.yml 2>/dev/null)
  - '[ ! -f apps/icloud-backup/Dockerfile ] || docker build --check -q -f apps/icloud-backup/Dockerfile .'
parallel: 3
model: frontier
review: per-phase
review-model: strong
commit-style: 'conventional, scope required, e.g. feat(icloud-backup): …, feat(infra): …, test(icloud-backup): …, docs(icloud-backup): …'
---

# icloud-backup: a family iCloud photo backup service with Immich accounts

## Goal
Add `apps/icloud-backup` (`@lilnas/icloud-backup`, `https://icloud-backup.lilnas.io`, behind
lilnas-auth). A family member opens the site, reads a short pre-flight page, enters their Apple
ID and password, enters the code from their Apple device, and watches their iCloud photos and
videos back up to `/storage/photos/icloud-users/<name>`. The backup keeps running with the tab
closed and survives a restart. When the first backup finishes, the service creates an Immich
user and an external library on that folder, starts a scan and links to
`https://immich.lilnas.io`. A "Sync now" button re-runs the backup with the saved Apple session.
An admin page lists every person's backup.

Today this is two hand-run `docker run -it icloudpd/icloudpd:latest` scripts that run as root,
save no session and have no schedule.

The two existing folders, `/storage/photos/icloud` and `/storage/photos/icloud-mom`, are then
moved under `icloud-users/` and their Immich libraries are repointed by rewriting the paths in
Immich's database, so nothing is downloaded or imported twice and faces, albums and favourites
are kept.

The run ships in three pushes to `main`, each behind a human go/no-go: first one line that
mounts `/storage/photos/icloud-users` into Immich, then the app, then the removal of the two
old Immich mounts. Between the first two a human does a full dry run on
`https://icloud-backup.dev.lilnas.io` with a real Apple ID.

Not in version 1: a nightly schedule, a notice when Apple's session expires, Immich sign-in
through lilnas-auth, SMS codes, hardware
security keys, more than one Apple ID per person.

## Decisions
- **icloudpd is baked into the image and run as a child process** (Jeremy, 2026-11-19), from the
  official static binary `icloudpd-1.33.1-linux-amd64`, pinned by sha256. Ruled out: one
  container per job through the Docker socket, which would let a service that handles Apple
  passwords control every container on the host.
- **Backend and frontend are two containers from one image**, like `apps/auth`. icloudpd's login
  form is fixed to port 8080 on all interfaces, which is the port Next uses, and the frontend
  then holds no secret, no session folder and no photo mount.
- **Sign-in is one person at a time; downloads run two at once.** Sign-in is its own short
  `icloudpd --auth-only` process with the web form; downloads run without the form. A second
  person who signs in at the same moment sees a "you're next" screen that advances by itself.
  Jeremy does not expect simultaneous sign-ins; the screen is still built.
- **Identity comes from the lilnas-auth email.** Folder = the part before `@`, cleaned. The
  Immich user gets the same email; an existing Immich user with that email is reused. One Apple
  ID per lilnas user.
- **Disk guard at 200 GB free** on the photos disk: no job starts below it and a running download
  pauses. icloudpd reports a file count, never a total size, so there is no size pre-check.
- **Untested sign-in states are built from icloudpd's source and proven at the dry run**, where
  the human types a wrong password and a wrong code on purpose. SMS codes and security keys are
  unsupported by icloudpd's web form; the pre-flight page says so.
- **Mount first, then a dry run on dev, then the app.** The dry run uses the real photos parent
  folder and the live Immich with a `dev-` folder and a `+icloud-backup-dev` Immich email, both
  deleted afterwards.
- **An agent pushes after each human go/no-go**; humans do rollbacks (agents have no sudo).
- **The Immich temporary password is never stored.** The user is created with a random password
  nobody sees. A button resets it and shows the new one once, only for users this service
  created. This also covers a backup that finishes while the tab is closed.
- **A read-only admin page** for lilnas-auth admins (Jeremy asked for it in version 1).
- **The existing libraries move in this run, with their paths rewritten in Immich's database**
  (Jeremy, 2026-11-19, reversing the earlier "version 2"). Ruled out: keeping the old mounts
  pointed at the new folders (Jeremy wants one path scheme), and changing only the import path,
  which makes Immich re-import every file and drop faces, albums and favourites. The rewrite is
  unsupported by Immich, so it is rehearsed on a copy, preceded by a dump, and run with Immich
  stopped. The sudo steps (move, chown) are Jeremy's.
- **Adopted people are linked by an admin preset** (lilnas email, folder, Immich library), and
  their first sync counts what it would download and asks before downloading, in case the old
  runs named files differently.
- **Postgres, not SQLite**, as the original brief says; tests use PGlite so no check needs a
  database server.
- **Success is decided from the log, never the exit code**, and never from `--log-level debug`,
  which prints Apple session data.

## Context
- pnpm 12 + Turbo monorepo on Node 26. Apps in `apps/`, libraries in `packages/`. This plan adds
  `apps/icloud-backup`: a NestJS backend on :8081 (`src/`, modules wired in `src/app.module.ts`)
  and a Next.js 16 frontend on :8080 (`src/app/`), which rewrites `/api/:path*` and `/ws` to the
  backend. Patterns to imitate: `apps/dev` (smallest Nest + Next app, jest projects `node` and
  `jsdom`), `apps/download` (websocket gateway `src/download-gateway/`, client hook
  `src/lib/use-job-events.ts`, identity `src/auth/forwarded-user.ts`), `apps/auth`
  (`deploy.yml`, `next.config.js` and `Dockerfile` for the two-container split),
  `apps/tdr-bot/src/db` (drizzle + `pg`).
- Wire types live in `apps/icloud-backup/src/shared/contract.ts` (zod). Backend and frontend
  both import them; change them only in the task that owns that file.
- UI: `DESIGN.md`, `docs/designs/*.md`, components from `@lilnas/ui`, class names through `cns()`
  from `@lilnas/utils/cns`. Raw palette utilities and hex colours are lint errors.
- Tests: Jest, specs in `__tests__/` beside the source. Run only your own:
  `cd apps/icloud-backup && NODE_OPTIONS='--experimental-vm-modules --no-warnings=ExperimentalWarning' pnpm exec jest <paths> --maxWorkers=2`
  and read the `Tests:` line. Put paths before `--selectProjects`. `@lilnas/utils` and
  `@lilnas/ui` export from `dist/`: build them before type-check.
- Lint: `pnpm --filter @lilnas/icloud-backup lint` covers `src` only. For other files run
  `pnpm exec prettier -c <file>`; if a file failed before your edit (`infra/immich.yml`,
  `apps/auth/deploy*.yml` do), match its style and leave the rest.
- **This machine is production.** It runs compose project `lilnas` from `/opt/lilnas`, deployed
  only by pushing to `main` (`docs/deploy.md`). Never run `docker compose up/down/restart/pull/build`
  against project `lilnas`, never stop a `lilnas-*` container, never push unless your task says
  to. Read-only `docker compose -p lilnas ps|logs`, `docker inspect` and `docker logs` are fine.
  Never run two jest runs or docker builds at once. No sudo.
- Throwaway containers: own network, unique name prefix, no published ports. Remove containers,
  networks, volumes, images and temp files before finishing and show the cleanup in your result.
- Secrets: never print, log or commit an Apple password, a verification code, a session cookie,
  an Immich API key or password, `.env.keys` or a `*.decrypted` file. Mask Apple IDs as
  `<apple-id>` in results. Never run icloudpd with `--log-level debug`. Never send a password to
  Apple in a test: the only account an agent may use is `nobody@example.invalid`, and only up to
  the password form.
- No `any`. Report what you can't fix as `defects:` in your result.

## Done means
- The task's interfaces, states and edge cases are implemented as written; a deliberate
  difference is stated in the result with the reason.
- Every behaviour the task lists under Tests has a spec, and all `checks:` pass.
- No spec needs a network, a Postgres server, Docker or the real icloudpd binary.
- No Apple password, code, cookie, Immich key or Immich password is written to a log line, a
  database column, an error message, a fixture or the diff. Specs that feed a password through
  assert it is absent from every captured log call.
- Files outside `apps/icloud-backup/src` that passed `prettier -c` at `base` still pass.
- `icloud-backup-frontend` in `apps/icloud-backup/deploy.yml` has no `env_file`, no `volumes` and
  no secret in `environment`; only it carries Traefik labels.
- A task with `files: []` commits nothing. A task that pushes reports the pushed sha, the
  rollback sha, the CI run URL and each check with its observed value.
- A task that creates containers, networks, volumes, images or temp files shows they are gone,
  unless the task says to leave something for a later task.
- Mockup changes are committed with their rebuilt `*.html` (`pnpm mockups` leaves `git status`
  clean).

## Planner notes
Research on 2026-11-19 at `main` 658ee5d5 (fast-forwarded to `origin/main` that day with
Jeremy's approval; it had been 44 commits behind).

- **Checks at base:** all five pass in the main checkout. Auth `src/services/__tests__`: 6
  suites, 87 tests, 2 s. Mockups build + lint: 11 s, tree stays clean. `pnpm exec jest
  --selectProjects backend <paths>` swallows the paths (it ran all 48 suites); paths go first.
- **icloudpd 1.33.1, tested today:**
  - `https://github.com/icloud-photos-downloader/icloud_photos_downloader/releases/download/v1.33.1/icloudpd-1.33.1-linux-amd64`,
    sha256 `961131997d58f349f437b3a9637ce92f04213fdfe4f484913b85eb4bae64ccc2`, statically
    linked, prints `version:1.33.1` in `lilnas-nextjs-runtime` as uid 1000. The binary inside
    the Docker image is musl and does not run there.
  - No flag or env var moves the web form's port (`waitress.serve(app)`); it answered on the
    container's non-loopback address too.
  - With a fake account and `--auth-only`, `GET /status` returned the password form
    (`hx-post="/password"`). `POST /code` during the password step answered 200 "Code submitted",
    so the form accepts either post in either step: the relay must check the step first.
  - SIGTERM stops it at once.
  - Without the webui flags, no TTY and no saved session: a Python traceback ending
    `EOFError` from `getpass`, exit 1.
- **icloudpd source (read by a fetch agent, `master`):** routes `GET /`, `GET /status`,
  `POST /password`, `POST /code`, `POST /cancel`, `POST /resume`. Status enum: `no_input_needed`,
  `need_mfa`, `supplied_mfa`, `checking_mfa`, `need_password`, `supplied_password`,
  `checking_password`. A wrong code sets the error "Failed to verify two-factor authentication
  code" and returns to `need_mfa`. An error while `checking_password` moves to `no_input_needed`,
  so what a wrong password looks like from outside is not known. The web path has no SMS and no
  security-key branch. ADP: Apple answers `ACCESS_DENIED`; `--adp-web-access` exists and is not
  used here.
- **Immich v3.3.4, read from the image's `server/dist`:** `POST /api/admin/users` (`email`,
  `password`, `name`, `shouldChangePassword`, `notify`), `GET /api/admin/users`,
  `PUT /api/admin/users/:id`, `POST /api/libraries` (`ownerId` uuid, `name`, `importPaths`),
  `POST /api/libraries/:id/validate`, `POST /api/libraries/:id/scan`,
  `GET /api/libraries/:id/statistics`. Permission names: `adminUser.create|read|update`,
  `library.create|read|update|statistics`. The `immich` router has no lilnas-auth middleware.
- **Deploy facts:** a change to `infra/immich.yml` makes CI `up -d` every service in that file;
  a change to the root `docker-compose.yml` makes the plan `full` (every image, every service).
  New `apps/*/.env.prod` files share `DOTENV_PUBLIC_KEY_PROD`, so no new private key is needed.
  `apps/auth/src/services/__tests__/compose-mount-coverage.spec.ts` fails until a new
  `apps/*/deploy.yml` is mounted in both auth compose files.
- **Host:** agents run as uid 1000 (`jeremy`), which owns `/storage/photos` and
  `/storage/app-data`. `/storage/photos` is on ssd1 with 1.3 TB free.
- **Why the order is linear around pushes:** a push task pushes its worktree `HEAD`, so every
  task that adds app code is `after` T2, and nothing but fixes may land between H5 and T21.
- **Not settled:** reasoning effort is not a frontmatter key. Jeremy asked for fable at high
  effort; `model: frontier` is set here and the effort has to be set on the Start screen. Plan
  018's run showed `sonnet` despite `model: frontier`, so check the run config before Start.
- **Not verified:** a download run without the webui flags on a valid saved session (it is
  icloudpd's normal unattended mode; H4 proves it), the exact "already exists" log line, and
  whether GHCR lets the host pull a brand-new `lilnas-icloud-backup` package without a
  visibility change (T21 reports it).
- **Immich database, read-only look on 2026-11-19:** libraries "Jeremy iCloud" (`/icloud`,
  18,316 assets, owner is the admin) and "Mom's iCloud" (`/icloud-mom`, 20,322, owner is a
  non-admin user). Paths: `asset.originalPath`, one `asset_file` sidecar row, two
  `integrity_report` rows, `library.importPaths`. External assets use
  `checksumAlgorithm = 'sha1-path'` (46,589 rows); the formula is not yet confirmed, T22 does it.
  Unique index `asset_ownerId_libraryId_checksum_idx`. Derived files are under `/usr/…`, keyed
  by asset id.
- **The two folders:** same btrfs filesystem as `icloud-users` (`/mnt/ssd1`), icloudpd's
  default `YYYY/MM/DD` layout, files mostly `root:root` (3,807 of 18k in `icloud`, nearly all of
  `icloud-mom`), each holds its `sync-icloud.fish`. Agents have no sudo.
- **Phase 4 ordering:** T23's `infra/immich.yml` commit must not be pushed before H8; nothing
  else may be merged between T21 and T24 except the rewrite scripts, or it ships with the mount
  removal. Immich stays stopped from H8 until T24's deploy.
- Memory file `project_icloud_backup_app.md` holds the spike results.
- **C1 (T1, 2026-11-19):** any `infra/*.yml` change puts `auth` in detect's `forceRecreate`,
  because `apps/auth/deploy.yml` bind-mounts each infra file. So the T2 and T24 pushes restart
  auth for a few seconds. H1, T2, H7 and T24 now say so and check auth afterwards.

### Steering notes saved 2026-11-19 before a context clear
- Run `nexus-run:c31736cc-8783-45f6-a047-8275377bb163`, started 2026-11-19, branch
  `feat/icloud-backup`, worktree `/home/jeremy/.nexus-code/worktrees/lilnas/feat-icloud-backup`.
  Jeremy asked for fable (frontier) at high effort; effort is set on the Start screen and is not
  confirmed. Check `nexus_run_get` config if a task looks like it ran on another model.
- User decisions, all final (asked with the question tool, which Jeremy prefers over plain-chat
  questions): binary in image with a backend + secret-free frontend split; sign-in one at a time
  with a "you're next" screen (he does not expect simultaneous sign-ins), 2 parallel downloads;
  folder and Immich email from the lilnas email; disk guard 200 GB; build untested sign-in states
  from source and prove them at H4; mount push first, dry run on dev, then the app; an agent
  pushes after each go/no-go; Immich temp password never stored, reset button; a read-only admin
  page in version 1; existing `icloud` and `icloud-mom` folders are moved and Immich's paths
  rewritten in phase 4 (he explicitly wants everything under the new path, not old mounts kept).
- Why the adoption support is built in phases 1 and 2 instead of phase 4: it avoids a second
  app push. Presets (admin form), states `previewing` and `review_download`, and
  `--only-print-filenames` are in T3, T4, T5, T6, T9, T10, T11, T13 and T14.
- Push ordering rules: every task that adds app code is `after` T2. Nothing but fixes may land
  between H5 and T21. In phase 4 nothing may merge between T21 and T24 except T22's scripts and
  T23's `infra/immich.yml` commit, and T23's commit must not be pushed before H8. A new task
  that edits code must be `after` the preceding push task, never parallel to a pending push.
  If `origin/main` moved before a push, ask Jeremy; no agent merges or rebases.
- Ruled out: Docker socket per job; one global job queue; SQLite; storing the Immich temp
  password; changing only the library import path (Immich re-imports and drops faces/albums);
  keeping old Immich mounts pointed at moved folders; a hot-reload dev stack (port 8080 clash,
  split untested); `--log-level debug` (prints Apple session data); a second login spike.
- Known weak spots to expect change requests on: how icloudpd reports a wrong password (T9
  isolates it, H4 shows it); the "already exists" and `--only-print-filenames` output formats
  (T6 matches loosely); the `sha1-path` checksum formula (T22 must reproduce all 38,638 rows);
  whether the seven API-key permissions suffice (T8 reports a 403); GHCR visibility of the new
  `lilnas-icloud-backup` package (T21); whether a task worktree `HEAD` is the run branch tip
  (push tasks check the diff instead).
- Leftovers a cancelled run can leave: dry-run stack (`lilnas-icloud-backup-dev*` containers,
  `/storage/app-data/icloud-backup-dev`, `/storage/photos/icloud-users/dev-*`, an Immich
  `+icloud-backup-dev` user and library) between T18 and T19; Immich stopped and folders moved
  between H8 and T24 (undo sheet is in T23's result, backup under `/storage/backups/immich-db/`).
- Jeremy's reply style: answer first, tables and bullets, at most two paragraphs of prose.
- No open thread with the user.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report,
     the rollout record. Humans may add notes here too. -->

### 2026-11-19 · T1 · done
Host dir /storage/photos/icloud-users created as uid 1000 (stat: 1000:1001 755).
infra/immich.yml: added `- /storage/photos/icloud-users:/icloud-users:ro` after the icloud-mom line; nothing else touched.
Detect JSON (--base HEAD~1 --head HEAD):
{"full":false,"baseImages":false,"images":[],"pull":[],"up":["immich","immich-database","immich-machine-learning","immich-redis"],"forceRecreate":["auth"],"decrypt":false,"decryptServices":[],"checkPackages":[],"changedFiles":["infra/immich.yml"]}
images/pull empty and up only holds services defined in infra/immich.yml, as required. forceRecreate contains "auth": apps/auth/deploy.yml:83 bind-mounts ../../infra/immich.yml (all infra/*.yml files are mounted individually), so detect force-recreates auth on any infra/*.yml change. Expected side effect of the existing auth design; not caused by anything extra here.
Plan checks not run: the change is a single compose line, no apps/icloud-backup/package.json exists yet; prettier -c on infra/immich.yml fails at base and was left alone per the task.
No containers, networks, volumes, images or temp files created.

### 2026-11-19 · H3 · approved
Approved.

### 2026-11-19 · H1 · approved
Approved.

### 2026-11-19 · T2 · done
Pushed b5c1c2cb8e82ea9b2a8ab970fd4cee79b01d2931 to main (658ee5d5..b5c1c2cb). Rollback sha: 658ee5d58fc83e6b3d7102a8b3da0ebcfb002ef2 (human revert on main; not done).
CI run: https://github.com/codemonkey800/lilnas/actions/runs/44658108633 (green; deploy job 43s).
Pre-push: origin/main ancestor of HEAD; diff touched only docs/plans/019-* and infra/immich.yml; immich.yml diff was exactly the one icloud-users :ro line; /storage/photos/icloud-users exists, uid:gid 1000:1001; ci detect full:false, images [], pull [], up [immich, immich-database, immich-machine-learning, immich-redis], forceRecreate ["auth"].
Post-deploy: lilnas-immich-1 recreated (started 2026-11-20T02:04:47Z), healthy; mounts include /storage/photos/icloud-users -> /icloud-users rw=false plus icloud, icloud-mom, google-photos, home-movies (all rw=false) and upload (rw=true); immich ping 200; no mount/library errors in 10m of logs (only a benign path-to-regexp WARN); lilnas-auth-1 recreated, running (healthy); auth /login 200.
Nothing created, so nothing to clean up; worktree clean.

No commits: nothing to integrate.

### 2026-11-19 · T3 · done
Page paths (all under docs/features/icloud-backup/designs/): index.html, start.html, backup.html, admin.html. Each at 1280 and 390 behind the viewport switch, every state captioned.
Frontend task hints: doorplate is +doorplate('icloud-backup') (renders icloud-backup.lilnas.io). Family screens use a 560px column; admin uses the kit app bar with links "My backup" and "Backups", compact density at desktop, comfortable on phone.
Backup states by key: queued, preparing (attempt 2 of 6, retry in 2 minutes), downloading, reconnecting (warn banner under app bar), review, review-large (accent moves to "Not now"), finishing, done-new, done-revealed, done-existing, reauth, paused, failed-refused/timeout/generic (one screen with a reason note slot). Anchors: start.html#preflight is the pre-flight frame.
Deliberate choices: sign-in split into three screens with a "Step n of 3" marker; Remove on an admin preset has no confirm dialog (re-adding is one form away); code cells show bullets, never digits; all sample emails are example.com / example.invalid; the temporary password is a made-up phrase.
Checks: pnpm mockups and mockups:lint clean; utils/ui build; apps/auth services jest 87/87; compose prettier ok. apps/icloud-backup does not exist yet, so its lint/type-check/jest/Docker checks were skipped by their own guards. No containers or networks were created; temp screenshots in /tmp were deleted.
