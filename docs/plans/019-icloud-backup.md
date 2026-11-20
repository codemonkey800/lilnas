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
- **A moved-in library needs no special handling in the app** (Jeremy, 2026-11-19: "it should
  just be seamless"). The folder is named after the person's lilnas email, the Immich user that
  owns the library has that same email, so the normal first backup finds both and icloudpd skips
  what is there. Ruled out: the admin preset form and the count-then-ask step before the first
  download, both removed from the mockups and the contract. The guard that remains is manual:
  at H9 Jeremy watches "size so far" on his first sync and stops it if it grows.
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
- **Adoption logic removed 2026-11-19 (Jeremy's request).** Presets, `adopted`,
  `previewing`/`review_download` and `--only-print-filenames` were cut from T5, T6, T9, T10, T11,
  T13, T14 and H9. T26 strips them from the mockups (H2 is `after` it; do not approve H2 before
  T26 lands) and T27 from `contract.ts`. Matching is by email only: Immich owners of the two
  libraries are the two people's Gmail addresses (read from the database), folder = local part,
  so `ensure` finds the user and the library whose import path is `<root>/<slug>`. T7 gained
  `import_path_taken` so a mismatch fails instead of making a second library. Old scripts used
  default icloudpd flags and `TZ=America/Los_Angeles`, same as the app, so names should match;
  the remaining risk is a naming change between icloudpd versions, watched by hand at H9.
- **C2 / R1 (2026-11-19):** Immich's `POST /libraries/:id/validate` needs an `all` key. Decided
  without asking: the key stays at seven permissions and `ensure()` drops the validate call. R1
  was already running with both options open, so T28 (after T8 and T17) makes code, contract
  script and README match whatever R1 did. T24 no longer calls validate either.
- **C3 (T16, 2026-11-19):** icloudpd's form (8080) is reachable from other containers on the
  compose network; all three services sit on the default network because the backend needs
  `immich`. R2 firewalls 8080 to loopback in a root entrypoint (`NET_ADMIN`, then `setpriv` to
  uid 1000 with no caps), fail closed, and re-checks live. Ruled out: a private network (backend
  still needs Immich's), a sidecar sharing the netns (rules lost on `docker restart`), installing
  icloudpd from PyPI and patching `waitress.serve` (leaves the pinned static binary). Note the
  backend API on 8081 trusts forwarded identity headers from the same network, so this is defence
  in depth, not a new boundary. The runner made R2 for the same defect and had started it with
  an open-ended body, so the run was paused with interrupt, T29's design moved into R2, T29
  deleted before the runner saw it, and T16's re-check now expects the form to be unreachable.
- A run in `waiting_for_human` does not pick up new tasks by itself: `pause` then `resume`
  made it dispatch T26 and T27.
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
- **T25 (added 2026-11-19, Jeremy's request):** T3's mockups had no Nexus frame markup, so
  review mode showed each page as one frame. Nexus frames are the direct `section.sec` children
  of the first `.page` (title from `h2.sec-title`); no lilnas mockup had them. Jeremy chose one
  frame per state with 1280 and 390 side by side, no viewport switch. T25 adds `mockFrame` to
  the kit and rebuilds the three pages; H2 is now `after` T3 and T25. H2's checkpoint was
  already open when T25 was added: it must not be approved before T25 lands.
- **Run config shows `modelId: sonnet`** (2026-11-19) although the frontmatter says
  `model: frontier`; Jeremy has been told.
- **H4 finding, 2026-11-20: icloudpd 1.33.1 is refused by Apple (`-20101`) for Jeremy's
  valid password.** Proven by hand: 1.33.1 in the app image with a TTY → `-20101`; same
  password at icloud.com → OK + 2FA; `icloudpd/icloudpd:latest` (1.32.3, built 2026-05-30) →
  OK + 2FA. The app relayed and judged correctly (verdict came from the form returning to the
  password step). A real wrong password on both versions: process stays up, form returns with
  the Apple error in `div.fw-bold`. icloudpd output is never logged by the app, so diagnosis
  needs a hand run (`docker run -it --rm --entrypoint sh lilnas-icloud-backup:dev`).
  Fix: T30 pins 1.32.3 (sha256 `cbe4de08…0093`), T31 rebuilds the dry-run stack, H4 is now
  `after` T31. Do not approve H4 before T31. Apple sign-in attempts that day: 7 refused + 1
  accepted; avoid extra attempts (lockout risk). Not done: filing an upstream issue (would
  need Jeremy's OK; outward-facing).
- **Correction, same night: the glibc build is the problem, not the version.** T30/T31 put
  1.32.3 glibc (`linux-amd64`) in the app; it still got `-20101` via the app (×3, also with
  stale cookie files moved to `/storage/app-data/icloud-backup-dev/cookies-stale-20261120/`),
  via the web form by hand (password length 32, matches the app's 47-byte JSON body) and via
  the hidden prompt. `icloudpd/icloudpd:latest` = 1.32.3 `linux-musl-amd64` (sha256
  `acbe7149…6fd6`, byte-identical to the release asset) succeeded twice. Same Python source;
  the web form passes the password untouched. musl binary needs musl loader + musl libz;
  Debian's `musl` package alone fails on libz; copying both from the pinned official image
  into `/opt/musl/lib` works as uid 1000 (proved). T32 switches the image to it, T33 rebuilds
  the dry-run stack and clears cookies; H4 is `after` T33. Apple attempts that night: ~13,
  2 accepted. Not known: whether 1.33.1 musl works (not tried).
- Open thread: Jeremy is waiting for T32/T33, then redoes H4.
- **H4 progress, 2026-11-20:** musl icloudpd signed in, code accepted, 36 items (721.6 MB)
  downloaded. First provisioning failed: the H3 key lacked `library.create` (Jeremy added it).
  The retry then marked the Immich user "not created by us", so no password reset. Planner set
  `immich_created_by_us = true` on the dev DB row by hand. T34 fixes the bug (H5 is `after`
  it). T20 now checks the key's seven permissions. The dev Immich user
  `+icloud-backup-dev` and its library (36 assets) exist and are left for T19 to report.

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

### 2026-11-19 · T4 · done
Scaffold is in final shape: app.module.ts imports every module; db, icloudpd, immich, jobs, api and admin modules are empty @Module({}) classes for their owners to fill. src/db/schema.ts does not exist yet (drizzle.config.ts points at it); src/db/migrations holds only .gitkeep.
Auth: ForwardedUserGuard is global (APP_GUARD in AuthModule). Mark a route @Public() to exempt it; only HealthController is. AuthModule exports AdminCheckService and AdminGuard, so a module using @UseGuards(AdminGuard) must import AuthModule. For the WebSocket handshake, call resolveForwardedUser({ headers: req.headers }) directly; the global guard only handles HTTP requests.
Specs for the guards share src/auth/__tests__/helpers/identity.ts (setEnv, fakeContext, USER_HEADERS). Jest's testMatch excludes __tests__/helpers/, so put shared test helpers there.
Contract: PresetBody.folder is validated as a single path segment (no separators, not . or ..). StartBackupBody.appleId is trimmed, lower-cased and must be an email. Password is not trimmed. Code is exactly 6 digits.
Logging: pinoHttpOptions in src/logger.config.ts redacts req.headers.cookie, req.headers.authorization, res.headers["set-cookie"], req.body, and password/code/apiKey up to 4 levels deep. /health is excluded from autoLogging. Log secrets only via those key names or they will not be redacted.
next.config.js exports DEV_BACKEND_ORIGIN and PROD_BACKEND_ORIGIN (http://localhost:8081 under PHASE_DEVELOPMENT_SERVER, else http://icloud-backup:8081); rewrites /api/:path* to <backend>/:path* and /ws to <backend>/ws. deploy.yml must name the backend service `icloud-backup`, because the origin is baked into the routes manifest at build time.
The runtime image is Debian slim (apt-get); icloudpd 1.33.1 is installed at /usr/local/bin/icloudpd and verified at build time. Dockerfile default ENTRYPOINT runs both processes (pnpm start); deploy.yml should override the entrypoint per service (backend: node dist/main; frontend: node frontend/apps/icloud-backup/server.js).
pnpm-lock.yaml changed: new importer plus the drizzle-orm peer-variant suffix now including @electric-sql/pglite@0.5.17 for the existing auth, download and tdr-bot importers (suffix only, no new deps for them).
next build in this environment fails intermittently with a SecurityFatalError about Next 16.4.2 (it appeared to alternate between failing and passing). The failure is raised by a registry advisory check, not by this app's code. A plain retry passed in a standalone run and the docker build passed first try. apps/dev has the same Next version. I did not run `next upgrade`.

### 2026-11-19 · T25 · done
Each page (start 10, backup 15, admin 8) has one direct section.sec child per state of .page, id = the state key, title = the state label, num = 01.., caption = the state caption. Each frame holds a flex-wrap row with the 1280 screen and the 390 screen, each with a +frameLabel. Column is max-w-[1760px] (1712px content, 1702px used).
index.html changed only in its inlined shared CSS (the viewport-switch utilities are no longer used by any page); it has no frames.
Admin's cover paragraph had no "Every state is shown at 1280 and 390" sentence, so the new "Each state is a frame showing 1280 and 390 side by side." was appended after the Remove sentence.
The vp-scope / viewportToggle / viewportPanel mixins and their CSS in the kit were left alone (other features may use them); only the three icloud-backup pages stopped using them.
Verification: Chromium at 1800px, no overflow, frames top-aligned and side by side; whitespace-normalised outerHTML of every [data-density] screen equals HEAD's desktop/mobile panel screens for all 33 states. Pixel screenshots of 6 compared states (2 per page) differ only by sub-pixel noise (max channel delta 2 on static screens, 1px height rounding); temp files deleted.
Checks: mockups build + lint clean, utils/ui build ok, apps/auth services jest 87/87, prettier ok on READMEs and compose files; apps/icloud-backup does not exist yet so its guarded checks were skipped.

### 2026-11-19 · T27 · done
Removed from the contract: states previewing and review_download (BACKUP_STATES now has 14 entries, nothing else renamed or reordered), JobView.previewItems, BackupAccountView.adopted, AdminPreset, AdminLibraryOption, PresetBody and their schemas. The private folderName helper went too, since only PresetBodySchema used it.
Nothing else under apps/icloud-backup/src used the removed names; README.md did not mention them.
Spec has a new case that BackupStateSchema and JobViewSchema reject previewing and review_download.
Checks run: icloud-backup lint, type-check, full jest (8 suites, 54 tests) all pass. Not run: the auth jest, mockups and prettier/docker checks (untouched by this change).

### 2026-11-19 · T26 · done
Built-HTML verification, direct section.sec children of .page = states in data:
start 10/10, backup 13/13 (was 15), admin 4/4 (was 8).
Frame titles in order:
start: Pre-flight; Sign in · Empty; Sign in · Submitting; Sign in · Wrong password; Sign in · Server low on space; Waiting for a turn; Code · Empty; Code · Checking; Code · Wrong code; Signed in.
backup: Queued; Apple preparing; Downloading; Reconnecting; Finishing; Done · New Immich account; Done · Password shown; Done · Had an Immich account; Sign in again; Paused; Failed · Apple refused; Failed · Sign-in timed out; Failed · Something went wrong.
admin: Rows; Table · Empty; Table · Loading; Table · Error.
Admin: the four frames that showed only the libraries section (libs-empty, form-errors, form-taken, form-select) were removed because nothing is left in them. The Rows frame's caption no longer says "libraries below". The `full`, `libs` and `formState` frame fields and the presetList, presetForm and adminLibraries mixins are gone.
Backup: the review/review-large states, the `review` data export and its dispatcher branch are removed. The cover paragraph no longer lists Download as an accent button. "Checking which photos are already here" was not present in the queued screen's data or the built HTML, so nothing to remove there.
done-existing is unchanged. start.html and index.html changed only in inlined shared CSS (utilities the cut sections used are no longer emitted).
grep -rniE 'preset|review|adopt|already here' docs/features/icloud-backup/designs/src returns nothing (exit 1).
Browser check (headless Chrome, 1800 px wide): no horizontal overflow on backup or admin, every frame shows 1280 and 390 side by side at the same top offset, remaining frames look as before, admin ends right after the Error frame with no gap. Screenshots and temp files deleted.
Checks: mockups build + lint clean; utils/ui build ok; icloud-backup lint + type-check pass; icloud-backup jest 59/59; apps/auth services jest 87/87; docker build --check on apps/icloud-backup/Dockerfile: no warnings; prettier ok on README and compose files. git status clean.
Not mine: /tmp/gen_t26.py, /tmp/t26_before.txt and /tmp/t26_full.txt already existed and were left alone.

### 2026-11-19 · H2 · approved
Approved.

### 2026-11-20 · Phase 1 · review cycle 1
Pass 1 (T1): T1 adds exactly the one read-only Immich volume line the task asked for, after the icloud-mom line, with no other edits; the host folder exists owned by uid 1000, mode 755. No defects found.
Pass 2 (T3): T3 adds static icloud-backup mockups (README, data .mjs, Pug mixins/pages, generated HTML). Every state the task body lists is present at both widths, no behavioural JS, all sample emails on example.com/example.invalid; no defects found. Generated *.html (admin, backup, index, start) were checked by targeted greps (ids, anchors, scripts, emails), not read line by line.
Pass 3 (T4): T4's scaffold matches the task body: the package, the Nest skeleton with every listed module, forwarded-user auth with a dev fallback limited to non-production, the full zod wire contract, the Next config choosing the backend origin by phase, the fetch script with sha256 check, and the Dockerfile with icloudpd guards. Every required spec is present. No P0/P1 defects. One plan-mandated P2 note: the logger censors error codes.
Pass 4 (T25): T25 meets its spec: start, backup and admin each have one direct section.sec frame per state (10, 15 and 8) under the only .page element, the ids are kept, the screens are unchanged apart from whitespace next to tags, and there is no script or switch markup. The only issue is that index.pug's cover still describes the viewport switch.
Pass 5 (T27): T27 removes the previewing and review_download states, JobView.previewItems, BackupAccountView.adopted, and AdminPreset, AdminLibraryOption and PresetBody along with their schemas, and changes nothing else. No use of any removed name remains under apps/icloud-backup/src or in the README, and the spec has the required rejection case. No defects found.
Pass 6 (T26): T26 removes the review-before-download states and the admin Existing libraries section cleanly from data, mixins, pages, README and the rebuilt HTML; no defects found.
Seams pass: Seams pass: no disagreements found between T1, T3, T25, T26, T27 and T4. The Immich mount target matches the scaffold's IMMICH_IMPORT_ROOT default, the mockups use the kit's new mockFrame mixin as defined, T27's removed states are gone from both the contract and the mockups, and the scaffold's imports from @lilnas/utils resolve. One gap between the mockup and the contract is recorded as a suspicion.
Consolidation: Consolidated 7 passes over T1, T3, T4, T25, T26, T27 and seams: two distinct P2 notes (logger redacts err.code; index cover still describes the removed viewport switch), no P0/P1 findings, and two suspicions (global guard on WS handlers; contract cannot track whether the temporary Immich password was issued).

Notes:
- F1 · P2 · plan-mandated · Redacting every `code` key also hides err.code in error logs — apps/icloud-backup/src/logger.config.ts
- F2 · P2 · Index cover still describes the viewport switch — docs/features/icloud-backup/designs/src/pages/index.pug:8

Suspicions:
- Global ForwardedUserGuard assumes an HTTP context — apps/icloud-backup/src/auth/forwarded-user.guard.ts · It is registered with APP_GUARD, and Nest's GuardsContextCreator also applies global request guards to gateway @SubscribeMessage handlers; there switchToHttp().getRequest() returns the ws client, req.headers is undefined, and getForwardedUser throws a TypeError. The contract has no client-to-server messages today, so nothing reaches this yet (same pattern as apps/download). · confirm by: Add a @SubscribeMessage handler in a test gateway and send a message; or have the guard return true when context.getType() !== 'http'.
- Contract cannot tell whether the temporary Immich password was already created — apps/icloud-backup/src/shared/contract.ts:86 · backup.mjs has a 'done-new' frame with a 'Create a temporary password' button and a 'done-revealed' frame shown only once, but BackupAccountViewSchema.immich only carries {email, createdByUs, url}, so after a reload the frontend cannot know whether to show the button again; the contract also has no request schema for creating the password. · confirm by: Check whether a later task in the plan adds a field such as passwordIssued and an endpoint for the temporary password; if none does, the mockup and the contract disagree.

Spec check:
- extra: Redact in the pino config: req.headers.cookie, req.headers.authorization, req.body, and any key named password, code, apiKey (apps/icloud-backup/src/logger.config.ts) — Also redacts res.headers["set-cookie"] and skips autoLogging for /health; both harmless.
- extra: src/auth/: copy the idea of forwarded-user.ts, guard, decorator, admin-check, admin.guard (apps/icloud-backup/src/auth/public.decorator.ts) — Adds an @Public() decorator so /health can opt out of the global guard.
- unverifiable: Verify: pnpm lilnas ci detect ... lists no image, pull empty, and up holding only services defined in infra/immich.yml (infra/immich.yml) — Detect JSON comes from the T1 task note; not re-run, but consistent with a one-line change.
- unverifiable: Mockup changes are committed with their rebuilt *.html (pnpm mockups leaves git status clean) (docs/features/icloud-backup/designs/) — Checks show build and lint passed but not git status afterwards; confirm on the merged branch.
- unverifiable: docker build succeeds; icloudpd --version prints 1.33.1; id shows uid 1000; image removed afterwards (apps/icloud-backup/Dockerfile) — Only claimed in task notes; checks ran only docker build --check.
- unverifiable: deploy.yml overrides the entrypoint per service and names the backend `icloud-backup` (apps/icloud-backup/deploy.yml) — Belongs to a later task; the baked origin http://icloud-backup:8081 depends on it.
- unverifiable: Open built pages at a 1800 px wide window; frames sit side by side without overflow, remaining frames look as before and admin has no empty gap (docs/features/icloud-backup/designs/*.html) — T25/T26 rendering only claimed in task notes; a person should look during the H review.
- unverifiable: Wire types live in apps/icloud-backup/src/shared/contract.ts; change them only in the task that owns that file (apps/icloud-backup/src/shared/contract.ts) — Both T4 and T27 touch the contract; final state is consistent but commit ownership was not visible to the seams pass.

Declined to judge:
- infra/immich.yml fails prettier -c, and forceRecreate in the T1 detect JSON contains auth — Prettier failed at base too and the task says to keep the file's style; auth recreate comes from the existing apps/auth bind-mount of infra/*.yml, and the verify condition still holds.
- Preset/preview/review_download states, PresetBody/AdminPreset/AdminLibraryOption, the admin Existing libraries section, and the removal of the private folderName helper with its path-traversal tests — T3/T4 asked for them and T26/T27 removed them; folderName was used only by PresetBodySchema and no other schema takes a folder name.
- Generated mockup HTML: no line-by-line read of ~20k lines, changed whitespace next to tags, leftover .vp-scope/.vp-radio CSS, @property reordering and unused-utility churn — Build output of the reviewed Pug, checked by grep and structural comparison instead; the kit theme.css was to stay unchanged; with whitespace removed every screen matches base.
- Mockup copy/visual nits: copy inline in Pug instead of data .mjs, select without an error border in the validation state, AdminAccountRow.folder not shown in the admin table — Static mockup details for the human review at the H task; leaving data out is not a contradiction.
- jest.config.js comments copied from another app, and the health spec listening on 127.0.0.1:0 — Stale comments are style; loopback is not a network dependency in the Done-means sense.
- Extra lockfile snapshot @lilnas/utils@file:packages/utils(... supports-color@5.5.0) — Generated by pnpm for an injected peer variant; install and build pass.
- AdminAccountRowSchema has no spec coverage — It had none at base either; T27 did not add or change it.
- ICLOUDPD_WEBUI_URL defaults to 127.0.0.1:8080, the same port as the Next dev server in the single dev container — Raised by the seams pass as T4-only, not a seam; no slice pass reported it as a defect.

Checked:
- Immich host folder missing or root-owned, or new container path overlapping existing mounts — /storage/photos/icloud-users, infra/immich.yml:17-19: Exists 1000:1001 755 like icloud-mom; /icloud-users is separate from /icloud and /icloud-mom.
- Immich mount target vs scaffold IMMICH_IMPORT_ROOT — infra/immich.yml, apps/icloud-backup/src/env.ts, .env.example: Both use /icloud-users read-only; they agree.
- Behavioural JS or real addresses/secrets in mockups — docs/features/icloud-backup/designs/*.html and data: No script tags or handlers; only example.com/example.invalid addresses and made-up passwords.
- Generated HTML out of sync with Pug, or broken start.html#preflight deep link — admin/backup/start.html, data/*.mjs, pages/start.pug: Every state key appears once as a section id; id=preflight exists; no other cross-page anchors.
- Nexus frame detection and section counts after T25/T26 — built start/backup/admin.html: One .page element with direct section.sec children; final counts start 10, backup 13, admin 4, matching state counts.
- mockFrame mixin signature vs page calls, and side-by-side fit — docs/designs/mockup-kit/mock.pug, designs/src/pages/*.pug: All pages call mockFrame(id, title, {num, caption}); 1280+32+390 fits the 1712px column with flex-wrap.
- adminScreen calling +adminTop unconditionally after T26 — designs/src/data/admin.mjs: All four remaining frames set top.
- Leftover uses of removed preview/preset names — apps/icloud-backup/src, README, designs src and built HTML: Only contract.spec.ts mentions previewing/review_download, asserting rejection; BACKUP_STATES has 14 entries; TERMINAL_STATES unchanged; ServerMessage still only 'backup'.
- Dev identity fallback reaching production — apps/icloud-backup/src/auth/forwarded-user.ts: Requires NODE_ENV !== production and both DEV_USER_* set; specs cover all combinations.
- Secret redaction depth and keys — apps/icloud-backup/src/logger.config.ts: Covers password/code/apiKey at depths 0-3 plus cookie, authorization, set-cookie and req.body; spec asserts no secret appears.
- next.config.js origin vs Dockerfile guard and builder migrations path — apps/icloud-backup/next.config.js, Dockerfile, infra/base-images/lilnas-monorepo-builder.Dockerfile: Both use http://icloud-backup:8081; WORKDIR /source makes the migrations copy path correct.
- Lockfile changes to other importers and @lilnas/utils imports — pnpm-lock.yaml, packages/utils/src/auth: Only a drizzle-orm peer suffix change for auth/download/tdr-bot; AuthClient.dockerInstance, checkIsAdmin and auth/types exist.

### 2026-11-20 · Phase 1 · review cycle 1
Pass 1 (T1): T1 adds the single read-only mount `/storage/photos/icloud-users:/icloud-users:ro` to the immich service in the file's existing style, and the host folder exists as uid 1000 with mode 755. No defects found.
Pass 2 (T3): T3 adds static icloud-backup mockups (Pug + data + generated HTML). Every state T3 asks for is present in the source; no defects found. Coverage is partial because the four generated HTML files (~19k lines, mostly inlined kit CSS) were scanned with targeted greps rather than read line by line.
Pass 3 (T4): T4 scaffold matches the task: package, configs, Nest skeleton with the global forwarded-user guard, wire contract, pino redaction, fetch script and Dockerfile, with every required spec present and passing. No P0/P1 defects; two P2 notes (global guard runs on future WebSocket message handlers and crashes; `code` redaction also hides error codes).
Pass 4 (T25): T25 builds what the task asked for: one review frame per state on each page (start 10, backup 15, admin 8), and each frame shows the 1280 and 390 screens side by side with their labels. Ids, titles and numbers match the data, no switch markup or script is left, and only icloud-backup files and the two kit files changed. Coverage is partial because the four large generated-HTML hunks were checked by parsing the built files at 869f27d75edc rather than read line by line.
Pass 5 (T27): T27 removes the preview states, previewItems, adopted and the preset/library-option schemas exactly as asked, with no leftover references in apps/icloud-backup and a new rejection test for the removed states. No defects found.
Pass 6 (T26): T26 removes the review/review-large backup states and the admin Existing libraries section cleanly from data, mixins, pages, README and rebuilt HTML; no defects found.
Seams pass: Seams pass over the export-level diff found no disagreements between tasks. T27's contract, T26's cut-down mockups, T4's scaffold (env keys, auth, config) and T1's Immich mount agree on state names, paths and identifiers.
Consolidation: Seven passes over Phase 1 (Immich mount, mockups, scaffold, contract cut-down) found no P0/P1 defects. Three distinct P2 notes remain: the global guard on WebSocket handlers, the over-broad `code` log redaction, and the index page text that still describes the removed viewport switch.

Notes:
- F3 · P2 · Global ForwardedUserGuard throws on WebSocket message handlers — apps/icloud-backup/src/auth/forwarded-user.guard.ts:27
- F4 · P2 · plan-mandated · Redacting every `code` key also blanks error codes — apps/icloud-backup/src/logger.config.ts:11
- F5 · P2 · Index page text still describes the removed viewport switch — docs/features/icloud-backup/designs/src/pages/index.pug:8

Suspicions:
- icloudpd web UI default port matches the Next port in the single-container dev setup — apps/icloud-backup/src/env.ts:12 · ICLOUDPD_WEBUI_URL defaults to http://127.0.0.1:8080, and `next dev -p 8080`, the image's default `pnpm start` and FRONTEND_PORT all put the frontend on 8080. next.config.js says the backend and frontend run in one dev container, so both would want loopback 8080 there. Production splits the containers, so there is no clash in prod. · confirm by: Check whether icloudpd 1.33.1's web UI port can be configured, and read deploy.dev.yml / the dev command once the icloudpd runner exists to confirm the web UI binds to a different port in dev.
- Mockup 'Done · Password shown' has no contract shape — apps/icloud-backup/src/shared/contract.ts · backup.mjs (T3/T26) shows a 'Create a temporary password' action that reveals a password once. The contract (T27) has `immich.createdByUs` but no request or response schema for making that password, so the screen cannot yet be built from the contract. · confirm by: Check that a later task owning contract.ts adds a temporary-password endpoint schema before the backup page is built.

Spec check:
- missing: Also `.env.example` (every key above, no values that are secrets) (apps/icloud-backup/.env.example) — NODE_ENV is not listed; every other key is.
- extra: Redact in the pino config: req.headers.cookie, req.headers.authorization, req.body, and any key named password, code, apiKey (apps/icloud-backup/src/logger.config.ts) — Also redacts res.headers["set-cookie"] and skips /health in autoLogging; harmless.
- unverifiable: Verify: pnpm lilnas ci detect ... lists no image, pull empty, and up holding only services defined in infra/immich.yml (T1 task notes) — The JSON in the notes matches; detect was not re-run.
- unverifiable: docker build succeeds; icloudpd --version prints 1.33.1; id shows uid 1000; image removed afterwards (apps/icloud-backup/Dockerfile) — Only `docker build --check` is in the check results; a person should confirm the full build and the image cleanup.
- unverifiable: Mockup changes are committed with their rebuilt *.html (pnpm mockups leaves git status clean) (docs/features/icloud-backup/designs/*.html) — The check runs pnpm mockups but does not assert git status is clean afterwards.
- unverifiable: On the phone it becomes a list (docs/features/icloud-backup/designs/src/mixins/admin.pug) — Depends on the shared kit's dataList mobile rendering; check visually at the H task.
- unverifiable: Confirm the two screens of a frame sit side by side without overflow or clipping, every screen looks as before, and the admin page has no empty gap at 1800 px (built start/backup/admin.html) — The task notes claim headless screenshot comparisons passed; a person should look at the rendered pages at the H review.
- unverifiable: icloud-backup-frontend in apps/icloud-backup/deploy.yml has no env_file, no volumes and no secret in environment (apps/icloud-backup/deploy.yml) — No deploy.yml is in this phase; a person should confirm that a later phase adds it and meets this.

Declined to judge:
- forceRecreate of auth in the T1 detect JSON — Pre-existing: apps/auth/deploy.yml:83 bind-mounts infra/immich.yml, so any change to that file recreates auth. The task's verify criteria still hold.
- infra/immich.yml failing prettier -c — It fails at base too, and the task said to keep the file's style.
- Mockup markup semantics: buttons nested inside <a>, an <a> with no href around Try again, <dd> before <dt> in review counts — Static mockups with no behaviour; a person reviews them at the H task. The frontend should not copy the a>button nesting.
- Inlined kit CSS in the generated pages (hex colours, leftover vp-scope/vp-radio rules, new Tailwind @property blocks) — Generated from the shared kit theme, which the task said to leave unchanged; mockups:lint passed and no markup uses the leftover rules.
- Line-by-line reading and visual judgement of the generated admin/backup/index/start.html — Build output, checked by parsing and targeted greps instead; a person reviews the visuals at the H task.
- pnpm-lock.yaml peer-suffix churn for auth, download and tdr-bot — Only the drizzle-orm peer variant changes (adds pglite); no new deps, and their checks pass.
- AdminCheckService logs the email on an auth outage — An email is not a listed secret; apps/download does the same.
- AdminAccountRowSchema has no spec case — Pre-existing gap that T27 did not touch.

Checked:
- Host folder missing or root-owned before deploy — /storage/photos/icloud-users: stat shows 1000:1001 755.
- Auth reading infra/immich.yml affected by the new volume — apps/auth/deploy.yml:83, apps/auth/src: Auth mounts the file only to find hosts and routes, and a volume line does not change labels. The auth specs pass.
- Global guards reach WebSocket handlers — node_modules/@nestjs/websockets/socket-module.js:88: GuardsContextCreator gets the app config, so APP_GUARD runs on @SubscribeMessage (P2 finding).
- Logs leak passwords, codes, cookies or API keys — apps/icloud-backup/src/logger.config.ts, src/__tests__/logger.config.spec.ts: A real pino-http spec shows the cookie, authorization header, body, password, code and nested apiKey all redacted.
- Production picks up the dev identity fallback — apps/icloud-backup/src/auth/forwarded-user.ts: With NODE_ENV=production it returns undefined before reading DEV_USER_*; this is tested.
- Frame counts, ids and numbering match each page's data after T25/T26 — docs/features/icloud-backup/designs/{start,backup,admin}.html: Frames, numbering and ids match the state keys; after T26, backup has 13 frames (01-13) and admin has 4 (01-04).
- Behavioural JS or leftover viewport-switch markup in the mockups — docs/features/icloud-backup/designs/*.html: No <script>, onclick, javascript:, vp-radio or data-viewport-panel elements.
- Cross-page anchor start.html#preflight broken — start.html / backup.html: id=preflight is on the first start frame and the links point to it.
- Leftover references to states, schemas and data removed by T26/T27 — apps/icloud-backup, docs/features/icloud-backup/designs/src: Only contract.spec.ts mentions 'previewing'/'review_download', and only to assert they are rejected; the mockup pages and mixins have no dangling references.
- Mockup states that have no contract state — designs/src/data/backup.mjs, start.mjs vs shared/contract.ts: Every mockup state maps to a contract state or field.
- Immich mount path vs IMMICH_IMPORT_ROOT — infra/immich.yml:19, apps/icloud-backup/src/env.ts, .env.example:33: The mount /storage/photos/icloud-users:/icloud-users:ro matches the default /icloud-users.
- Health route path vs log ignore vs Next rewrite — health.controller.ts, logger.config.ts, next.config.js: The controller serves /health, autoLogging ignores /health, and the rewrite strips /api, so they agree.

### 2026-11-19 · T7 · done
Import from 'src/immich/immich.client', 'src/immich/immich.provisioner', 'src/immich/immich.email' and 'src/immich/immich.errors'. There is no barrel file. A module that needs the provider must import ImmichModule, which exports ImmichClient and ImmichProvisioner.
ImmichModule builds an IMMICH_OPTIONS provider from IMMICH_URL (default http://immich:2283), IMMICH_API_KEY (default '', so the client throws ImmichError('not_configured') on first use rather than failing at boot) and IMMICH_IMPORT_ROOT (default /icloud-users).
ensure({email, slug}) uses the email as given. The caller applies immichEmail(lilnasEmail, IMMICH_EMAIL_PLUS_TAG) first. The new Immich user's display name is that email.
createdByUs is true only if this call created the user. If a crash happens after the user is created but before the caller stores the result, the retry reports createdByUs: false. The caller that persists createdByUs should be aware of that gap, because the spec says ensure must be safe to repeat.
ensure returns email as Immich stores it, which may differ from the input in case.
An Immich failure arrives as ImmichError with code, status (http_error only) and a message that is safe to log or store. Map any ImmichError to the contract's 'immich_error' code, except import_path_taken and import_path_invalid, which a caller may want to show differently.
The shared test stand-in is src/immich/__tests__/helpers/fake-immich.ts (FakeImmich, API_KEY, only()). Other tasks' specs can reuse it. It is excluded from jest's testMatch.
The Jest VM realm makes `err instanceof Error` false for the DOMException from AbortSignal.timeout, so the client detects a timeout by err.name === 'TimeoutError'.

### 2026-11-19 · T5 · done
DbModule is @Global and exports DbService, the DB token (the drizzle database), AccountsRepo, JobsRepo and JobEventsRepo; other modules can inject the repos without importing DbModule.
Repos are constructed as `new XRepo(db)`; tests use `createTestDb()` from src/db/__tests__/helpers/test-db.ts (PGlite plus the real migrations; jest ignores __tests__/helpers).
Repo signatures: AccountsRepo { findByLilnasUserId(id), findById(id), list(), slugExists(slug), create({lilnasUserId, lilnasEmail, slug}), setAppleId(id, appleId), setImmich(id, {userId, libraryId, email, createdByUs}), addTotals(id, items, bytes) }. JobsRepo { create({accountId, kind: 'first_backup'|'sync', state}), findById, findActiveForAccount, findLatestForAccount, findNonTerminal(), update(id, patch), finish(id, state, errorCode?, errorDetail?) }. JobEventsRepo { append(jobId, type, message), tail(jobId, limit) returns the last N oldest-first }.
Unique violations are not translated: jobs.create throws when the account already has a non-terminal job, and accounts.setAppleId throws when another account has that Apple ID. Callers should catch these and map to a 409. accounts.create never throws on a slug collision (it retries with -2, -3, ...) but would throw on a duplicate lilnasUserId.
addTotals adds to the running totals and also stamps lastBackupAt. finish clears retryAt and currentFile and stamps finishedAt; update and finish return Job | null. errorDetail is cut to MAX_ERROR_DETAIL (2000) in update and finish.
bigint columns (totalBytes, downloadedBytes) use mode 'number'. Timestamps are timestamptz mapped to Date.
The caller passes the base slug (slugFromEmail(email, ACCOUNT_SLUG_PREFIX)) to AccountsRepo.create.
The lint rule no-relative-import-paths means all imports inside src/db are written `src/db/...`.
Migrations run in DbService.onModuleInit from <cwd>/src/db/migrations, so the runtime image must ship src/db/migrations and start with cwd at apps/icloud-backup (check the Dockerfile and deploy.yml working dir in the image task).

### 2026-11-19 · T8 · partial
Re-run: pnpm exec tsx --tsconfig apps/icloud-backup/tsconfig.json apps/icloud-backup/scripts/immich-contract/run.ts [--with-all]. It needs docker, ffmpeg and the three images already on the host, and takes about 30 s. The compose file requires ICLOUD_USERS_DIR, which run.ts sets. Exit code is 1 on any failed step.
Without --with-all it fails 3 steps, all from the validate 403 (ensure alice, ensure missing slug, ensure admin email). With --with-all all steps pass.
Observed v3.3.4 status codes: admin-sign-up, auth/login and api-keys return 201. server/ping returns {res:'pong'}. The login response carries shouldChangePassword.
Because ensure() creates the user and library before validating, a failed validate (or an invalid slug) leaves an Immich user and an empty library behind. A retry reuses them, so it is idempotent, but a bad slug still creates accounts. If the fix is (b), checking the folder before creating anything removes that side effect.
Library import validation after the scan: 3 JPEGs were counted in about 3 s.

Defects:

- blocking · Production API key cannot call POST /libraries/:id/validate; ensure() fails for every user · apps/icloud-backup/src/immich/immich.client.ts validateLibrary(); called from immich.provisioner.ts ensure()
  Immich POST /libraries/<id>/validate failed with 403: Missing required permission: all. Cause (immich-server:v3.3.4, dist/controllers/library.controller.js): the route is Authenticated({ admin: true }) with no permission, so no entry in the seven-permission list covers it; only an `all` key passes. The other routes work with the list: GET/POST /libraries, GET /admin/users, POST /admin/users, PUT /admin/users/:id, POST /libraries/:id/scan and GET /libraries/:id/statistics all passed. Fix options: (a) human re-creates the production key with `all`, which makes it a full-admin key; or (b) drop validateLibrary from ensure() and have the backend check that the folder exists and is readable itself, then map a scan or empty result to import_path_invalid. I did not change the client because (b) is a design change and (a) is the human's call on the production key.

### 2026-11-19 · T11 · done
Step components: each is `export const X: ComponentType<StepProps>` in src/components/steps/<name>.tsx (Preflight, SignIn, WaitingTurn, Code, Checking, Queued, Indexing, Downloading, Finishing, Done, SignInAgain, Paused, Failed). StepProps (src/components/steps/types.ts) = { view: BackupView; actions: BackupActions }. Placeholders render `<p data-step="<step_name>">`. A filler task replaces the body and may destructure the props; backup-app.tsx maps StepName -> component in a STEPS record and needs no edit.
Pre-flight -> sign_in is local UI state and backup-app does not hold it. The Preflight component must switch to rendering SignIn itself (import ./sign-in) when Continue is pressed. stepFor returns 'preflight' for no account, no job, and for `cancelled` when account.lastBackupAt is null.
BackupActions: start(appleId), sync(), submitPassword(pw), submitCode(code), cancel() all return Promise<BackupView>, set the view at once and throw ApiError on failure. resetImmichPassword(): Promise<string> returns the new password and does not store it. reload() is also there. Wrong password/code arrives in view.job.authError, not as a thrown error.
API shapes assumed from the plan's T-api task: all POSTs except immich-password return BackupView; immich-password returns { password }. Non-2xx throws ApiError(status, message), where message is Nest's `message` (string or joined list) or the status text; network failure is ApiError(0, ...).
useBackup: loads GET /api/backup, then opens ws(s)://<host>/ws. Reconnect ladder is 1,2,5,10,30,30... s with no jitter and resets on open; every reconnect refetches the view and ignores the result if a newer frame arrived meanwhile. A failed first load sets `error` and opens no socket until reload() succeeds. Later failures keep the last view.
formatBytes uses decimal units (1 GB = 1e9 B) with one decimal from KB up. formatRelative(iso, now = Date.now()) uses Intl.RelativeTimeFormat ('just now' under 45 s, 'yesterday', 'in 2 hours').
usePendingPassword() throws outside PendingPasswordProvider; BackupApp wraps the page in it.
Test helper src/lib/__tests__/helpers/view.ts exports makeView(state, over, lastBackupAt) and makeJob(); jest testMatch skips __tests__/helpers/. In specs that use fake timers, stub fetch with a plain object, since a real Response body hangs.
The Admin link is a `Button render={<Link href="/admin" />}` at the top of the column. The root layout still draws the AppBar; this task did not touch layout.tsx.

### 2026-11-19 · T6 · done
ProcessService.spawnIcloudpd(args, { onLine, killGraceMs? }) reads ICLOUDPD_BIN at call time (default /usr/local/bin/icloudpd), runs with an allowlisted environment (no DB password or Immich key), throws Error('could not start icloudpd at <bin>') if the binary cannot start, and resolves `exited` only after both pipes drain, so every line has reached onLine by then. stop() sends SIGTERM and then SIGKILL after killGraceMs (default 10 s); it is a no-op on a finished child. buildDownloadArgs throws RangeError for a non-positive-integer `recent`; callers read ICLOUDPD_RECENT themselves.
WebuiClient reads ICLOUDPD_WEBUI_URL at call time (default http://127.0.0.1:8080). getStep never throws: network error or 5 s timeout is { step: 'unreachable' }. submitPassword/submitCode re-read the step, return 'wrong_step' without posting if it does not match (including unreachable), 'accepted' on a 2xx POST, 'rejected' on a non-2xx or network error. The password and code are only parameters; the client does not log anything.
Verified live on 1.33.1 (2026-11-19, container as uid 1000, nobody@example.invalid): getStep -> need_password about 3 s after start; SIGTERM ends the process in 58 ms with signal SIGTERM; a download with an empty cookie folder exits 1 with a getpass/EOFError traceback that parses to needs_login. The real password fragment is __tests__/fixtures/password.html. Error fragments (password-error, code-error, no-input-error) are rendered from the v1.33.1 Jinja templates, not seen live.
Gotchas: (1) a missing field makes the server log `cannot find code in request {request.form}` at error level, which would put the secret into icloudpd output; we always post the right field, and jobs should not persist raw output lines. (2) `Processing user: <apple-id>` appears in the output. (3) needs_login can fire on the earlier `getpass.py:150: GetPassWarning` line, before EOFError. (4) The `skipped` wording is unverified and probably debug-level only; the match is loose and covered by specs only. (5) Prettier reformats the HTML fixtures, so password.html is the real fragment normalised for whitespace. (6) icloudpd's `no_input` fragment can carry an error such as "Wrong password for <id>", but the FormStep type has no error field for it, so it is dropped.

### 2026-11-19 · T8 · defects → R1
T8 reported 1 blocking defect at attempt 1, sent to R1; it runs again at round 2 to re-check.

- R1 · Production API key cannot call POST /libraries/:id/validate; ensure() fails for every user (`apps/icloud-backup/src/immich/immich.client.ts validateLibrary(); called from immich.provisioner.ts ensure()`): Immich POST /libraries/<id>/validate failed with 403: Missing required permission: all. Cause (immich-server:v3.3.4, dist/controllers/library.controller.js): the route is Authenticated({ admin: true }) with no permission, so no entry in the seven-permission list covers it; only an `all` key passes. The other routes work with the list: GET/POST /libraries, GET /admin/users, POST /admin/users, PUT /admin/users/:id, POST /libraries/:id/scan and GET /libraries/:id/statistics all passed. Fix options: (a) human re-creates the production key with `all`, which makes it a full-admin key; or (b) drop validateLibrary from ensure() and have the backend check that the folder exists and is readable itself, then map a scan or empty result to import_path_invalid. I did not change the client because (b) is a design change and (a) is the human's call on the production key.

### 2026-11-19 · T15 · done
Compose and registration are done as specified. Deliberate differences and findings:
- Added devDependency yaml ^2.9.1 to apps/icloud-backup/package.json (lockfile +3 lines) because deploy.spec.ts parses compose files and yaml did not resolve in this app.
- `pnpm lilnas secrets verify` discovers env files via `git ls-files`, so a new .env.prod is skipped until it is tracked (I used git add -N before verifying; it is now committed). Verify reports ok for apps/icloud-backup/.env.prod.
- .env.prod values are written by dotenvx set, so they are quoted (KEY="encrypted:..."), unlike some older files; deploy.spec.ts accepts both.
- deploy.dev.yml hardcodes non-secret dev Postgres credentials as literals (icloud_backup / icloud_backup_dev) on the dev db and backend; .env.dev-remote (optional, gitignored) only needs IMMICH_API_KEY. Dev services carry lilnas.idle-reap.enabled=false on all three.
- The deploy.yml header comment deliberately does not name the three dry-run variables, because deploy.spec.ts asserts those names do not appear anywhere in the file.
- Prettier reflowed the healthcheck test lines in deploy.yml/deploy.dev.yml onto multiple lines; apps/auth/deploy*.yml were already failing prettier at base, so only the one mount line was added in their existing style.
- Portal icon for icloud-backup is 'grid'.
- Host prerequisites before first deploy (not done here): copy .env.keys to /opt/lilnas (docs/deploy.md "Add a new env file" step 5), create /storage/app-data/icloud-backup and /storage/app-data/icloud-backup-db with ownership the containers can write (backend runs as the image's user; postgres:18-alpine needs uid 70), and /storage/photos/icloud-users must exist.
- ci detect --base HEAD~1 --head HEAD --json: full=true and image ghcr.io/codemonkey800/lilnas-icloud-backup (apps/icloud-backup/Dockerfile) lists services icloud-backup and icloud-backup-frontend.
- Cleanup: temporary .env.prod.decrypted deleted; no containers, networks, volumes or images created; nothing pushed.

### 2026-11-19 · T12 · done
Screens are function components with StepProps; SignIn also takes an optional `onBack`, which Preflight passes. backup-app.tsx is untouched.
Password flow: SignIn parks the password in the pending-password provider before actions.start, and an effect keyed on job.state === 'need_password' takes and sends it once. It works whether SignIn is the same instance or mounts fresh after queued_login. A failed start clears the held password. After send, the password state is emptied, so it is not in the DOM or any log (specs assert it is absent from every console call).
parts.tsx is shared by the sign-in screens: StepMarker, Intro, LowSpaceNote, CancelButton, useCancel (clears the pending password, then actions.cancel, or a local back action when there is no job), messageOf (ApiError message or a generic line).
Deliberate differences: Preflight has no Cancel. Cancel on the form with no job goes back to the checklist locally. The Apple ID is read-only on a need_password retry as well as when appleIdLocked. Code entry is one real input over six drawn cells, digits only, shown as typed. Sign in is disabled for low space only when it would start a job.
Stay-on-screen behaviour to know about: on a failed submit (ApiError) the sign-in password and the code keep what was typed so the person can resend; they are cleared only after a successful send.
Specs: src/components/__tests__/sign-in-steps.spec.tsx (23 tests). No network, DB, Docker or icloudpd. Full apps/icloud-backup jest 297 passed, apps/auth services 88 passed. No temp files or containers were created.

### 2026-11-19 · T13 · done
Reusable for the sign-in half (T12): StateHead (badge + h1 + lede), useAction (pending/error/run around an API call), errorMessage, PHONE_FULL (full-width 44px on phones), and makeActions in src/lib/__tests__/helpers/actions.ts.
Deliberate differences from the task text: it names `actions.newImmichPassword()` but BackupActions exposes `resetImmichPassword()`, so that is used. The three login failures (wrong_password, login_timeout, interrupted_login) show "Sign in again" (start) instead of the label "Try again", following the mockup. Other codes show "Try again": sync when account.appleIdLocked or account.lastBackupAt is set, else start.
Progress is rounded down and counts skippedItems; the bar has aria-valuenow = percent of 100, indeterminate (no valuenow) while totalItems is null. @lilnas/ui Progress has no warn tone, so the paused bar is accent and the indexing attempt bar is a local bg-warn bar.
Not visually checked in a browser at 1280/390; layout follows the mockup's classes (max-sm: for phone full-width buttons, sm: breakpoints for rows).
Specs: 39 new tests across 5 files; full apps/icloud-backup jest run is 313 passed.

### 2026-11-19 · T14 · done
/admin is src/app/admin/page.tsx rendering the client component AdminPage (src/components/admin-page.tsx). It calls getAdminAccounts() and uses DataList from @lilnas/ui (table from md, cards below) inside Density compact.
STATE_BADGES in src/lib/admin-state.ts maps every BackupState to tone, label and live. Tones: accent for checking_*, downloading and provisioning; ok for done; warn for queued_login, need_password, need_code, queued_download, indexing_wait, needs_login and paused_low_disk; bad for failed. cancelled is mute, which the task did not specify. A row with no job shows a dash. Badges carry data-tone, which the specs read.
Decisions: compact density applies at every width, since Density has no breakpoint option. The empty-state and 403 copy follow the task text, not the mockup's wording ("No backups yet"). The error note shows the ApiError message rather than the mockup's machine string. The link home is a ghost "My backup" button beside Refresh. Refresh keeps the rows on screen while it loads; Try again clears them to the skeleton first.
I did not visually compare the page with the mockup at 1280 and 390, because no browser run was done; the specs are the only verification of rendering.
Checks run: utils and ui build, icloud-backup lint and type-check, full icloud-backup jest (24 suites, 295 tests), auth services jest (88 tests), cli build with mockups and mockups:lint, prettier on the compose files, and docker build --check. All pass, and mockups left git status clean.

### 2026-11-19 · T17 · done
Docs only. README documents the app from the code as it is at this branch (jobs/api/admin modules are still stubs here, so the state diagram follows contract.ts and the plan's flow, and says contract.ts is the authority).
docs/deploy.md: the Secrets text said "15 env files" but listed 14; with apps/icloud-backup/.env.prod added the list has 15 (matches `scripts/deploy/decrypt-env.sh --list`), so the number is unchanged and now correct.
README includes a caveat about R1 (Immich POST /libraries/:id/validate needs the `all` permission on v3.3.4; provisioner still calls it, immich.provisioner.ts ensure()). If R1 is fixed by dropping validateLibrary (option b), delete that paragraph from the README "Immich API key" section.
All five plan checks pass; prettier -c passes on the three touched files. Nothing pushed; no containers, networks, volumes, images or temp files left.

### 2026-11-19 · R1 · done
Chose option (b): ensure() no longer calls POST /libraries/:id/validate, which needs an `all` key. The provisioner checks <photosRoot>/<slug> itself (stat + access R_OK|X_OK) before listing, creating or scanning anything, and throws ImmichError('import_path_invalid') for a missing, non-directory or unreadable folder. The message carries the Immich-side path only. A bad slug now creates no Immich user or library.
ImmichOptions gained a required `photosRoot` (PHOTOS_ROOT, default /photos, which is the backend mount in deploy.yml). Anything else that builds ImmichOptions must supply it. validateLibrary, ValidateLibraryResponseSchema and the fake's validate route are removed.
scripts/immich-contract/run.ts now passes its temp dir as photosRoot, drops the validateLibrary step, and asserts the missing-slug ensure creates no user. It needs no `all` key: every step should pass without --with-all. I did not re-run it live; T8 should re-run: pnpm exec tsx --tsconfig apps/icloud-backup/tsconfig.json apps/icloud-backup/scripts/immich-contract/run.ts
Not verified: the new missing-folder spec was not run against the pre-fix code. Nothing in src creates <PHOTOS_ROOT>/<slug>, so whichever caller runs ensure() must make sure the folder exists first (the old validate call also required it to exist).
All plan checks pass: lint, type-check, auth service specs 88/88, icloud-backup jest 336/336, prettier, docker build --check, mockups and mockups:lint. Tree is clean.

### 2026-11-19 · T8 · done
Round 2 re-run of apps/icloud-backup/scripts/immich-contract/run.ts against a throwaway immich-server v3.3.4, with the key limited to the 7 listed permissions (no `all`). ALL STEPS PASSED. The earlier defect (403 "Missing required permission: all" on POST /libraries/:id/validate) no longer reproduces: R1 removed that call and ensure() now checks <photosRoot>/<slug> locally.
Observed: pong after 6 s; ensure(alice) created a user and a library (createdByUs true, importPath /icloud-users/alice); second ensure created nothing (2 users, 1 library); statistics reached 3 assets after 3 s; scan, statistics and PUT /admin/users/:id succeeded on the exact permission list; ensure for slug "missing" threw import_path_invalid and created no user; newTemporaryPassword logged in via POST /api/auth/login (201) with shouldChangePassword true; ensure with the admin's email reused the admin (createdByUs false); the admin email on slug alice threw import_path_taken.
Server was reached at http://192.168.16.4:2283 (container IP), never http://immich:2283.
Deliberate difference from the task text: "the library's import path validates" is now the local folder check in the provisioner, not Immich's validate route, because that route needs an `all` key.
Cleanup shown: the script ran `down -v`; afterwards `docker ps -a`, `docker volume ls` and `docker network ls` have nothing for icloud-backup-immich-test, and /tmp/icloud-users-* is gone.
Checks run: @lilnas/utils and @lilnas/ui build, icloud-backup lint and type-check, prettier on scripts/immich-contract/*. All pass. Jest, auth specs, mockups and docker build --check were not re-run; no files changed since R1 reported them passing.
Caller note carried over from R1: whatever calls ensure() must create <PHOTOS_ROOT>/<slug> first, since nothing in src does.

No commits: nothing to integrate.

### 2026-11-19 · T28 · done
Items 1 and 2 already held from the earlier fix task: ensure() makes no validate request and checks <photosRoot>/<slug> locally; validateLibrary and its schema are already deleted; the provisioner spec asserts no /validate request reaches the stand-in server. Only the README still said the key needs `all`; replaced that caveat with one sentence on why validate is not used.
immich-contract/run.ts: ALL STEPS PASSED with the seven-permission key (no --with-all). Steps: ping, admin sign-up and key, ensure(alice) creates user and library, second ensure creates nothing, statistics reach 3 assets, scan/statistics/PUT users succeed, missing slug throws import_path_invalid, temporary password login 201, admin email reused, import_path_taken. Server reached at the container IP.
Cleanup: the script ran down -v; docker ps -a, volume ls and network ls show nothing for icloud-backup-immich-test; /tmp/icloud-users-* is gone.
Checks run: utils and ui build, icloud-backup lint and type-check, jest src/immich (25 passed), prettier on README. Not re-run: full jest suite, auth specs, mockups, docker build --check (nothing outside the README changed).
Remaining grep hits for "validate" are the explanatory comment in immich.provisioner.ts, the README sentence, and the spec's negative assertion; none is a call to the route.
run.ts keeps an optional diagnostic --with-all flag; nothing needs it.

### 2026-11-19 · T9 · done
JobsService methods match the task: getView, start, sync, submitPassword, submitCode, cancel, newImmichPassword, onChange(listener) returns an unsubscribe. It also implements onApplicationBootstrap (recovery) and onApplicationShutdown (stops children, leaves rows).
Errors for T10's controller: every refusal is a Nest ConflictException (409) whose body is { statusCode, message, error, view? }. The low-disk 409 carries `view` (a full BackupView with lowDiskSpace: true). newImmichPassword throws ForbiddenException (403) for a reused Immich user, 409 when there is no Immich account yet, and BadGatewayException (502) when Immich fails. submitPassword/submitCode throw 502 if icloudpd rejects the POST and 409 for wrong state or a wrong_step reply. The controller must not echo request bodies in errors or logs.
JobsModule imports IcloudpdModule and ImmichModule, provides CLOCK and STATFS (real timers, fs.statfs), and relies on the global DbModule. All configuration is read at call time from PHOTOS_ROOT, STATE_ROOT, MIN_FREE_BYTES, MAX_DOWNLOADS, ICLOUDPD_RECENT, IMMICH_EMAIL_PLUS_TAG, ACCOUNT_SLUG_PREFIX and IMMICH_EXTERNAL_URL (default https://immich.lilnas.io, used for the view's immich.url).
onChange fires with the lilnasUserId on every state change, every progress flush (at most once a second per job) and whenever a person's place in the sign-in line changes (including becoming the one whose turn it is). T10's gateway should call getView(user) in the listener and push it.
appleIdLocked is derived from a `download_started` job event (no column); anything that deletes job events would unlock the Apple ID.
Download failure retries (30 s, 2 min, 10 min) keep state queued_download with retryAt null (the contract shows retryAt only in indexing_wait). The retry is recorded as a `retry` event.
Immich: createdByUs may be false on a retry after a crash between user creation and storing the result (T7's note). That affects only whether the password button shows.
Dry run (H4): for the wrong-password guesses read the "Sign-in form step" log lines (step names only) and adjust judgePasswordAttempt in src/jobs/auth-failure.ts. Also check that a restarted auth process gets its form quickly enough; a person typing before it is ready gets a 409 "sign-in form is not ready".
Test helpers for other tasks: src/jobs/__tests__/helpers/harness.ts has FakeClock, FakeProcessService/FakeProc, FakeWebui, FakeProvisioner, FakeImmichClient, createHarness(db, env), captureLogs() and rejection(). It is excluded from jest's testMatch.

### 2026-11-19 · T10 · done
Routes and behaviour follow the task. Decisions worth knowing:
- POSTs return 200, not Nest's default 201.
- Validation is `parseBody(schema, body)` using the contract zod schemas. The 400 message names only the failing fields ("Invalid request: check password."), never the value.
- `RequestedWithGuard` is applied to `BackupController`. It exempts GET, HEAD and OPTIONS. Because the global `ForwardedUserGuard` runs first, a request with neither identity nor header gets 401, and a missing header with a valid identity gets 403. Pipes run after guards, so 403 comes before 400.
- Cache-Control no-store is set on the three secret routes and also on `GET /admin/accounts`. JobsService 409s pass through unchanged, including the low-disk `view` field.
- `JobUserService` turns the forwarded identity into a `JobUser` by checking admin status through `AdminCheckService` (60 s cache). The controller and the gateway both use it.
- `BackupGateway` is `@WebSocketGateway({ path: '/ws', maxPayload: 1024 })` with no `@SubscribeMessage` handlers. No identity means `close(4401)`.
- On connect it schedules a push for that person. That push goes to all of their open tabs, so an already-open tab also gets one repeat of the identical view. This keeps a single ordered send path.
- Pushes run one at a time per person, and changes that arrive during a send are folded into one more send. A getView failure is logged with its error message only, and the socket stays open.
- The gateway subscribes to `JobsService.onChange` in `onModuleInit` and unsubscribes in `onModuleDestroy`.
- `AdminService.listAccounts` calls `AccountsRepo.list()` and then `JobsRepo.findLatestForAccount` per account. That is one query per account, which is fine for a family-sized list. `totalBytes` and `totalItems` are the stored columns. A null `appleId` becomes '' (the contract field is a non-null string), and `folder` is the account slug. `AdminModule` and `ApiModule` now import `AuthModule` so `AdminGuard` and `AdminCheckService` resolve.
- The frontend's `lib/api.ts` already sends `X-Requested-With: icloud-backup` on POSTs.

### 2026-11-19 · T16 · partial
Live check of the built image, backend + frontend + postgres:18.4-alpine on a private network, driven from a throwaway node container. Every listed check passed except one finding: the icloudpd web UI is reachable from other containers (defect below). Details are in the table in the message above.
Deviation: accounts.apple_id is unique, so the second identity used second@example.invalid (a .invalid address) instead of nobody@example.invalid; it never went past the password form. No Apple password or code was submitted.
The backend logs a warning ("Failed to reach auth for admin check") because no auth container exists in this stack; expected here.
Cleanup done: compose project, volume, network, image and temp folder removed. ps/volume/network/images match the pre-build snapshots. Build cache left alone.

Defects:

- blocking · icloudpd web UI (Apple sign-in password/MFA form) listens on 0.0.0.0:8080, reachable from every container on the network · apps/icloud-backup/src/icloudpd/process.service.ts (buildBaseArgs, around lines 56-74); apps/icloud-backup/.env.example (ICLOUDPD_WEBUI_URL comment says "loopback only")
  From the driver container, GET http://icloud-backup:8080/status returned 200 with the Apple-ID password form for nobody@example.invalid while a job was at need_password. Inside the backend container, /proc/net/tcp shows a listener on 00000000:1F90 (0.0.0.0:8080). The spawn args are `--username <id> --cookie-directory ... --no-progress-bar --log-level info --auth-only --password-provider webui --mfa-provider webui`, with no bind-address option. `icloudpd --help` for 1.33.1 lists no http/bind/port/host option. In production the backend sits on the shared lilnas network, so any other container could read the pending Apple ID and submit a password or MFA code to the sign-in. Needs a fix outside what the flags allow: e.g. run icloudpd in its own loopback-only network namespace, put a loopback-only wrapper in front, or block non-loopback access to :8080 inside the backend container. Confirm the fix with a driver container fetching http://icloud-backup:8080/status.

No commits: nothing to integrate.

### 2026-11-19 · T16 · defects → R2
T16 reported 1 blocking defect at attempt 1, sent to R2; it runs again at round 2 to re-check.

- R2 · icloudpd web UI (Apple sign-in password/MFA form) listens on 0.0.0.0:8080, reachable from every container on the network (`apps/icloud-backup/src/icloudpd/process.service.ts (buildBaseArgs, around lines 56-74); apps/icloud-backup/.env.example (ICLOUDPD_WEBUI_URL comment says "loopback only")`): From the driver container, GET http://icloud-backup:8080/status returned 200 with the Apple-ID password form for nobody@example.invalid while a job was at need_password. Inside the backend container, /proc/net/tcp shows a listener on 00000000:1F90 (0.0.0.0:8080). The spawn args are `--username <id> --cookie-directory ... --no-progress-bar --log-level info --auth-only --password-provider webui --mfa-provider webui`, with no bind-address option. `icloudpd --help` for 1.33.1 lists no http/bind/port/host option. In production the backend sits on the shared lilnas network, so any other container could read the pending Apple ID and submit a password or MFA code to the sign-in. Needs a fix outside what the flags allow: e.g. run icloudpd in its own loopback-only network namespace, put a loopback-only wrapper in front, or block non-loopback access to :8080 inside the backend container. Confirm the fix with a driver container fetching http://icloud-backup:8080/status.

### 2026-11-19 · R2 · done
Fix for the T16 defect: icloudpd's sign-in form (0.0.0.0:8080) is no longer reachable from other containers.
Chose nftables (not iptables): `nft` loaded the rule in the container netns on this host. The rule is an `inet` table (IPv4 + IPv6) with an input chain: `iifname != "lo" tcp dport 8080 drop`. The script loads it atomically with `nft -f` (add/delete/table idiom, so a restart is idempotent), lists the table, and exits 1 if the rule text is missing. It then execs `setpriv --reuid 1000 --regid 1000 --clear-groups --inh-caps=-all --bounding-set=-all node dist/main` (HOME=/home/node exported, since the script runs as root).
Script path: /usr/local/bin/backend-entrypoint.sh (root-owned, 755). USER node and the default ENTRYPOINT are untouched, so the frontend runs unprivileged. Backend service only gets user: root, cap_add: [NET_ADMIN], security_opt: [no-new-privileges:true].
Live proof (image built from the commit, throwaway compose project, only nobody@example.invalid, never past the password form): see the table in the message above. Outside probe to :8080 times out, :8081/health is 200, loopback :8080 serves the password form, job reached need_password. PID 1 = node uid 1000, all cap sets zero, NoNewPrivs 1; icloudpd children uid 1000. Restart keeps the rule; no cap_add exits 1 without starting node (checked with `docker run` using the same user/security-opt/entrypoint, not a compose project); docker stop returned in 0.26s with exit 0.
The README paragraph sits after the "Two containers, one image" section (there is no dedicated security section).
The job showed `failed` after the `docker restart` (the restart killed it mid-sign-in); I did not investigate that.
Cleanup: project down -v, fwcheck image, temp folder and extra container removed; ps -a / volume ls / network ls show nothing from this test; git status clean.
Checks: lint + type-check pass; icloud-backup jest 507/507, auth services jest 88/88; mockups build + lint pass; prettier on compose and deploy files passes; docker build --check clean.

### 2026-11-19 · T16 · done
Live check of the R2 fix passed on every item. The round 1 defect no longer reproduces: with a job at need_password, http://icloud-backup:8080/status from a third container times out (before and after a backend restart), while 127.0.0.1:8080/status inside the backend returns the password form.
Also verified: migrations, 401 without identity, 403 without X-Requested-With, backend /health 200, need_password in about 2 s, second identity queued_login position 1, websocket frame on connect and on cancel with the second person reaching need_password, no icloudpd left after cancel, interrupted_login after backend stop/start, PID 1 uid 1000 with zero caps and NoNewPrivs 1, icloudpd 1.33.1, frontend env without POSTGRES_PASSWORD/IMMICH_API_KEY, and no password= or request body in any of the three logs (canary password/code sent to a 409/400 path, absent from logs).
Notes: websocket frames are {data: view} messages. The auth-service admin check logs a warning in this stack because no auth service exists; expected. No password was submitted to Apple. Teardown complete; ps -a, volume ls, network ls and images show nothing left; git status clean.

No commits: nothing to integrate.

### 2026-11-20 · Phase 2 · review cycle 1
Pass 1 (T7): T7's Immich client, provisioner, email helper and module match the task body: correct verbs, paths, headers and bodies; ensure checks for an existing user and library before creating, refuses a path another user's library already has, validates, then scans; errors carry only the status and Immich's message. No P0/P1 defects; one P2 about a body-read timeout being reported as bad_response.
Pass 2 (T5, T8): T5 (schema, migration, repos, DbModule, slug) and T8 (throwaway Immich compose + run.ts) match their task bodies and every T5 test the task lists exists against PGlite with the real migrations. Only one minor note: a slug cut at 40 characters can end in '-' or '.'.
Pass 3 (T11): T11 builds the API client, live hook, stepFor, formatters, pending-password provider and page shell as the task describes, with specs for every required behaviour. Its routes, header, response shapes and websocket frame match the T10 backend. One P2: the reconnecting banner shows briefly on every first load.
Pass 4 (T6): T6 (icloudpd process runner, form client, log parser) matches its task body: argument builders, merged-output spawn with an env allowlist, step-checked submits that never throw, input-stripped snippets, and specs for every listed behaviour. No P0/P1 defects; one suspicion about the SIGKILL fallback against the PyInstaller onefile binary.
Pass 5 (T15): T15's compose files, encrypted env file, registration lines and deploy.spec.ts match the task body; prod/dev network isolation and service naming hold. Only a P2 note: a misleading header comment in deploy.dev.yml.
Pass 6 (T12): T12's sign-in screens follow the task for the password-once flow, the queue path, retries, the code input and cancel. One spec is vacuous (the locked Apple ID test can't tell appleIdLocked from the retry read-only rule), and Cancel during an in-flight start doesn't stop the job.
Pass 7 (T13): T13 builds all eight backup screens to the task, with specs for every listed behaviour; one user-facing defect: a backup the person stopped (cancelled, shown on the Failed screen once a backup exists) reads as 'Something went wrong'. Plus one P2 for the cns() rule.
Pass 8 (T14, T17, R1, T28): Pass 8 (T14 admin page, T17 docs, T28 Immich key and validate removal) is clean apart from one doc mismatch: the README state diagram says a sync skips provisioning, but in the code every finished download goes through it. The admin page states, the badge-tone mapping, the folder check that replaced validate, and the README env and dry-run tables all match the code and the task bodies.
Pass 9 (T9): T9's orchestrator follows the task closely: sign-in turn, retry and indexing ladders, disk guard, Apple ID lock, Immich provisioning, recovery and secret handling all match, and the required specs exist. Two P2 notes: a late relay can reopen a job already ended by cancel or timeout, and the Immich temp-password spec does not check the logs.
Pass 10 (T10, R2): Pass 10 (T10 HTTP API, gateway and admin list; R2 nftables entrypoint) read in full. No provable defect: routes, guard order (global ForwardedUserGuard then RequestedWithGuard), zod validation, no-store headers, 409 passthrough, gateway per-person ordered pushes and the admin rows all match the task body; the firewall entrypoint fails closed and drops to uid 1000 with no capabilities.
Seams pass: Seams between the phase's tasks mostly agree: frontend API calls match the controller routes, the X-Requested-With header matches the guard, the websocket path and message shape match, admin rows match the table, the orchestrator matches the repos, the Immich provisioner and the icloudpd services, and paths and env keys match across compose, Immich and the backend. One mismatch: T13's 'done without Immich' screen can never appear, because T9 fails the job with immich_error instead. The plan itself specifies both.
Consolidation: Merged 11 passes into 8 findings: 2 P1s (a vacuous locked-Apple-ID spec, and a stopped backup shown as 'Something went wrong') and 6 P2s. Four lower-impact P2s over the 8-finding cap (slug trailing '-' or '.', the deploy.dev.yml header comment, cns() in done.tsx/failed.tsx, the README state diagram) and six over-cap suspicions are listed in declined.

- F6 · P1 · A stopped backup is shown as 'Something went wrong' — apps/icloud-backup/src/components/steps/failed.tsx:85 → R3
- F7 · P1 · Locked Apple ID spec passes without appleIdLocked — apps/icloud-backup/src/components/__tests__/sign-in-steps.spec.tsx:233 → R4

Notes:
- F8 · P2 · A relay that finishes after cancel or timeout reopens the finished job — apps/icloud-backup/src/jobs/jobs.service.ts:690
- F9 · P2 · plan-mandated · Done screen's Immich-failed branch is unreachable; an Immich failure shows as a generic failed backup — apps/icloud-backup/src/components/steps/done.tsx:217
- F10 · P2 · Cancel during an in-flight start leaves the job running — apps/icloud-backup/src/components/steps/sign-in.tsx:57
- F11 · P2 · Immich temp-password spec doesn't check the captured logs — apps/icloud-backup/src/jobs/__tests__/jobs.immich.spec.ts:168
- F12 · P2 · Timeout while reading a 2xx body is reported as bad_response — apps/icloud-backup/src/immich/immich.client.ts:171
- F13 · P2 · Reconnecting banner flashes on every page load — apps/icloud-backup/src/components/backup-app.tsx:85

Suspicions:
- SIGKILL fallback can hang stop() and orphan the real icloudpd process — apps/icloud-backup/src/icloudpd/process.service.ts:152 · The binary is a PyInstaller onefile build, so the spawned pid is a bootloader whose Python child inherits the pipes. SIGKILL is not forwarded, so the child keeps running and holds the pipes and port 8080, 'close' never fires, and `await exited` never resolves. The fake ignore-term script detaches sleep's output, so the spec can't catch this; spawning with detached: true and signalling the process group would cover it. · confirm by: Run the real binary with auth args, send SIGKILL to the bootloader pid, and check whether the child and pipes survive and whether `exited` resolves.
- An action's response can overwrite a newer websocket frame — apps/icloud-backup/src/lib/use-backup.ts:163 · apply() always adopts the POST response, and BackupView has no version. If the WS frame for a later state (e.g. queued_login, then need_password) arrives before the HTTP response, the older view wins, and no further frame comes while the backend waits for input. · confirm by: Check whether JobsService.start/submitPassword/submitCode can broadcast a later state before the controller responds, or add a server revision to BackupView and compare it on the client.
- Held password can outlive a job that never reached need_password — apps/icloud-backup/src/lib/pending-password.tsx · The held password is cleared only by Cancel, a failed start, or take(). If the server moves a job from queued_login straight to failed, cancelled or needs_login, the password stays held, and Failed/SignInAgain call actions.start without clearing it, so the next need_password sends the old password without the person typing it. · confirm by: Spec: queued_login, then failed, then start from the Failed screen, then need_password; assert submitPassword isn't called.
- A recovery that fails part-way leaves a job active with nothing driving it — apps/icloud-backup/src/jobs/jobs.service.ts:290 · recover() writes queued_download before ensureFolders. If mkdir/chmod throws, onApplicationBootstrap only logs it; the row stays non-terminal with no run, so start and sync return it and cancel does nothing until the next restart. · confirm by: A recovery spec where STATE_ROOT is unwritable.
- A disk check already running can pause a download that finished — apps/icloud-backup/src/jobs/jobs.service.ts:1340 · watchDisk is async. A call started just before the interval is cleared can set run.stop='low_disk' after the process exits, and completeBackup's final guard then ends the job paused_low_disk even though totals were added and Immich was set up. · confirm by: A spec whose statfs promise resolves low only after the download proc emits all_done and exits.
- Malformed JSON body may echo password text in the 400 message — apps/icloud-backup/src/api/backup.controller.ts:60 · A body that isn't valid JSON never reaches parseBody. Nest maps body-parser's SyntaxError to BadRequestException(err.message), and on Node 20+ JSON.parse messages quote part of the input. Reachable only with a hand-built request. · confirm by: POST /backup/password with body `{"password": hunter2}` (application/json) against the Nest test app; check whether the message contains 'hunter2'.
- ensure's list-then-create can fail with 400 when the list misses an existing user — apps/icloud-backup/src/immich/immich.provisioner.ts:57 · Two concurrent ensure calls for one email both see no user and the second POST /admin/users fails 400. Also, GET /admin/users omits soft-deleted users, but the deleted row still holds the email, so createUser fails 400 on every retry. · confirm by: Check that the orchestrator never runs ensure twice at once for one account; in T8's throwaway Immich, delete a user and call ensure with that email.
- A leftover form error may mark a second code wrong too early — apps/icloud-backup/src/jobs/jobs.service.ts:935 · wrong = step.error !== null wins before the stale-poll allowance. After one wrong code, if the form still shows the old error on the first poll after the next POST, the new code is marked wrong_code while icloudpd is still checking it. · confirm by: In the H4 dry run, enter a wrong code and then a right one, and see whether /status keeps the old error text right after the second POST.

Spec check:
- missing: Specs that feed a password through assert it is absent from every captured log call. (apps/icloud-backup/src/jobs/__tests__/jobs.immich.spec.ts) — TEMP_PASSWORD is checked against the DB dump only.
- extra: spawn(ICLOUDPD_BIN, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] }) (apps/icloud-backup/src/icloudpd/process.service.ts) — Also passes a restricted env allowlist so DB and Immich secrets don't reach icloudpd; safe.
- extra: sign-in.tsx: The Apple ID is prefilled and read-only when view.account?.appleIdLocked (apps/icloud-backup/src/components/steps/sign-in.tsx) — Also read-only on every need_password retry; stated in the notes.
- extra: Failed screen (cancelled jobs not covered by any task) (apps/icloud-backup/src/components/steps/failed.tsx) — Cancelled jobs reach this screen through stepFor; see the P1.
- extra: Keys in .env.prod (none for the dev db) (apps/icloud-backup/deploy.dev.yml) — Dev Postgres credentials are hardcoded non-secret literals; yaml devDependency added for deploy.spec.ts.
- extra: JobsRepo method list; run.ts steps as listed (src/db/repos/jobs.repo.ts, scripts/immich-contract/run.ts) — Adds findById, a --with-all diagnostic flag and an import_path_taken step; harmless.
- extra: Cache-Control: no-store on secret-bearing responses; badge for every state (src/admin/admin.controller.ts, src/lib/admin-state.ts) — no-store also on GET /admin/accounts; cancelled gets the mute tone. Both stated in the notes.
- misunderstood: Every screen has a visible "Cancel" that calls actions.cancel() (apps/icloud-backup/src/components/steps/preflight.tsx, sign-in.tsx) — Pre-flight has no Cancel, and Cancel with no job goes back locally; deliberate per the notes.
- unverifiable: Match the approved mockups (start.html, backup.html, admin.html) at 1280 and 390 (apps/icloud-backup/src/components/) — No browser comparison was done; a person should compare all screens and /admin at both widths.
- unverifiable: When account.immich is null (Immich failed): say the photos are safe on the server and "Sync now" will retry. (apps/icloud-backup/src/components/steps/done.tsx) — Built but unreachable because T9 fails with immich_error; a person decides which plan statement wins.
- unverifiable: GET /libraries returns libraries with id, ownerId, name, importPaths (apps/icloud-backup/src/immich/immich.provisioner.ts) — The import_path_taken guard assumes the admin key sees every user's libraries; confirm on Immich v3.3.4.
- unverifiable: How icloudpd reports a wrong password is unverified; keep this logic in one small function (apps/icloud-backup/src/jobs/auth-failure.ts) — Needs the H4 dry run against real icloudpd.
- unverifiable: WS /ws reads the identity from the upgrade request (apps/icloud-backup/next.config.js) — Confirm end to end that the /ws rewrite forwards X-Forwarded-User/-Id on the upgrade.
- unverifiable: R2: drops inbound TCP to port 8080 on every interface except lo (apps/icloud-backup/scripts/backend-entrypoint.sh) — Confirm from a live check that a sibling container cannot reach :8080 during a sign-in, and that setpriv exists in the image.

Declined to judge:
- P2 notes over the 8-finding cap: (1) slug.ts:14 trims edges before .slice(0, 40), so a slug can end in '-' or '.'; (2) deploy.dev.yml:22 header says .env.dev-remote can supply POSTGRES_*, but environment: overrides env_file:; (3) done.tsx:118 and failed.tsx build class names with template literals instead of cns() (CLAUDE.md rule); (4) README.md:39 state diagram shows 'downloading --> done' for a sync, but completeBackup always passes through provisioning. — Distinct, real P2s from passes 2, 5, 7 and 8, kept here only because findings are capped at 8.
- Suspicions over the 8 cap: WS identity needs Next's /ws rewrite to forward X-Forwarded-User (backup.gateway.ts:66); host /state and /photos dirs need uid 1000 ownership before first start (deploy.yml:75); the reconnect ladder resets on any open, so open-then-close loops every 1 s (use-backup.ts:108); per-file 'downloaded' events may outnumber 'total' with Live Photos (log-parser.ts:22); a crash between addTotals and provisioning double-counts totals (jobs.service.ts:1366); replace-password confirm is skipped after a reload (done.tsx:60). — Suspicions capped at 8; these were judged the lower-impact or most likely already covered (T16 live check, R2 entrypoint).
- accounts.create / bare catch around setAppleId: a race on a duplicate lilnasUserId throws, and any DB error becomes a 409 'Apple ID already used' — Documented in the T5 notes as left for callers; low impact, and the comment states the intended unique-index case.
- Any auth-process exit after the password is relayed counts as a wrong password — The T9 body defines it this way and keeps the guess in judgePasswordAttempt for H4 to correct.
- Screens not compared with the mockups at 1280 and 390 (sign-in, backup, admin) — Outside code review; a person checks the mockups at their H task.
- No Cancel on pre-flight; Cancel on a form with no job goes back locally — Deliberate deviation stated in the T12 notes; there is no job to cancel.
- A non-JSON 2xx body makes request() throw SyntaxError instead of ApiError — Only reachable if a proxy returns HTML with 200; useBackup's toApiError covers the load path.
- Cancel during provisioning waits for the Immich call and can end 'cancelled' after Immich was linked — Cosmetic; totals and link are kept and the next sync scans.

Checked:
- Frontend API routes and response shapes vs the controllers — src/lib/api.ts, src/api/backup.controller.ts, src/admin/admin.controller.ts: All seven backup routes and /api/admin/accounts match; immich-password returns {password} on both sides.
- CSRF header the guard requires on POST — src/lib/api.ts, src/api/requested-with.guard.ts: X-Requested-With: icloud-backup is sent on every POST and matches the guard's lower-cased lookup.
- Websocket path, frame shape and listener key — src/api/backup.gateway.ts, src/lib/use-backup.ts, src/jobs/jobs.service.ts: Both sides use /ws and {type:'backup', data}; onChange emits lilnasUserId, which equals the forwarded userId the gateway keys on.
- Repos used before migrations apply — src/jobs/jobs.service.ts:225; DbModule: Recovery runs in onApplicationBootstrap after every onModuleInit; DbModule is @Global and migrates first.
- Repo method signatures used by the orchestrator — src/db/repos/*.ts vs src/jobs/jobs.service.ts: finish, update, findNonTerminal, findActiveForAccount, findLatestForAccount, setAppleId, setImmich, addTotals and list all match.
- Active-job race on concurrent start/sync — src/db/schema.ts: The jobs_one_active_per_account unique index exists; createJob's catch path is sound.
- Secrets in logs, events or errorDetail — src/jobs/jobs.service.ts, src/immich/immich.client.ts: Auth lines are reduced to parsed kinds; Immich errors carry only the verb, path, status and a capped message.
- Sign-in turn released on every exit — src/jobs/jobs.service.ts: signIn's finally releases the turn; a guard throw just after the grant is covered by cleanup()'s turn.cancel.
- Nothing still calls validateLibrary after its removal; the folder exists before ensure() — src/immich, scripts/immich-contract/run.ts, jobs.service.ts:552: Client method, schema, fake route and run.ts step are gone; makeDir(join(photosRoot, slug)) runs before the download.
- Env keys and paths vs compose and Immich mounts — deploy.yml, deploy.dev.yml, .env.prod, src/env.ts, infra/immich.yml: All names match EnvKeys; IMMICH_IMPORT_ROOT /icloud-users and PHOTOS_ROOT /photos match the mounts.
- Entrypoint fails open if nft load or verify fails — apps/icloud-backup/scripts/backend-entrypoint.sh: Under set -eu, a failed nft -f or ruleset grep exits before exec setpriv.
- Gateway push coalescing interleaving — src/api/backup.gateway.ts:79-101: schedule sets again=true while a loop runs and the loop re-checks after each await; no lost or out-of-order send.

### 2026-11-19 · R4 · done
Locked-Apple-ID spec now renders makeView(null) with account.appleIdLocked=true, clicks Continue on pre-flight, and asserts the Apple ID is prefilled and readonly and that the password field has focus. The previous need_password case is kept as "makes the Apple ID read-only on a retry even when it is not locked".
Mutation check: with `Boolean(account?.appleIdLocked) ||` removed from sign-in.tsx, the locked spec failed (1 failed, 23 passed). With the guard restored, all 24 specs in the file pass; sign-in.tsx is unchanged in the commit.
Verified: utils/ui build, icloud-backup lint and type-check, and the full icloud-backup jest run (41 suites, 508 tests) all pass. The apps/auth jest run, mockups, compose prettier and docker build --check were not run, since this change touches only one spec file.

### 2026-11-19 · R3 · done
Failed now branches on job.state === 'cancelled' before the errorCode lookup (STOPPED reason, 'mute' "Stopped" badge, accent Note, "Sync now" when a session may exist else "Try again"). Regression specs added in failed.spec.tsx; they failed before the fix. Lint, type-check and the full icloud-backup jest suite pass (510 tests). Auth jest, mockups, prettier-on-compose and docker --check checks were not run, since the change touches only these two files. Title copy "Your backup didn't finish" was left unchanged.

### 2026-11-20 · Phase 2 · review cycle 2
Re-review of the cycle-1 remediation: R3 fixes F6 (a cancelled job now shows a neutral 'Stopped' screen with Sync now) and R4 fixes F7 (the locked-Apple-ID spec now exercises appleIdLocked with no job). The remediation diff adds no new defects; F8–F13 were not touched.

Earlier findings: F6 fixed, F7 fixed.

Declined to judge:
- Title 'Your backup didn't finish' kept for a stopped job — R3 states it left the title on purpose; it is accurate copy, and the badge and note now say the person stopped it.
- The 'Try again' (start) branch for a cancelled job with no session — Not reachable in production: stepFor sends a cancelled job with no lastBackupAt to preflight, so Failed only sees a cancelled job when a session may exist. Harmless, and covered by a spec.

Checked:
- Other backend paths that set state 'cancelled' and would now show 'You stopped this backup' — apps/icloud-backup/src/jobs/jobs.service.ts: Only line 627 (the cancel path) finishes a run as 'cancelled'; timeouts and failures use 'failed'.
- makeView(null) leaves account null, so the new locked spec would never render the locked case — apps/icloud-backup/src/lib/__tests__/helpers/view.ts: makeView always builds an account with appleId 'nobody@example.invalid' and job null, so the spec takes the preflight then SignIn path, where only appleIdLocked can make the field read-only.
- The new badge tone 'mute' and Note tone 'accent' are not allowed by the component types — apps/icloud-backup/src/components/steps/state-head.tsx: The badge tone is typed BadgeTone; type-check passed on the merged branch.

### 2026-11-19 · T18 · done
Dry-run stack is running for a human to sign in at https://icloud-backup.dev.lilnas.io/ (gated: 302 to auth.lilnas.io/login).
Containers (project lilnas-dev, file apps/icloud-backup/deploy.dev.yml only): lilnas-icloud-backup-dev, lilnas-icloud-backup-dev-frontend, lilnas-icloud-backup-dev-db. All healthy.
Dry-run bounds: at most 25 items per sign-in (ICLOUDPD_RECENT=25) into /storage/photos/icloud-users/dev-<name> (ACCOUNT_SLUG_PREFIX=dev-); the Immich user created is <name>+icloud-backup-dev@<domain> (IMMICH_EMAIL_PLUS_TAG=icloud-backup-dev).
Checks: /storage/app-data/icloud-backup-dev created by me, uid 1000. /storage/photos/icloud-users exists and lilnas-immich-1 mounts it at /icloud-users. Backend to http://immich:2283/api/server/ping 200; /api/libraries with the key 200, count 4. Frontend networks are lilnas-dev_icloud-backup-dev and lilnas-proxy only (not lilnas_default). https://icloud-backup.dev.lilnas.io/ is 302 to auth.lilnas.io; https://icloud-backup.lilnas.io/ is 404 (not served). No error/warn/fatal lines in the backend log at start.
.env.dev-remote was gitignored (.gitignore:6 .env.*), mode 600, and deleted after startup; git status clean; the backend container still has IMMICH_API_KEY in its environment. No password was submitted to Apple.
Deliberately left running: three containers, volume lilnas-dev_icloud-backup-dev-db, network lilnas-dev_icloud-backup-dev, image lilnas-icloud-backup:dev. Tear down with: docker compose -p lilnas-dev -f apps/icloud-backup/deploy.dev.yml down (add -v to drop the DB volume).
POSTGRES_USER/DB/PASSWORD in the env file are overridden by literals in deploy.dev.yml's environment: block (compose environment beats env_file), so the generated password was never used.

No commits: nothing to integrate.

### 2026-11-19 · T30 · done
icloudpd is pinned to 1.32.3 (sha256 cbe4de08…ce093). Verified live in a throwaway image: `icloudpd --version` prints 1.32.3; with a fake account the web form behaves as classified (need_password -> POST /password 200 -> need_password with the Apple -20101 error after 8 s, process stays up).
Classifier change: decodeEntities now also decodes &#34; / &#x22; (Jinja2 escapes `"` that way; 1.32.3's Apple error showed `&#34;serviceErrors&#34;`). New fixture password-error-apple.html (captured from 1.32.3) with two specs. Existing fixtures match the 1.32.3 templates structurally, so none were replaced. auth-failure.ts untouched.
Not run: the apps/auth jest, mockups build/lint and compose prettier plan checks. Also prettier -c cannot parse Dockerfile or .sh (no parser), which is unrelated to this change.
The pinned-1.32.3 image is not deployed to the dry-run stack; T31 rebuilds it. Cleanup done: container t30-icloudpd, network t30-net, image lilnas-icloud-backup:t30, /tmp/t30-out and /tmp/t30-up all removed.

### 2026-11-19 · T31 · done
Dry-run stack rebuilt with `docker compose -p lilnas-dev -f apps/icloud-backup/deploy.dev.yml up -d --build`. icloudpd in lilnas-icloud-backup-dev prints `version:1.32.3, commit sha:879c561`.
Container states: lilnas-icloud-backup-dev Up, healthy (recreated); lilnas-icloud-backup-dev-frontend Up, healthy (recreated); lilnas-icloud-backup-dev-db Up 2 hours, healthy (not recreated, same volume).
Backend log has `backend-entrypoint: inbound tcp/8080 dropped on every interface but lo`.
https://icloud-backup.dev.lilnas.io/ from this host: 302 to https://auth.lilnas.io/login.
.env.dev-remote was written (mode 600, gitignored via .gitignore:6) and deleted after the containers came up. Tree clean, nothing committed.

No commits: nothing to integrate.

### 2026-11-19 · T32 · done
The image now runs the musl build of icloudpd 1.32.3 directly: the loader sits at /lib/ld-musl-x86_64.so.1, musl's libz at /opt/musl/lib/libz.so.1, and /etc/ld-musl-x86_64.path points musl at /opt/musl/lib. No wrapper process, so signals go straight to icloudpd (SIGTERM stopped both processes in 60 ms).
The musl stage is pinned to icloudpd/icloudpd@sha256:af2bf40c… (Alpine 3.23.4). The musl sha256 is acbe7149…6fd6.
The build-time version check runs as uid 1000 (USER node, then back to root before the later steps).
T33 must rebuild the dry-run stack with --build to pick this up.
The default-entrypoint check was run with the entrypoint script alone. The line `inbound tcp/8080 dropped on every interface but lo` was logged, and I did not look at what the backend did afterwards (no DB in the throwaway).
Only fake credentials were used, and only up to the password form, for nobody-t32@example.invalid.
Containers, network and the :t32 image are removed.
The task named no jest-affecting source change, so jest, lint and type-check were not rerun. Prettier and docker build --check pass.

### 2026-11-19 · T33 · done
Rebuilt lilnas-dev (deploy.dev.yml only, `up -d --build`). Frontend and backend were recreated; the db container was reused and the database was not touched.
Checked: three containers healthy; icloudpd --version = version:1.32.3 (commit 879c561); /usr/local/bin/icloudpd is an ELF binary (no wrapper) that references ld-musl, with /lib/ld-musl-x86_64.so.1 present; backend log has "inbound tcp/8080 dropped on every interface but lo"; https://icloud-backup.dev.lilnas.io/ returns 302 to https://auth.lilnas.io/login; no error/fatal lines in the backend log, migrations applied and Nest started.
.env.dev-remote was created (gitignored by .env.*, mode 600, no values printed) and deleted after the containers came up. deploy.dev.yml hardcodes POSTGRES_* in environment, which overrides the env file, so only IMMICH_API_KEY took effect from it.
Cookies: the two session files in cookies/dev-<apple-id>/ went to cookies-stale-20261120/ with mv --backup=numbered, because same-named files from 22:08 were already there; the older pair is now suffixed .~1~. The cookie directory is kept and empty.
No throwaway containers, networks, volumes or images were created. git status is clean.

No commits: nothing to integrate.

### 2026-11-19 · T34 · done
ensure() now takes onUserCreated and knownCreatedUserId. completeBackup passes both. setImmichUser writes the user id, email and createdByUs=true and leaves the library id null.
Readers of immichUserId: admin.service hasImmich and jobs.view's immich block now key on immichLibraryId, so a user without a library is not shown as linked. newImmichPassword is unchanged and works for such a row.
The jobs harness FakeProvisioner now calls onUserCreated and applies the knownCreatedUserId rule, and has a failAfterUser switch. The admin controller spec fixture got immichLibraryId null for the unlinked row, plus a third row (user, no library) that expects hasImmich false.
Checks run: utils and ui build, icloud-backup lint and type-check, full icloud-backup jest (41 suites, 519 tests). Not run: the apps/auth jest, the mockups check, the prettier check on compose files, and docker build --check; none of them touch the files changed here.

### 2026-11-19 · H4 · approved
Approved.
