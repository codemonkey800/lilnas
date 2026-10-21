---
nexus-plan: 2
title: Per-app isolation in CI — one red app no longer blocks the others
branch: ci/per-app-isolation
base: main
setup:
  - pnpm install --frozen-lockfile
checks:
  - pnpm --filter @lilnas/cli lint
  - pnpm --filter @lilnas/cli type-check
  - pnpm --filter @lilnas/cli exec jest --maxWorkers=2
  - for f in scripts/deploy/*.sh scripts/ci/*.sh; do [ -e "$f" ] || continue; bash -n "$f" || exit 1; done
  - docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12
parallel: 2
review: per-phase
commit-style: 'conventional with scope, e.g. feat(cli): …, ci: …, test(cli): …, docs: …; every task ends by committing with the /commit skill'
---

# Per-app isolation in CI — one red app no longer blocks the others

## Goal

In `.github/workflows/ci.yml` a failing test, lint, type-check or image build
for one app blocks the image build and deploy of every other app: `build-images`
and `deploy` gate on the result of whole matrix jobs, and a matrix job counts as
failed when any one leg fails (the theater tests did exactly that in session
f063d50f). Make the gate per app: each image build checks only the packages it
runs (its own package plus the runtime workspace deps that have checks), and the
deploy pulls / ups / force-recreates only the services of apps whose checks and
build passed; a held-back app keeps running its old image. Also test the
dependents of a changed shared package, and lint / type-check packages that have
no test script. `docs/deploy.md` describes the result. Out of scope: tracking a
deployed sha per image, restructuring into one lane per image, any change to the
host-side deploy scripts, any `docker compose` command against the production
project from this checkout, and any dispatch of `ci.yml` from the run branch.

## Decisions

- **detect gives each `ImageBuild` a `gates: string[]`** — its runtime input
  dirs (`runtimeInputDirs()`, i.e. itself plus transitive `dependencies`) that
  are check packages in this run. The build leg and the deploy read those.
- **`testPackages` becomes `checkPackages`** (Jeremy, 2026-10-20): packages with
  any of `test`, `lint`, `type-check` scripts, so `apps/portal`, `apps/dashcam`,
  `apps/me-token-tracker` and `packages/media` are now linted and type-checked,
  and a lint error there holds back that app's image. Expanded to dependents:
  a package is checked when it or any transitive runtime dep changed.
- **One `check` matrix job replaces `test` and `lint-and-typecheck`**, so each
  package installs and builds its deps once. A green leg uploads a `pass-<pkg>`
  marker artifact; a green build leg uploads `built-<image>`.
- **Build legs gate themselves; `build-images` and `deploy` ignore
  `needs.check.result` / `needs.build-images.result`.** A leg whose gates are
  missing skips cleanly (green) and writes a summary line. GitHub cannot make one
  matrix leg depend on another job's single leg, hence the marker artifacts.
- **Deploy filters by marker.** Services of an image with a missing `pass-*`
  gate or no `built-*` marker are dropped from `pull`, `up` and `forceRecreate`.
  `--decrypt` is dropped too when every service whose env file changed is held
  back (Jeremy, 2026-10-20; detect reports `decryptServices`). A `full` plan with
  everything green still sends `--full`; a `full` plan with anything held back
  degrades to explicit lists plus `--decrypt`.
- **Deploy base stays simple.** `summary` is red whenever any leg fails, so
  `scripts/ci/last-deployed-sha.sh` does not advance; the next push diffs from
  the older base and rebuilds and redeploys apps that already shipped —
  redundant but idempotent, accepted. Ruled out: a deployed sha per image or
  service (GHCR `org.opencontainers.image.revision` labels, host state files).
- **Still coupled on purpose.** A failed `base-images` job blocks every image
  and the deploy. A broken shared package holds back every image that depends
  on it at runtime. PR behaviour is unchanged: the single `summary` check goes
  red on any failure.
- **No live dispatch from the run branch** (Jeremy, 2026-10-20): any `ci.yml`
  change plans `full`, and a dispatch would push every app and base image as
  `:latest` from the branch. Proof is the unit tests over the scripts and the
  workflow shape, plus actionlint; the first real run is the push to `main`.
- **Gate logic lives in `scripts/ci/*.sh`, tested from `packages/cli`**, the
  pattern plan 012 set (`ci-cancel-superseded-runs.spec.ts`).

## Context

- pnpm monorepo; the workflow is `.github/workflows/ci.yml` (660 lines at base).
  Jobs today: `detect` → `test` + `lint-and-typecheck` (matrices over
  `testPackages`) + `base-images` → `build-images` (matrix over `images`) →
  `deploy` (SSH to the host, `environment: production`, its own `concurrency`
  group) → `summary` (the required check, red on any failure/cancel). `detect`
  runs `pnpm --silent lilnas ci detect --json --base … --head …` and writes
  outputs with `jq` (`images` is trimmed to scalar matrix keys because matrix
  `include` values must be scalars). `inputs.*` is empty on push/PR events.
- Plan logic: `packages/cli/src/utils/ci-detect.ts` (pure; `detect()`,
  `listImages()`, `listTestPackages()`, `readWorkspacePackages()`,
  `runtimeInputDirs()`), CLI wrapper `packages/cli/src/commands/ci/detect.ts`
  (`printSummary` lists every field). Spec
  `packages/cli/src/utils/__tests__/ci-detect.spec.ts` builds a temp fixture
  repo (compose tree + package.json files) in `beforeAll` and asserts whole
  result objects (`EMPTY`, `ALL_TEST_PACKAGES`); extend that fixture, don't
  make a second one.
- Workflow tests: `packages/cli/src/utils/__tests__/ci-workflow-base.spec.ts`
  loads `ci.yml` with js-yaml, finds the `detect` job's step named exactly
  `Detect changes`, slices its `run` up to `\nesac`, and runs it with
  `bash -eo pipefail` in a temp git repo; `ci-cancel-superseded-runs.spec.ts`
  asserts the `Cancel superseded runs` step and `permissions.actions == 'write'`
  on `detect`, and runs `scripts/ci/cancel-superseded-runs.sh` with a stub `gh`
  first on `PATH`. Keep those step names, the `case … esac` block and the job
  name `deploy` (`cancel-superseded-runs.sh` looks for it) intact.
- Shell scripts: `#!/usr/bin/env bash`, `set -euo pipefail`, mode 0755, usage
  on bad args with exit 2, style of `scripts/ci/last-deployed-sha.sh`.
- Run checks from the repo root: `pnpm --filter @lilnas/cli lint` (eslint +
  prettier), `pnpm --filter @lilnas/cli type-check`,
  `pnpm --filter @lilnas/cli exec jest --maxWorkers=2` (5 suites, 129 tests,
  ~2 s at base; never run the whole monorepo's jest — it OOMs the host),
  `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12` (shellcheck
  on inline `run:` blocks; passes at base).
- Artifacts: `actions/upload-artifact@v7` (rejects `/` in names: slug a package
  dir as `${PACKAGE//\//-}` → `apps-theater`) and `actions/download-artifact@v8`.
  Gotcha: with `pattern:` and `merge-multiple: false`, download v8 puts each
  artifact in `<path>/<artifact-name>/` **except** when exactly one artifact
  matches, which lands in `<path>/` directly. So every marker is an empty file
  named exactly like its artifact (`pass-apps-theater`, `built-tdr-bot`) and is
  downloaded with `merge-multiple: true` into one flat dir. A pattern matching
  nothing is not an error. Download markers into `$RUNNER_TEMP/markers`, never
  into the checkout (it is the docker build context).
- **This machine is production.** Never run `docker compose up/down/restart/pull/--build`
  against the `lilnas` or `lilnas-dev` project, never dispatch `ci.yml`, never
  print `.env.keys` or any `.env.prod` / `.decrypted` file. Agents have no sudo.

## Done means

Implemented as each task says; `packages/cli` tests cover every case the task
names and pass; all `checks:` pass (actionlint with shellcheck included); no
task ran a compose lifecycle command against `lilnas`/`lilnas-dev`, dispatched
`ci.yml`, or pushed the branch; `ci.yml` still handles the `dry_run`, `full`,
`base` and `build_base_images` dispatch inputs and keeps the Turbo remote cache
env on the `check` job; `docs/deploy.md` matches the final workflow behaviour;
every task's work is committed with the `/commit` skill.

## Planner notes

- Verified at base 2026-10-20: cli lint, type-check, jest (129 tests),
  actionlint 1.7.12 all pass. Latest tags: upload-artifact v7.0.2,
  download-artifact v8.0.2. download v8 source: one matching artifact →
  files land in `path` directly (`artifacts.length === 1` branch); zero matches
  only throws for `artifact-ids`.
- Real repo: images `auth dashcam dev-idle-reaper download equations l4d2
me-token-tracker portal tdr-bot theater`; packages with a `test` script
  `apps/{auth,download,equations,tdr-bot,tdr-code,theater} packages/{cli,utils}`;
  lint+type-check only: `apps/{dashcam,portal,me-token-tracker} packages/media`.
  `apps/dev-idle-reaper` and `l4d2` have no package.json → no gates, always build.
- Ruled out: tracking deployed sha per image; one check+build lane per image
  (re-tests shared packages); a dry-run dispatch from the branch (pushes
  `:latest` images from the branch, as plan 012's T4 showed for base images).
- Plan 013 lives on the `feat/dev-dashboard` worktree, hence 014 here.

## Log

<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report,
     the rollout record. Humans may add notes here too. -->

### 2026-10-20 · T1 · done
- `testPackages` and `listTestPackages` are removed with no alias. `.github/workflows/ci.yml` still reads `testPackages` at lines 68, 184, 203, 216, 227, 298 and 309. It must switch to `checkPackages`; this task did not touch it.
- `gates` is filled by `detect()`. `listImages()` returns `gates: []`.
- `gates` for an image is `runtimeInputDirs(dirname(dockerfile))` ∩ the plan's `checkPackages`, sorted.
- Under `full` the intersection is with all check packages.
- `decryptServices` includes only services whose encrypted env file changed (service-level or include-level `env_file`). A plain non-encrypted env_file change does not add to it.
- The `ci detect` summary prints images as `name(gate gate)`, or just `name` when gates is empty. It also prints `decryptServices` and `checkPackages`.
- In the spec fixture, `packages/media` now has lint and type-check scripts, making it a check package alongside `packages/eslint`.

### 2026-10-20 · T2 · done
- The task's all-markers example expects `--up storage,tdr-bot-db` from a PLAN with up `[tdr-bot-db, storage]`, but also says "lists stay in PLAN order". I followed the explicit rule (and the old ci.yml `join(",")` behaviour), so the output is `--up tdr-bot-db,storage` and the spec asserts that. If a reordering was intended, say so; I don't think it was.
- `deploy-command.sh` also exits 2 when `SHA` is unset or when `PLAN` is not a JSON object (the old step never validated either). It does not need `GITHUB_OUTPUT`: the workflow step captures stdout, so an empty stdout means nothing to deploy.
- When an image is held back for both reasons, the summary reason is "checks failed or missing: a, b; image not built". The services column is the services joined with ", ".
- Held-back services come from `images[].services`. They are removed from pull, up and forceRecreate by exact name, and `decryptServices` is filtered the same way before the decrypt decision.
- Under `full` with something held back, the command falls back to explicit lists with `--decrypt` and no `--full`, as specified.
- Usage: `PLAN=<json> SHA=<sha> [DRY_RUN=true] [INPUT_FULL=true] [GITHUB_STEP_SUMMARY=<file>] scripts/ci/deploy-command.sh <markers-dir>`, and `scripts/ci/gate-check.sh <markers-dir> [<package-dir>…]`. In the workflow, markers go in `$RUNNER_TEMP/markers`, and PLAN must carry `images[].{name,services,gates}`, which the detect output has to preserve in full, not the trimmed matrix form.

### 2026-10-20 · T3 · done
- `test` and `lint-and-typecheck` are replaced by one `check` matrix job. Its last two steps run only if every earlier step passed: they write and upload the `pass-<slug>` marker.
- The tests step in `check` now runs only when `package.json` has a `"test"` script. Otherwise it prints "No test script found", like lint and type-check.
- `build-images` has a `Check gates` step (`id: gates`). Every step after it, including the `built-<name>` marker write and upload, has `if: steps.gates.outputs.ok == 'true'`.
- A held-back image gets a `::warning::` and a `## Held back` line in the step summary. Missing packages are joined with ", ".
- `deploy` sparse-checks out `scripts/deploy` and `scripts/ci`, downloads markers with `pattern: '{pass,built}-*'` (the brace pattern), and builds its command with `scripts/ci/deploy-command.sh`. `PLAN` is `needs.detect.outputs.plan`, the whole detect JSON minus `changedFiles`.
- I could not confirm that `download-artifact@v8` accepts the brace pattern. If it doesn't, split it into two download steps. actionlint can't catch this, so it only shows up on a real run.
- `detect` now outputs `full`, `baseImages`, `checkPackages`, `plan` and a scalar-only `images` matrix with `gates` as a space-joined string. The `## Plan` table has a `decryptServices` row and shows gates per image as `name(gate gate)`.
- `ci-workflow-shape.spec.ts` uses the literal YAML string `steps.gates.outputs.ok == 'true'` (no `${{ }}`) for the per-step gate check.
- `docs/deploy.md` is not updated. The plan says it must match the final workflow, so a later task needs to cover it.

### 2026-10-20 · T4 · done
Docs-only change. I read ci.yml, gate-check.sh and deploy-command.sh before writing, and the doc matches them.
Carried over from T3: download-artifact@v8 accepting the brace pattern '{pass,built}-*' in the deploy job is unconfirmed. If a real run shows it doesn't, split it into two download steps.

### 2026-10-20 · Phase 1 · review cycle 1
T1–T4 match their task bodies and agree at the seams: marker names line up across check, build-images and deploy-command.sh, gates and checkPackages are computed as specified, the decrypt and full fallbacks are right, and the docs match the workflow. Only one P2 note, about re-runs.

Notes:
- F1 · P2 · Marker uploads may conflict on a workflow re-run — .github/workflows/ci.yml:517

### 2026-10-20 · Final report
- T1 · detect: checkPackages, per-image gates, decryptServices · done · `74c3aa7f`
- T2 · scripts/ci: gate-check.sh and deploy-command.sh with tests · done · `93c1acce`
- T3 · ci.yml: check matrix, per-leg gates, marker-filtered deploy · done · `04474b70`
- T4 · docs/deploy.md: partial deploys, gates, check packages · done · `976ee7fa`
- Review cycle 1 (phase 1) came back clean: T1–T4 match their task bodies, and the markers, gates and fallbacks agree across the workflow, scripts and docs.
- Verified after integration: `ci.yml` has no `testPackages` references left, and it reads `checkPackages`.
- Deviation (T2): `--up` lists stay in PLAN order, so the output is `--up tdr-bot-db,storage`. The task's example expected `storage,tdr-bot-db`. I followed the explicit rule. Open question: confirm that this is the intended order.
- Deviation (T2): `deploy-command.sh` also exits 2 when `SHA` is unset or `PLAN` is not a JSON object. The old step did not validate either.
- Deviation (T3): `test` and `lint-and-typecheck` are merged into one `check` matrix job. The tests step runs only when a package has a `test` script.
- Unconfirmed (T3, carried through T4): `download-artifact@v8` accepting the brace pattern `{pass,built}-*` in the deploy job. actionlint cannot catch this. If a real run shows it fails, split it into two download steps.
- Unfixed review finding: F1 (P2) · marker uploads may conflict on a workflow re-run · `.github/workflows/ci.yml:517`. Not addressed in this run.
- Not done, per the Done means section: no push, no `ci.yml` dispatch, and no compose lifecycle commands against `lilnas` or `lilnas-dev`. The brace-pattern download and the re-run marker behaviour need a real CI run to confirm.
- Defects reported: none. Every task's checks passed at task time and again at integration.

### 2026-10-20 · Landed
Squash-merge of `ci/per-app-isolation` into `main` as `ci(per-app-isolation): squash-merge Per-app isolation in CI — one red app no longer blocks the others`, authored as Jeremy Asuncion.
