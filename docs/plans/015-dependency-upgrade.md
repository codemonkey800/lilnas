---
nexus-plan: 2
title: Full dependency upgrade
branch: chore/dependency-upgrade
base: main
setup:
  - pnpm install --frozen-lockfile
checks:
  - 'pnpm install --frozen-lockfile --offline && pnpm turbo run build --filter="./packages/*" && pnpm install --frozen-lockfile --offline'
  - pnpm turbo run type-check
  - pnpm turbo run lint --concurrency=4
  - 'for p in packages/utils packages/cli apps/auth apps/equations apps/theater apps/tdr-bot apps/tdr-code apps/dev apps/download; do (cd "$p" && env $(env | sed -n "s/^\(GIT_CONFIG_[A-Z0-9_]*\)=.*/-u \1/p") CI=true pnpm test --maxWorkers=2) || exit 1; done'
parallel: 2
review: per-phase
commit-style: 'conventional, scope required, e.g. chore(deps): bump turbo to 2.11.10 / refactor(tdr-code): move onto the ACP SDK 2 client app'
---

# Full dependency upgrade

## Goal
Bring every dependency in the monorepo to its latest release where that is
technically possible, as reported by `pnpm outdated -r` on 2026-10-20. That
breaks down as:

- patch and minor bumps
- deleting the unused dependencies instead of upgrading them
- the mechanical majors
- the majors that need small code changes
- MUI 9 and the ACP SDK 2, each as its own change with a human review
- ecctrl 2, with a hands-on play-test

`typescript` stays on 6.0.3, for the reason given under Decisions. Nothing
is pushed or deployed.

## Decisions
- **`typescript` stays 6.0.3.** `packages/tsc7` already runs TS 7.0.2 for
  every workspace's `type-check`. typescript-eslint 8.72 (peer `<6.1`),
  ts-jest 29.4 (peer `<7`) and the Nest CLI (it needs the compiler JS API)
  don't support 7. Revisit after TS 7.1 stable, since the 7.1 beta shipped
  on 2026-10-20.
- **Delete unused deps rather than upgrade them:** openai, framer-motion,
  uuid and chokidar (tdr-bot), commander (tdr-code), dotenv (cli),
  `@types/cron`, `@types/diff` and `@types/uuid`. `@types/js-yaml` is
  deleted with js-yaml 5. `@types/content-disposition` goes along with the
  content-disposition dependency it types.
- **content-disposition is replaced by Express 5's `res.attachment()`,**
  so there is no ESM/Jest workaround. (User, 2026-10-20.) Correction (C2,
  planner): express 5.3.0 bundles content-disposition 2.0.1, not 1.x, so the
  header bytes change in two ways. Non-ASCII Latin-1 names get an ASCII
  fallback plus `filename*` (`filename="Am?lie.mkv"; filename*=UTF-8''Am%C3%A9lie.mkv`),
  and plain-token names are no longer quoted (`filename=movie.mkv`). Browsers
  still save the same name. Accepted rather than pinning 1.0.0.
- **MUI 9 gets before/after screenshots of all six tdr-bot pages**, taken
  with `next dev` and `/api` stubbed, published to files.lilnas.io, and
  reviewed by the user at an H checkpoint. (User, 2026-10-20.)
- **The ACP SDK 2 rewrite is smoke-tested against a real claude-agent-acp**
  using the user's Claude login, never through the prod daemon. (User,
  2026-10-20.)
- **Every bare `dotenv.config()` call passes `quiet: true`.** dotenv 18
  moves its log line to stderr. (User, 2026-10-20.)
- **jotai is pinned to 3.0.1, not 3.0.0,** because 3.0.0 has a
  `useAtomValue` regression.
- **ecctrl 2 is in scope.** It is a ground-up rewrite with no migration
  notes, so it gets the `strong` model and a hands-on play-test (H5). It
  runs in phase 3, so H5 shares one human wait with H2 and H3, and the
  phase-4 build sweep covers it. (User, 2026-10-20.)
- **Human checkpoints only where a person adds something an agent can't:**
  after MUI (H2, the screenshots), after the ACP SDK (H3, the real-agent
  smoke), and after ecctrl (H5, hands-on play). Batches 1–3 end at the
  automated phase review instead of a human gate. Their smokes (T3
  Docker/Next, T6 `lilnas --help`) report failures as `defects:`, which the
  reviewer acts on. (User, 2026-10-20.)

## Context
- **Layout:** a pnpm 12 + Turbo monorepo with deployable apps in `apps/*`
  and shared libraries in `packages/*`. It runs on Node 26 (`.nvmrc`; the
  base images are `node:26.12.0`). Lockfile: `pnpm-lock.yaml`.
  `pnpm-workspace.yaml` holds `allowBuilds` (strictDepBuilds: any dep with
  an install script must be listed) and `overrides`.
- **Commands:**
  - After editing a `package.json`, run `pnpm install` and commit the
    updated lockfile. The checks run `--frozen-lockfile`.
  - Type-check and lint one package with `pnpm --filter <name> type-check`
    and `pnpm --filter <name> lint`. `type-check` is `tsc7 --noEmit`.
    `lint:fix` exists.
- **Tests (Jest):** run `cd <pkg> && pnpm test --maxWorkers=2 <paths>`.
  - Never write `pnpm test -- …`: Jest reads the extra `--` as a path
    pattern.
  - Never run Jest uncapped. This 32-core host is the production server,
    and uncapped parallel suites nearly OOM'd it.
  - Iterate on your own specs. Then run each touched package's full suite
    once with `--maxWorkers=2`, one package at a time. That includes
    `apps/download`, which has about 6,400 tests.
  - In `apps/tdr-code`, prefix the command with
    `env $(env | sed -n "s/^\(GIT_CONFIG_[A-Z0-9_]*\)=.*/-u \1/p")`.
    Otherwise the agent shell's `GIT_CONFIG_*` variables fail
    `scripts/__tests__/git.spec.ts`.
- **Versions:**
  - Bump to the version the task names, or to a newer release in the same
    major if one has come out since.
  - Keep each entry's specifier style: an exact pin stays exact and a `^`
    stays `^`.
  - Never bump `typescript` (stays 6.0.3), and never touch `packages/tsc7`.
- **Before you change code,** read the upgraded package's own
  CHANGELOG/README/`.d.ts` in `node_modules`. The breaks listed in each
  task are the known ones, not necessarily all of them.
- **Style:**
  - prettier + eslint must pass for every package you touch.
  - Use `cns()` to combine class names.
  - Match the surrounding comment density. When a comment names a version
    or behaviour that the upgrade changed, update it.
- **Production safety:** this machine is the production server.
  - Never run `docker compose` against the `lilnas` project, never touch
    `/opt/lilnas`, never push.
  - Prod tdr-code runs from the main checkout `/home/jeremy/lilnas/apps/tdr-code`,
    with ports 8790/8791 and `/tmp/tdr-code/`. Never build, run or
    `daemon.sh` there. Work only in your own worktree.
  - `docker build`/`docker run` with a throwaway tag is fine. Remove the
    images and containers you create.
- **`next dev` side effects:** it rewrites the app's `next-env.d.ts` and
  creates an `AGENTS.md`. Revert and delete both before you commit.
- **Shared locations:**
  - Put scratch files under `/tmp/plan015-*` and delete them when done.
  - Files under `/storage/files/<path>` are served at
    `https://files.lilnas.io/<path>`.
  - Browser work uses `playwright-cli` (see
    `~/.claude/skills/playwright-cli/SKILL.md`). Run it from a scratch
    directory, because it writes `.playwright-cli/` into the cwd.

## Done means
- **Versions:** every dependency the task names is at its target in each
  listed `package.json`. `pnpm install --frozen-lockfile` passes.
- **Removed deps:** they appear in no `package.json` and in no lockfile
  importer.
- **Checks:** all checks exit 0. As of `base` (46883040), they pass with
  593 utils, 159 cli, 652 auth, 408 equations, 246 theater, 1863 tdr-bot,
  1723 tdr-code, 203 dev and 6370 (+9 skipped) download tests.
- **Lint:** `pnpm --filter <pkg> lint` adds no warnings for any touched
  package compared with `base`.
- **Behaviour changes:** every one an upgrade forces is covered by a test
  in the package's existing style. No test is deleted, skipped or loosened
  to make a suite pass.
- **Scope:** the diff touches only the task's listed files and
  `pnpm-lock.yaml`.
- **Clean tree:** no `next-env.d.ts` change and no `AGENTS.md` is
  committed.
- **Version references:** comments and docs that name a version the task
  changed are updated in the touched files.

## Planner notes
- **Plan number:** 015, because 013 (dev dashboard) and 014 (CI per-app
  isolation) exist on other branches.
- **Checks:** validated on 2026-10-20 in a clean worktree at 46883040
  (`/home/jeremy/.cache/plan015-base`, since removed).
  - `main` moved during planning: b90c79c1 added per-app CI isolation and
    46883040 added `apps/dev`. `apps/dev` needs dotenv 18 and jest-dom 7.
    It has no `@testing-library/dom`.
  - Every check exits 0 there.
  - The test loop exits 1 when a theater test fails.
  - The full test loop takes about 105 s.
  - Without the `GIT_CONFIG_*` unset, tdr-code fails 4 tests in
    `scripts/__tests__/git.spec.ts`.
- **Lockfile serialization:** every dependency task edits `pnpm-lock.yaml`,
  so those tasks run one at a time. `parallel: 2` lets the report-only
  tasks (T7, T15) and the human checkpoints overlap with them. It also
  keeps concurrent Jest workers at 4 or fewer.
- **tdr-bot frontend:** `next dev -p <port>` in `apps/tdr-bot` boots in
  under a second with no env vars. `/api/*` is rewritten to
  `localhost:8081`, where nothing listens, so the screenshots stub `/api/**`
  in the browser.
- **Pushing:** `infra/base-images/lilnas-monorepo-builder.Dockerfile` pins
  `turbo@2.11.9`. T1 bumps it, so pushing will trigger CI's `base-images`
  job.
- **Research:** from chat 828546aa-2a3f-411d-85c8-8728d4d75e3c (four
  research agents, 2026-10-20).
  - The ACP SDK 2 package ships `MIGRATION_STABLE_UNSTABLE.md`.
  - The SDK's `ndJsonStream` default `maxMessageBytes` is 32 MiB.
  - msw is used in 4 tdr-code specs, 3 of which define the custom
    unhandled-request strategy.
  - js-yaml is imported in 3 source files and 4 specs.
  - `<<` merge keys appear only in `apps/tdr-bot/deploy.dev.yml`.
  - ACP SDK 2's root export is the stable v1 protocol, built with
    `client()` → `ClientApp` in `dist/v1/acp.d.ts`. `./experimental/v2` is
    the draft v2 protocol and is not used.
  - The `next dev` side effects (`next-env.d.ts` rewritten, `AGENTS.md`
    created) were seen for real at base.
  - Nexus runs each check with `sh -c` (nexus-code
    `packages/server/src/plan-run/commands.ts`), with a 20-minute
    per-command timeout.
  - The agent shell's env sets `GIT_CONFIG_COUNT` with KEY/VALUE 0–11,
    which is why the test check unsets them.
- **dotenv-cli (C1, resolved no_change):** the root still needs dotenv-cli.
  Root `build`/`lint`/`test`/`type-check` run `dotenv -e .env.turbo -- turbo …`,
  and the root `node_modules/.bin/dotenv` is dotenv-cli's. T4 removed it only
  from tdr-code, where dotenv 18's own bin shadows it. The scripts there are now
  `dotenv run -q --`, and that loads the cwd `.env` (checked 2026-10-20). Prod
  tdr-code's `daemon.sh` → `pnpm run start` → `start:frontend` picks this up
  after the user rebuilds.
- **content-disposition header (C2, resolved no_change):** checked
  2026-10-20 in the run tree. Under `@nestjs/platform-express` 12.2.0,
  express is 5.3.0, which uses content-disposition 2.0.1 (`create()`).
  Only an unused express 5.2.1 still pulls in 1.0.0.
  - 1.0.0: `filename="Amélie.mkv"` (raw Latin-1 byte) and `filename="movie.mkv"`.
  - 2.0.1: `filename="Am?lie.mkv"; filename*=UTF-8''Am%C3%A9lie.mkv` and
    `filename=movie.mkv`.
  - CJK names are identical in both versions.
  - Browsers prefer `filename*`, so the saved name is unchanged. `curl -J`
    ignores `filename*` and would save `Am?lie.mkv`.
  - Byte-identical headers would mean keeping the direct `content-disposition`
    1.0.0 pin, which T15's outdated report would flag. If the user wants
    that, revert T12 and pin it.
- **C3 → T17 (added 2026-10-20):** T16's files didn't cover
  `apps/theater/src/components/Scene/Scene.tsx`, which has two stale ecctrl 1
  comments (~156 mouse look, ~183 `camZoomSpeed`). T17 rewrites only those
  comments, after T16 and in parallel with H5.
- **Plan history:** the user simplified it in this chat on 2026-10-20.
  - **H1 removed:** "couldn't you check for me?" T3 and T6 now report
    failed smokes as `defects:`, and the phase review covers batches 1–3.
  - **H4 removed:** the user wants ecctrl 2 done, with no go/no-go. T16
    moved to phase 3 with `after: []`, so H5 shares a wait with H2 and H3.
    T15 runs after it and treats anything outdated except `typescript` as a
    defect.
  - IDs H1 and H4 are retired. Don't reuse them.
- **Open threads with the user:**
  - I offered to drop H3 (the ACP smoke review), since T14 can treat its
    own smoke failures as defects. No answer yet.
  - I offered to drop H5 (the ecctrl play-test). No answer yet; the user
    seemed fine with keeping it.
  - The user asked about H4 again after it was removed. `nexus_run_get`
    showed the draft synced with 19 tasks and no H4, so a reload of the UI
    view should show the current plan.
- **Ruled out:**
  - **typescript 7:** typescript-eslint, ts-jest and the Nest CLI don't
    support it, and `packages/tsc7` already gives TS 7 type-checking.
  - **content-disposition 3:** ESM-only, the Latin-1 header changes, and it
    needs a Jest workaround. The user chose `res.attachment`.
  - **The tdr-dev container for MUI screenshots:** the dev Discord token is
    revoked, so it can't boot. The screenshots use `next dev` with stubbed
    `/api` instead.
- **After landing (the user's call, not in the run):**
  - Pushing deploys and triggers the base-image rebuild.
  - Prod tdr-code keeps the old ACP SDK until the user rebuilds and
    restarts it with the `daemon.sh` recipe (memory
    project_tdr_code_prod_runs_from_dev_checkout).
  - nexus-code pins ACP SDK `^0.22` and would need the same rewrite to move
    to 2.x.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report,
     the rollout record. Humans may add notes here too. -->

### 2026-10-20 · T1 · done
All bumps applied with specifier style kept. @types/three override moved to 0.186.0; lockfile has no 0.185.1 left.
Fresh worktrees need `pnpm turbo run build --filter="./packages/*"` before any app type-check (otherwise @lilnas/utils subpaths are unresolved).
Ran and passing: theater/equations/tdr-bot type-check, equations (408), tdr-bot (1863) and theater (246) suites, lint for equations and tdr-bot, prettier on touched files. Did not run the other packages' suites or the root-wide lint.

### 2026-10-20 · T2 · done
All listed deps re-verified unimported and removed; none had a real import, so none were kept. The `openai` string matches in tdr-bot are provider-id literals. The cli `dotenv` mention is a comment. tdr-bot and tdr-code keep `dotenv`, which they import. `chokidar` and `openai` remain in the lockfile only as transitive deps (@swc/cli, @langchain/core). Type-check, lint and tests pass for cli (159), tdr-bot (1863) and tdr-code (1723). Type-check needs `pnpm turbo run build --filter="./packages/*"` first in a fresh worktree. I did not run the other six packages' test suites or the turbo-wide type-check and lint runs.

### 2026-10-20 · T7 · done
No repo changes and no commit, as the task requires. The tree is clean: next-env.d.ts is reverted and AGENTS.md is deleted.
Harness: ~/.cache/lilnas-plan-015/mui-harness/ (README.md, run.sh, build.mjs, shoot.template.js, cli.config.json, fixtures/*.json).
Reproduce: REPO=<worktree> OUT_DIR=/storage/files/lilnas-plan-015/mui/after PORT=18710 ~/.cache/lilnas-plan-015/mui-harness/run.sh [pages...]
run.sh builds packages/utils (gitignored dist) if missing, boots next dev in its own process group, runs one playwright-cli run-code script per page, stops next dev, reverts next-env.d.ts and deletes AGENTS.md. It exits non-zero on a script error or an un-stubbed /api call.
playwright-cli is not on PATH; run.sh falls back to the copy in ~/.npm/_npx/*/node_modules/.bin (v0.1.22). Override with PWCLI=.
Clock is fixed to 2026-10-20T15:00:00Z; locale en-US, timezone UTC, dark scheme, reduced motion. Emoji CDN images are stubbed with generated SVGs.
Page shots are full-page; dialog/menu/select shots are viewport-sized.
Baseline quirks that exist on MUI 7 and are not harness bugs: the reminders table clips its action buttons at 1440 px; emoji images are block-level (Tailwind preflight); unicode emoji render as tofu (no emoji font on this host).
PNGs: 81 files in /storage/files/lilnas-plan-015/mui/before/, served at https://files.lilnas.io/lilnas-plan-015/mui/before/<page>-<state>-<desktop|mobile>.png.
Pages and states, each in both viewports unless noted:
  root: redirect
  settings: default, nav-menu-open (mobile only), chat-model-select-open, reset-dialog, unsaved, reasoning-model
  transcript: default, details-open, short-thread, empty
  reminders: default, filter-all, filter-missed, no-match, new-dialog, new-dialog-for-open, new-dialog-recurring, new-dialog-recurring-bottom, new-dialog-channel-select-open, edit-dialog, edit-dialog-bottom, test-dialog, test-dialog-sent, cancel-dialog
  emojis: default, filter-pending, filter-deleted, no-match, description-editor, redescribe-dialog, redescribe-all-dialog, reconciling, empty
  playground: default, model-select-open, prompt-draft-open, conversation, conversation-error, reset-dialog, eval-results

No commits: nothing to integrate.

### 2026-10-20 · T3 · done
better-sqlite3 ^13.0.3 and @types/better-sqlite3 ^9.6.0 in auth, download and tdr-code.
allowBuilds decision: removed `better-sqlite3: true` and rewrote the comment. v13 has no install/postinstall script; the N-API prebuilds ship inside the package (prebuilds/), not as a platform package. pnpm install passes under strictDepBuilds. The remaining allowBuilds entries are all `false`.
Release notes (v13.0.0): N-API rewrite, prebuild-install dropped, adds db.explain() and preparedStatement.toString(); no API break touching this repo.
Binding smoke in apps/auth, apps/download, apps/tdr-code: { x: 1 }.
Next standalone: `pnpm --filter @lilnas/auth build` and `next build` in tdr-code both succeed. Neither .next/standalone/ contains better-sqlite3 or its .node binary, as no frontend route imports it (auth src/app has no references; tdr-code proxy.ts only mentions it in a comment); the Nest backends load it from node_modules. The auth build needed the packages built first (`turbo run build --filter="./packages/*"`).
Docker smoke: lilnas-auth:plan015 and lilnas-download:plan015 both built (local base images). better-sqlite3 resolves in each image to /app/node_modules/.pnpm/better-sqlite3@13.0.3/node_modules/better-sqlite3/lib/index.js on node v26.12.0 and the in-memory query returned { x: 1 }. Both tags removed with docker rmi.
Tests (--maxWorkers=2): auth 652, tdr-code 1723, download 6370 (+9 skipped), all passing. Type-check and lint clean for the three apps; `pnpm install --frozen-lockfile --offline` passes. I did not run the other suites or the turbo-wide type-check/lint.

### 2026-10-20 · T4 · done
dotenv is at 18.0.8 (exact) in auth, dev, download, equations, me-token-tracker, tdr-bot, tdr-code and theater. Every dotenv.config call passes quiet: true; the tdr-bot scripts merge it into their existing { path }. live-env.ts untouched. No spec asserts on dotenv output.
Breaking change found beyond the listed call sites: dotenv 18 ships a `dotenv` bin that shadows dotenv-cli's bin in apps/tdr-code. `dotenv -- next dev` printed dotenv 18's usage and exited 1. I changed tdr-code's dev:frontend and start:frontend to `dotenv run -q -- …`, removed the now-unused dotenv-cli devDependency from apps/tdr-code, and updated the dotenv-cli mention in apps/tdr-code/.env.example. No test covers these scripts; only a `dotenv run -q -- echo ok` smoke check. Root package.json still lists dotenv-cli (left alone).
Checks: frozen-lockfile install, package build, type-check and lint pass; test counts match the baseline (593 utils, 159 cli, 652 auth, 408 equations, 246 theater, 1863 tdr-bot, 1723 tdr-code, 203 dev, 6370 + 9 skipped download).

### 2026-10-20 · T5 · done
nanoid 6.0.2 exact in tdr-bot and download. v6 is ESM-only and needs Node >=22, which this repo already meets. The jest allow-lists already compile it. tdr-bot mocks nanoid globally in its setup, so I checked the real package with a temporary spec in both apps and then deleted it.
diff ^9.0.0 in tdr-code. v9's createTwoFilesPatch quotes and octal-escapes special-character file names in the ---/+++ headers, which would have changed the Discord diff output. formatDiff now builds the diff with structuredPatch and formatPatch(OMIT_HEADERS) and writes the two header lines itself, so the output matches v8 (verified against the v8 library for the ASCII cases and the no-hunk case). message-bridge.spec.ts had no formatDiff coverage, so I added specs for edit, new file, unchanged file, and special-character names; no existing assertions were changed.
jest-dom ^7.0.1 in auth, dev, download and tdr-code. The only break is that @testing-library/dom becomes a required peer dependency (and Node >=22). I added @testing-library/dom ^10.4.2 as a devDependency of download and dev. The four setup.ts / setup-dom.ts files needed no change.
Test counts: tdr-bot 1863, tdr-code 1730 (1723 at base plus my 7 new formatDiff specs), auth 652, dev 203, download 6370 (+9 skipped). type-check passes for all packages. lint passes for all packages, run through turbo, with the same output as base.
I did not run the utils, cli, equations or theater test suites, since T5 does not touch them.

### 2026-10-20 · T6 · done
Bumped @oclif/core ^4.8.4 -> ^5.1.9 (installed 5.1.9, engines node>=22; repo is on Node 26).
Typings diff 4.11.14 vs 5.1.9 for Command/Flags/Args/ParserOutput: cosmetic only (import type, Record<>/Array<> rewrites, Example union order); adds Args.option, which this package does not use. this.parse/log/error/exit unchanged. The oclif block in package.json and bin/run.js need no change. No source edits. ci-detect.spec.ts fixture '^4' left alone.
Smoke tests, all exit 0. `pnpm --filter @lilnas/cli build` passes. `node packages/cli/bin/run.js --help` lists all 9 commands (build, completions, down, list, logs, ls, ps, redeploy, up) and 5 topics (ci, mockups, ps, remote, secrets). `secrets --help` lists decrypt and verify. `mockups --help` lists build, list, ls and new. `pnpm exec lilnas --help` from the repo root gives identical output. An unknown command prints "command nosuchcmd not found" and exits 2.
cli type-check, lint (eslint and prettier) and the full cli jest suite (159 tests, --maxWorkers=2) pass. `pnpm install --frozen-lockfile --offline` passes. Tree is clean.

### 2026-10-21 · Phase 1 · review cycle 1
Pass 1 (T1, T2): T1 bumps and T2 removals match the task bodies: specifier styles kept, the @types/three override moved so only 0.186.0 resolves, the turbo pins and docs updated, and re-grepping found no imports of any removed dependency. The lockfile changes are consistent, with @langchain/core's openai peer now on the 7.27.0 copy already in use.
Pass 2 (T3, T4): T3 (better-sqlite3 13 + @types 9, allowBuilds entry removed) and T4 (dotenv 18.0.8 with quiet: true at every listed call site, tdr-code switched from dotenv-cli to dotenv 18's `dotenv run -q`) match their task bodies and notes. No other app script or the root scripts are affected by the new dotenv bin, and the lockfile also prunes an unused @lilnas/utils file: entry. Only two stale-comment notes remain.
Pass 3 (T5, T6): T5 (nanoid 6, diff 9 with a header-preserving formatDiff rewrite plus exact-output specs, jest-dom 7 with @testing-library/dom peers) and T6 (@oclif/core 5) match their task bodies; formatDiff reproduces v8 output including the no-hunk case, and the new specs assert real behaviour. Only a P2 note about orphan lockfile entries.
Seams pass: Seams pass: the tasks agree. dotenv is 18.0.8 everywhere and every config call passes quiet: true; T2's removals of @types/diff and the cli's dotenv match T5's diff 9 bump and the cli's dotenvx-only usage; the better-sqlite3 13, nanoid 6 and @oclif/core 5 specifiers and imports are consistent; no workspace override conflicts with the bumps.
Consolidation: Phase 1's bumps, removals and mechanical majors (T1–T6) match their task bodies and agree across tasks; the four passes found no P0/P1 defects, only three P2 notes: two stale comments about better-sqlite3's removed allowBuilds entry and orphan @lilnas/utils file: entries in the lockfile.

Notes:
- F1 · P2 · allowBuilds comment lists better-sqlite3 among the denied entries — pnpm-workspace.yaml:5
- F2 · P2 · lilnas-dev.Dockerfile comment still points at allowBuilds' better-sqlite3 entry — infra/base-images/lilnas-dev.Dockerfile:13
- F3 · P2 · Orphan @lilnas/utils file: entries in lockfile — pnpm-lock.yaml:3207

### 2026-10-20 · T8 · done
- Only `loadable` was affected. Neither app uses `atomFamily`, `setSelf`, `delay` or `jotai/babel`. tdr-bot only uses `atom`.
- `loadable` is now a typed helper in `apps/dashcam/src/state.ts`, built on `unwrap` from `jotai/utils`. It keeps the `{ state: 'loading' | 'hasData' | 'hasError', data, error }` shape, and the only consumer (`VideoGrid.tsx`) compiles unchanged.
- I checked the helper with a scratch script, since deleted: an async atom goes loading → hasData, and a rejecting one goes loading → hasError.
- jotai 3 gives every entry point a fallback `types` file, so eslint's `import-x/no-duplicates` flagged the paired `jotai` and `jotai/utils` imports in `state.ts` as duplicates. `jotai/vanilla/utils` triggered the same warning. I wrapped those two imports in `eslint-disable import-x/no-duplicates` with an explanatory comment.
- Dashcam lint is back to zero warnings, and `pnpm install --frozen-lockfile --offline` passes.
- The dashcam type-check first failed on a missing `@lilnas/utils/cns` because the worktree's packages weren't built. It passed after `pnpm turbo run build --filter="./packages/*"`.
- I did not run the other plan checks (repo-wide type-check and lint, the other packages' test suites).

### 2026-10-20 · T9 · done
- **Version:** js-yaml is `^5.5.0` (latest); `@types/js-yaml` is gone. v5 ships no CHANGELOG, so I read its README and `dist/js-yaml.d.ts`.
- **Imports:** the three production files and four specs moved off the removed default import. The specs now use `import { load } from 'js-yaml'`.
- **Empty input:**
  - v5 `load('')` throws; for empty, whitespace-only and comment-only content v4 returned `undefined`.
  - New helper `packages/cli/src/utils/yaml.ts` exports `loadYaml(content)`, built on `loadAll`.
  - It returns `undefined` for empty input and still throws on a multi-document stream, as v4 did. `---` or `null` still parses to `null`.
  - `compose.ts` (`extractMountsFromFile`, `resolveIncludedFiles`), `services.ts` (`listInfraServices`) and `ci-detect.ts` (`readYaml`) call it instead of `load`.
  - `empty-yaml.spec.ts` covers each site with three empty variants: `''`, whitespace and comment-only.
- **New file outside the listed ones:** `yaml.ts` and `empty-yaml.spec.ts` are the only additions. I chose a shared helper over copying the empty-input guard into three files.
- **Merge keys (`<<`):** no cli parser can read `apps/tdr-bot/deploy.dev.yml`, so I did not enable them and added no merge-key test.
  - `docker-compose.yml` includes `apps/tdr-bot/deploy.yml` (prod); `docker-compose.dev.yml` is not parsed by any js-yaml call.
  - `getComposeFile` is hardcoded to `docker-compose.yml`, and `ci-detect`'s `composeFile` always takes the default.
  - `ci-detect` also skips `*.dev.yml` includes (`isIgnoredComposeFile`).
  - `listInfraServices` and `listAppServices` parse `docker-compose.yml`'s `include:` or shell out to `docker compose config`.
  - A repo-wide grep found the `<<:` key only in `deploy.dev.yml`, plus a string in `apps/dev`'s `registry.service.spec.ts`. `.github` and infra have none.
- **`dump`/`loadAll`:** the cli had no `dump` or `loadAll` use before this change. `loadAll` appears now, only inside `loadYaml`.
- **Tests and gate:** no existing test was deleted or loosened. The cli suite is 179 tests; the plan's `base` count was 159. cli lint adds no warnings.
- **Not run:** the plan's `turbo` build, `type-check` and `lint` across the repo, and the multi-package test loop.

### 2026-10-20 · T10 · done
cookie 1.1.1 -> 2.0.1 (exact) in apps/theater. Import and call site renamed to parseCookie in auth.service.ts. Semantics unchanged for first-wins on duplicates, decoding and missing names; the returned object is now null-prototype. jest.config.js allow-list now includes cookie (cookie-parser stays ignored). Added 6 tests to auth.service.test.ts (theater now 252 tests). The theater build passes and require('cookie').parseCookie works under Node 26 (require(esm)). The theater build needs packages/* built first (the plan's first check does that). Theater lint, type-check and the full suite were run; the other packages' suites were not.

### 2026-10-20 · T11 · done
msw 2.14.6 -> 3.0.3 (exact) in apps/tdr-code. Removed the `msw: false` allowBuilds entry from pnpm-workspace.yaml because v3 has no install script; `pnpm install` and `--frozen-lockfile --offline` pass under strictDepBuilds.
discordOnlyUnhandledRequestStrategy (3 specs) became discordOnlyUnhandledFrameStrategy: an UnhandledFrameHandle callback that checks `frame instanceof HttpNetworkFrame` (from 'msw/experimental') and a discord.com hostname, then awaits defaults.error() and throws the frame's unhandled message. In v3, defaults.error() only prints and does not fail the request, so the throw is what errors the frame. Returning normally passes the request through to the real network.
The 'error' strategies (guild-gate.spec.ts, discord-directory.service.spec.ts) became onUnhandledFrame: 'error'.
Strategy proof (temporary, restored, not committed): changed the Discord token handler URL in guild-gate.spec.ts to a non-matching path. The callback fired with "intercepted a request without a matching request handler: POST https://discord.com/api/oauth2/token" (captured via a temp file log, since Jest output doesn't show it) and 7 OAuth-callback tests failed. Changed the members handler path in discord-directory.service.spec.ts: the spec failed (ServiceUnavailableException) under 'error'. A first attempt that only altered the query string did not fail, because msw ignores the query when matching. Normal runs pass, so loopback traffic is still bypassed.
Checks: tdr-code full suite 1730 passed (111 suites) with GIT_CONFIG_* unset and --maxWorkers=2; type-check, lint (0 warnings/errors) and prettier clean. The other packages' suites were not run.

### 2026-10-20 · T12 · done
The plan's premise was wrong: the express in play is 5.3.0, which resolves content-disposition 2.0.1 (express 5.2.1, used elsewhere in the lockfile, uses 1.0.0). So res.attachment does change header bytes versus content-disposition 1.0.0:
- `Amélie.mkv`: was `attachment; filename="Amélie.mkv"`, now `attachment; filename="Am?lie.mkv"; filename*=UTF-8''Am%C3%A9lie.mkv`
- plain token names are no longer quoted, e.g. `attachment; filename=a.mkv`
- names with spaces/parens (`A video.mp4`) and the CJK name are byte-identical to before
I accepted this (2.x is the more correct form for Latin-1; browsers use filename*) and asserted the new strings in the spec. The spec's fake response wraps express's real attachment/set/type, loaded via require.resolve through @nestjs/platform-express, since express is not a direct dep of apps/download.
Content-Type: verified send leaves an existing Content-Type alone, and the type for mkv/mp4/m4v/avi/srt is identical with and without res.attachment (video/x-matroska, video/mp4, video/x-m4v, video/x-msvideo, application/x-subrip), so no explicit header was added. Object branch keeps the explicit Content-Type after res.attachment; a test fails if the order is swapped.
Checks run: apps/download type-check, lint and full suite (6377 passed, 9 skipped; +7 new tests over base 6370).

### 2026-10-21 · Phase 2 · review cycle 1
Pass 1 (T8, T9, T10, T11): T8–T11 look correct: the dashcam loadable keeps its shape, loadYaml keeps js-yaml 4's empty-input behaviour at all four call sites with tests, the parseCookie rename keeps first-wins and decoding, and the msw onUnhandledFrame strategies still fail unhandled Discord traffic (the 'error' string rejects; the callback throws). The lockfile change of @lilnas/cli from file: to link: is pnpm no longer injecting a copy once js-yaml stopped diverging, consistent with packages/utils, so it is not a defect.
Pass 2 (T12): T12 cleanly replaces content-disposition with res.attachment: the object branch keeps the explicit Content-Type after attachment (tested), the disk-branch type comes from a fileName that is path.basename of the served path (so it matches what sendFile would pick), and the spec wraps express's real attachment/set/type with exact header assertions. The lockfile also drops an orphaned @lilnas/utils@file entry that nothing references; frozen install passes.
Seams pass: Seams pass: the only export-level change is T9's new loadYaml helper in packages/cli, and all its callers are in the same task's package. T8, T10, T11 and T12 touch separate packages, and the shared pnpm-workspace.yaml and lockfile edits don't conflict. No seam disagreements found.
Consolidation: Phase 2 (T8–T12) looks clean across all three passes, with two P2 notes: the Content-Disposition header bytes changed under express's content-disposition 2.0.1, and the theater inherited-keys cookie test can't fail. The seams pass found no disagreements between tasks.

Notes:
- F4 · P2 · Content-Disposition bytes changed, contrary to the plan's rationale — apps/download/src/download/download.controller.ts:1009
- F5 · P2 · Inherited-keys cookie test cannot fail — apps/theater/src/auth/__tests__/auth.service.test.ts:132

### 2026-10-20 · T13 · done
MUI 9.5.0 in apps/tdr-bot; emotion peers already met, no bump.
Codemod: the published @mui/codemod CLI crashes on Node 26 (yargs.command is not a function), so I ran the v9.0.0/system-props transform through jscodeshift directly. It also reformatted non-UI .ts files; those were reverted. The codemod missed fontFamily/fontSize inside slotProps (FormControlLabel typography, ListItemText primary/secondary) and two dynamic Typography color props using palette paths (settings page status text, transcript sender label); fixed by hand into sx.
nativeButton={false} added to the AppShell nav Button and MenuItem (both component={Link}). ListItemButton, IconButton, clickable Chips need nothing. theme.ts, Provider.tsx and Grid need no change.
Verified: type-check, lint, 1863 tdr-bot tests, next build, frozen-lockfile install. I did not rerun the plan's full check list.
Screenshots: 81 after shots in /storage/files/lilnas-plan-015/mui/after/, index at https://files.lilnas.io/lilnas-plan-015/mui/index.html. 74/81 pairs pixel-identical.
Remaining diffs: the selected row of the chat model select when open (settings and playground, desktop and mobile; 4 shots) is dimmer, because v9 no longer paints the focus-visible tint on the selected option when the menu is opened by pointer; the emojis reconciling shots (2) differ in spinner rotation phase; emojis-filter-deleted-mobile differs in logo avatar anti-aliasing only.

### 2026-10-20 · H2 · approved
Approved.

### 2026-10-20 · T14 · done
@agentclientprotocol/sdk ^0.15.0 -> ^2.0.0 (2.0.0 is the latest 2.x). Uses the stable root
entrypoint only (no /unstable, no experimental/v2). Everything tdr-code uses
(usage_update, session_info_update, configOptions) is in the stable v1 schema.

- createAcpClient now returns an unconnected ClientApp. spawnAndConnect calls
  .connect(ndJsonStream(..., { maxMessageBytes: ACP_MAX_MESSAGE_BYTES })). ManagedSession.connection
  is a ClientConnection, and every call goes through connection.agent.request/notify(methods.agent...).
- Size limit is 64 MiB (rationale in the comment). handleConnectionClosed listens on
  connection.signal. On MessageTooLargeError it logs `acp-connection-failed` and tears down
  an idle session. Mid-turn or mid-setup, the SDK's rejection of the pending request drives
  the existing prompt-error or setup-kill path, so there is exactly one teardown. Normal EOF is
  left to proc exit handlers.
- resolvedModel now comes from the `model`-category configOptions select. The old
  result.models was always undefined: claude-agent-acp 0.59 doesn't send it (checked in its
  dist and on the wire). So session_created.context.resolvedModel goes from null to e.g.
  'sonnet'. Covered by two new tests.
- Behaviour kept: isReplaying gate, ExitPlanMode callback, permission auto-resolve, idle
  timers, PGID bookkeeping, teardown on errors, initResult capability logging. fs/terminal
  capabilities are still advertised with no handlers registered, same as 0.15 (Method Not
  Found). In the smoke run Write still went through the agent's own tools.
- Files outside the listed set, both needed by the change:
  - src/logging/log-events.ts: one new slug, acpConnectionFailed. Every error log needs a
    registered event.
  - src/agent/__tests__/acp-client.spec.ts: a local adapter over setup.ts's recording client()
    mock, plus one registration test. The existing test bodies are unchanged.
- The per-file SDK mocks in config.spec and service.test were removed. They now use setup.ts's
  global mock, like service.spec already did.
- Smoke (claude-agent-acp@^0.59.0 via npx, scratch cwd, real Claude login), all PASS:
  1. initialize: protocolVersion 1, image and loadSession capable.
  2. newSession: id returned, model config option 'sonnet'.
  3. prompt: end_turn, 4 agent_message_chunks plus usage_updates.
  4. Write-tool permission auto-approved via the handler (optionId allow_always), file written.
  5. cancel mid-stream after 34 chunks: stopReason cancelled.
  6. loadSession in a fresh process: 10 replayed updates hit isReplaying()=true, 0 reached
     handlers; afterwards the agent recalled "smoke test ok".
  The smoke stubbed getBackendLogger via tsconfig paths, because the real transport writes
  to /tmp/tdr-code. Scratch dirs and ~/.claude/projects/-tmp-plan015-acp-smoke-cwd deleted.
- All four checks exit 0. tdr-code has 1738 tests: the 1730 that were already there
  plus 8 new ones.

### 2026-10-20 · H3 · approved
Approved.

### 2026-10-20 · T16 · done
ecctrl 1.0.97 -> 2.0.2 (exact; still the newest 2.x). ecctrl 2 is a different library:
- no camera at all (it only reads camera.getWorldDirection to orient WASD)
- no KeyboardControls reading; input only arrives via handle.setMovement()
- `enable={false}` returns from its useFrame on the first line
- applyDynamicGravity re-sets gravityScale every awake frame (0 on ground)
- run defaults to toggle (enableToggleRun)
- no sprintJumpMult
Player.tsx now:
- feeds useKeyboardControls() into setMovement every frame (all-false while frozen)
- owns a first-person camera: body.translation() + 0.3 m eye offset, yaw/pitch from firstPersonLook.ts
- mouse look is gated on pointer lock AND not-frozen; on the unfreeze edge it re-seeds the look from the camera's actual direction, so stand_up -> standing has no snap
- freeze logic (gravityScale 0 + zero velocity every frame) kept; `enable={!frozenState}` replaces disableControl/disableFollowCam
- tuning pinned to 1.0.97 values: capsule 0.35/0.3, floatHeight 0.3 (still rests centre 0.95 m up), maxWalkVel 2.5, maxRunVel 5, enableToggleRun false, jumpVel 2.5 (x1.2 while Shift held via a run-key selector), fallingGravityScale 2.5; acc/dec stay at 2.0 defaults
@types/three override and its comment removed from pnpm-workspace.yaml: ecctrl 2 has no @types/three dep; lockfile has a single @types/three@0.186.0 (maath and stats-gl take it as a peer).
Checks all exit 0. Tests: utils 593, cli 179, auth 652, equations 408, theater 261 (+9 new), tdr-bot 1863, tdr-code 1738, dev 203, download 6377 (+9 skipped). Theater build OK. No next-env.d.ts or AGENTS.md committed.
Browser-verified (GPU Chromium, 60 FPS, local backend):
- walk ~2.5 m/s, run ~5 m/s, jump ~0.25-0.3 m
- mouse look steers W
- iPad freezes movement and look; after close the heading is kept and pointer lock restored
- sit: claimed via E, body moved 0.000 m while seated
- stand: camera returned to the exact pre-sit eye point, 0.000 deg turn per frame across the hand-off, first mouse move after standing turned exactly 0.002 rad/px
H5 manual script:
1. Open /?debug, enter the theater. Expect pos ~2.19,1.15,-3.62 facing the screen end. Click the canvas: mouse look; scroll does not zoom.
2. Hold W/S/A/D: ~2.5 m/s relative to view; stops within ~0.5 s on release.
3. Shift+W: ~5 m/s while held; release Shift to walk.
4. Space: ~0.3 m hop (a bit higher with Shift). Pitch stops just short of straight up/down.
5. Tab: iPad opens, pointer freed; W/Space/mouse do nothing; typing "w" in its search box doesn't move you. Tab or Esc closes it: view unchanged, W walks the same way.
6. Walk up the right aisle to the front row, look left/down at an end seat until "Press E to sit" shows, press E: camera eases ~4.5 s to the seat facing the screen; look clamped to ~±75° yaw / ±45° pitch; W/Space inert.
7. E again: ~2.8 s ease back to where you stood, keeping the seated view direction; no jump at the hand-off; mouse and W continue smoothly from there.
8. Repeat sit -> stand -> sit with mouse movement while seated; expect no snaps.
9. Respawn: clip out of the map; below y=-2 you reappear at spawn.
Unconfirmed / accepted differences:
- OOB/NaN respawn not reproduced live (code unchanged, unit tests pass); the 1.0.97 "smaller capsule -> NaN" finding was not re-tested on 2.0
- acceleration/deceleration feel uses 2.0's new model
- holding Space no longer auto-repeats jumps (2.0 requires a re-press)
- pitch now clamps at the limit instead of rejecting the whole step
- 1.0.97's drag-to-look without pointer lock and touch-drag look are dropped
- pressing E while walking can leave up to one physics step (~4 cm) between standingReturnPos and the body on stand
- LocalPresence EYE_TO_FEET_HEIGHT_M (1.3) is ~5 cm more than the real 1.25 m; documented in its comment, value unchanged
- headless WebGL logged MeshDistanceMaterial shader errors under ANGLE GL-EGL; pointlight-shadow/driver related, not ecctrl

### 2026-10-20 · T17 · done
Comment-only change in Scene.tsx; no code touched. Rewrote the requestLook comment to credit Player.tsx's mousemove listener, and the wheel-listener comment to drop the camZoomSpeed/ecctrl-zoom claim (ecctrl 2 has no wheel handler; nothing else in apps/theater/src listens for wheel). No other ecctrl 1 claims in Scene.tsx. `pnpm --filter @lilnas/theater lint` and prettier pass.

### 2026-10-20 · H5 · approved
Approved.

### 2026-10-21 · Phase 3 · review cycle 1
Pass 1 (T13): T13 bumps tdr-bot to MUI 9.5.0. The system-props hunks move each prop into sx with the same value, and nativeButton={false} is on the only two component={Link} uses (the AppShell nav Button and MenuItem). Two P2 notes: lockfile entries nobody references, and no test for the nativeButton change because the package has no UI tests.
Pass 2 (T14): T14's move to ACP SDK 2 looks correct and complete: client-app handler registration, spawnAndConnect wiring, the 64 MiB message cap with a documented reason, connection-close teardown, and resolvedModel from configOptions, all with matching tests. SDK 2's stream internals could not be checked locally because 2.0.0 isn't installed in this worktree. Only P2 notes.
Pass 3 (T16, T17): T16 replaces ecctrl 1.0.97's built-in follow camera with a camera placed in Player.tsx. It adds a pure firstPersonLook module with tests, keeps the old capsule and movement tuning, and drops the @types/three override, which still leaves one @types/three version in the lockfile. T17 is a comment-only fix that matches the new code. No defects found. The worktree's node_modules still has ecctrl 1.0.97, so the claims about ecctrl 2.0's internals (the loop returning when enable is false, setMovement as the only input path, jumpVel re-read each frame) could not be checked against its source. The H5 play-test covers them.
Seams pass: Seams pass: the cross-task exports (ACP_MAX_MESSAGE_BYTES in tdr-code, and firstPersonLook.ts used by Player.tsx and SeatedCamera.tsx) agree with every consumer. T17's rewritten Scene.tsx comments match T16's new Player.tsx mousemove listener, and no wheel listener remains. T13's MUI changes are self-contained.
Consolidation: Phase 3 (MUI 9 in tdr-bot, ACP SDK 2 in tdr-code, ecctrl 2 in theater) has no P0 or P1 findings across the four passes. The four distinct P2 notes are: two silently ignored connection failures and an unrestored test spy in tdr-code, and two unreferenced lockfile entries plus an untested nativeButton change in tdr-bot.

Notes:
- F6 · P2 · Non-size-limit connection failures are ignored silently — apps/tdr-code/src/agent/session-manager.service.ts:1662
- F7 · P2 · process.kill spy is never restored — apps/tdr-code/src/agent/__tests__/session-manager.service.spec.ts:2547
- F8 · P2 · Unreferenced @lilnas/utils file: entries added to the lockfile — pnpm-lock.yaml:3159
- F9 · P2 · No test for the nativeButton={false} change — apps/tdr-bot/src/components/AppShell.tsx:83

### 2026-10-20 · T15 · done
Report only; nothing changed or committed. Tree clean (no next-env.d.ts diff, no AGENTS.md).
- pnpm turbo run build --concurrency=2: exit 0, 14/14 tasks successful (4 cached): utils, media, muapi, cli, auth, equations, me-token-tracker, dev, theater, tdr-bot, tdr-code, download, portal, dashcam. Only warning: a Node DEP0005 Buffer() deprecation in portal's next build; the build still passed.
- node packages/cli/bin/run.js --help: exit 0 (@lilnas/cli/0.2.0, node v26.11.1).
- pnpm outdated -r: only typescript (dev) 6.0.3, latest 7.0.2 (intentional). Dependents: auth, cli, dev, download, theater, utils, lilnas.
No defects.

No commits: nothing to integrate.

### 2026-10-20 · Final report
All 19 tasks are integrated on `chore/dependency-upgrade`, and every human checkpoint (H2, H3, H5) is approved. The phase reviews found no P0 or P1 defects. Nothing is pushed or deployed. The open items are P2 notes and two decisions for the user (see Open questions).

Task outcomes:
- T1 · patch and minor bumps · done · `8ea9dd3e`
- T2 · remove unused dependencies · done · `5df17066`
- T3 · better-sqlite3 13 · done · `b2ec18a4`
- T4 · dotenv 18 with `quiet: true` · done · `927fb4a2`
- T5 · nanoid 6, diff 9, jest-dom 7 · done · `574dd75c`
- T6 · @oclif/core 5 · done · `54b9c703`
- T7 · MUI baseline screenshots · done · no commit
- T8 · jotai 3.0.1 · done · `2a77e94b`
- T9 · js-yaml 5 · done · `b5e0e98d`
- T10 · cookie 2 in theater · done · `497c2723`
- T11 · msw 3 in tdr-code specs · done · `82314202`
- T12 · content-disposition replaced with `res.attachment` · done · `830d292c`
- T13 · MUI 9.5 in tdr-bot · done · `04c850d9`
- H2 · MUI before/after screenshot review · approved
- T14 · ACP SDK 2.0.0 in tdr-code · done · `abfbc197`
- H3 · ACP SDK 2 real-agent smoke review · approved
- T16 · ecctrl 2.0.2 in theater · done · `302ef530`
- H5 · ecctrl 2 hands-on play-test · approved
- T17 · stale ecctrl comments in `Scene.tsx` (added mid-run by C3) · done · `017abd00`
- T15 · full build sweep and outdated report · done · no commit

Deviations from the plan:
- T12: the plan's premise was wrong. Express 5.3.0 resolves content-disposition 2.0.1, not 1.x. Latin-1 names now send an ASCII fallback plus `filename*` (`Am?lie.mkv`), and plain token names lose their quotes. Browsers save the same name. The planner accepted this (C2, resolved `no_change`). The user's `res.attachment` decision was made on the old premise, so it needs their confirmation.
- T13: the published `@mui/codemod` CLI crashes on Node 26. The v9.0.0 system-props transform ran through jscodeshift directly. It also reformatted non-UI `.ts` files, and those were reverted.
- T14: the message cap is 64 MiB, above the SDK's 32 MiB default, with the reason recorded in code.
- T16: ecctrl 2 is a different library. It has no camera and no keyboard reading, so `Player.tsx` now owns the follow camera and mouse look, through a new `firstPersonLook` module. Holding Space no longer auto-repeats jumps, and drag-to-look without pointer lock is dropped. The H5 notes list the rest.
- T15: `typescript` stays at 6.0.3 as decided. The only outdated entry is 7.0.2, which is intentional.
- T15: the portal Next build passes but prints a Node DEP0005 `Buffer()` deprecation warning.

Unfixed review findings (all P2, none fixed in the run):
- F1 · `pnpm-workspace.yaml:5` · stale allowBuilds comment. The current comment has been reworded, so this looks resolved. Not re-verified.
- F2 · `infra/base-images/lilnas-dev.Dockerfile:13` · the comment still points at the better-sqlite3 entry in allowBuilds, which T3 removed. Still present.
- F3 and F8 · `pnpm-lock.yaml` · `@lilnas/utils@file:packages/utils` entries that no importer references. Still present at lines 3158 and 12221.
- F4 · `apps/download/src/download/download.controller.ts:1009` · the Content-Disposition byte change from T12. Accepted by the planner, not confirmed by the user.
- F5 · `apps/theater/src/auth/__tests__/auth.service.test.ts:132` · the inherited-keys cookie test cannot fail, because `verifySessionCookie` only reads `theater_session`.
- F6 · `apps/tdr-code/src/agent/session-manager.service.ts:1662` · connection failures other than the size limit are ignored between turns, with no log and no teardown.
- F7 · `apps/tdr-code/src/agent/__tests__/session-manager.service.spec.ts:2547` · the `process.kill` spy is never restored.
- F9 · `apps/tdr-bot/src/components/AppShell.tsx:83` · no test for the `nativeButton={false}` change. tdr-bot has no component tests, so only the screenshot harness covers it.

Skipped or partial work: none. T7 and T15 are report-only and made no commit.

Open questions:
- Keep the T12 header change, or pin `content-disposition` 1.0.0 to restore the old bytes? If the user wants the old bytes, revert T12 and pin.
- Should F2 to F9 become follow-up tasks, or stay as notes?
- Pushing deploys to production and triggers the base-image rebuild, because T1 bumps the turbo pin in `lilnas-monorepo-builder`. Prod tdr-code keeps the old ACP SDK until it is rebuilt and restarted with the `daemon.sh` recipe.
- nexus-code pins ACP SDK `^0.22` and would need the same rewrite to move to 2.x.
- TypeScript 7 stays deferred until 7.1 is stable. The 7.1 beta shipped on 2026-10-20.

### 2026-10-20 · Landed
Squash-merge of `chore/dependency-upgrade` into `main` as `chore(deps): upgrade dependencies across the monorepo`, authored as Jeremy Asuncion.
