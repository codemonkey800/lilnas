---
nexus-plan: 2
title: CI cancels superseded runs; the newest run deploys everything undeployed
branch: ci/cancel-superseded-runs
base: main
setup:
  - pnpm install --frozen-lockfile
checks:
  - pnpm --filter @lilnas/cli lint
  - pnpm --filter @lilnas/cli type-check
  - pnpm --filter @lilnas/cli test
  - for f in scripts/deploy/*.sh scripts/ci/*.sh; do [ -e "$f" ] || continue; bash -n "$f" || exit 1; done
  - docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12
parallel: 2
review: per-phase
commit-style: "conventional with scope, e.g. ci: …, test(cli): …, docs: …"
---

# CI cancels superseded runs; the newest run deploys everything undeployed

## Goal
When several pushes to `main` land close together, `.github/workflows/ci.yml`
today runs every one of them in full, and the `deploy` job's queued-only
concurrency group drops a middle run's deploy while its `detect` job only ever
diffed that run's own `github.event.before..sha`. A middle push that changed
`tdr-bot` gets its image built but never pulled on the host. Fix both halves:
(1) a push run diffs from the head sha of the newest successful `push` run of
`ci.yml` on its branch (the last sha known to be deployed, or to have needed
nothing), so the newest run covers every undeployed commit; (2) a run cancels
older in-flight runs of the same event on the same branch, but only those whose
`deploy` job has not started, because a deploy killed mid-SSH dies on the host
at its next write (verified: bash under `set -euo pipefail` exits 141 at the
first `echo` after its reader is gone). PR runs get plain workflow-level
`cancel-in-progress`. `docs/deploy.md` describes the result. Out of scope: any
change to what the host-side scripts do with a deploy, and any
`docker compose` command against the production project from this checkout.

## Decisions
- **Base for a push = newest successful `push` run's `headSha`, via `gh run list`**,
  not the host's `/opt/lilnas` HEAD over Tailscale (heavier; needs the tailnet in
  `detect`). A successful push run means everything up to its sha was deployed or
  needed nothing, so it is a valid base even when its deploy printed "Nothing to
  deploy". Failed, cancelled, and dispatch runs are never bases. If an older run
  is still deploying when the new one reads its base, the base is older than
  that deploy's sha and the new run redeploys a superset — `compose up -d` of an
  unchanged service is a no-op, so that is correct, just redundant.
- **No successful push run (empty lookup, API failure) → `github.event.before`
  with a warning.** A found sha that is not an ancestor of HEAD (only after a
  force-push to `main`) is passed through unchanged: `lilnas ci detect` already
  treats a non-ancestor base as a full deploy, which is the safe answer there.
  Ruled out: falling back to `event.before` on non-ancestor (would miss commits).
- **`workflow_dispatch` without `base` uses the same lookup on its own branch**
  (Jeremy, 2026-10-19). On `main` a bare dispatch now catches the host up; on
  any other branch there are no push runs, so it still diffs `HEAD~1` with the
  existing warning. `base=` and `full=true` still override.
- **Explicit, deploy-aware cancellation instead of workflow-level
  `cancel-in-progress` for push** (Jeremy, 2026-10-19, after seeing that the host
  script cannot survive an SSH drop). A first step in `detect` cancels every
  older non-completed run of `ci.yml` with the same event and branch whose
  `deploy` job is not `in_progress` and has not completed with a real result;
  a run already deploying finishes and the new run queues behind it on the
  existing `deploy` group. Residual: a sub-second race if a deploy starts between
  the check and the cancel; it self-heals on the next successful deploy because a
  cancelled run is never a base. Ruled out: workflow-level cancel plus a detached
  host entrypoint (needs `sudo install-host.sh`, and GitHub would show
  "cancelled" while the host keeps deploying); workflow-level cancel accepting a
  half-updated host; a `workflow_run`-triggered deploy workflow (plan outputs
  would have to travel as artifacts; loses the single-run view).
- **Same-event-only cancellation.** A dispatch never cancels a push run and a
  push never cancels a dispatch; two dry-run dispatches on a branch do supersede
  each other, which is what the live check relies on.
- **PR runs: workflow-level `concurrency` with `cancel-in-progress: true`,
  grouped per PR number; every other event gets a group of its own `run_id`** so
  the workflow-level block never cancels a push or dispatch run.
- **Logic lives in `scripts/ci/*.sh`, tested from `packages/cli`** with a stub
  `gh` on `PATH`, following `ci-workflow-base.spec.ts`, which already runs the
  detect step's `case` block in bash against a temp repo.
- **Live check from the run branch, dry-run only, agent-run** (Jeremy,
  2026-10-19): two dispatches, the second with `base=<its own sha>` so it plans
  nothing and never reaches the host.

## Context
- Repo: pnpm monorepo; the workflow is `.github/workflows/ci.yml` (601 lines).
  Jobs: `detect` → `test` / `lint-and-typecheck` (matrix) / `base-images` →
  `build-images` → `deploy` (`concurrency: { group: deploy, cancel-in-progress: false }`,
  `environment: production`, SSHes `deploy@lilnas.tail77e8b0.ts.net` over
  Tailscale) → `summary` (the required check). Workflow-level `permissions:` is
  `contents: read, packages: write`; a job-level `permissions:` replaces the
  whole set for that job. `inputs.*` is empty on push/PR events. `detect` checks
  out with `fetch-depth: 0`, so `scripts/` and full history are present.
- `detect`'s "Detect changes" step (ci.yml ~line 87) picks `BASE` in a
  `case "$EVENT_NAME"` block from env `EVENT_NAME`, `HEAD`, `PR_BASE`,
  `PUSH_BEFORE`, `FULL`, `DISPATCH_BASE`, then runs
  `pnpm --silent lilnas ci detect --json --base "$BASE" --head "$HEAD"` and
  writes a `## Plan` table to `$GITHUB_STEP_SUMMARY`. `lilnas ci detect` treats
  an unset, all-zero, unknown, or non-ancestor base as `full`.
- Tests: `packages/cli/src/utils/__tests__/ci-workflow-base.spec.ts` loads
  ci.yml with js-yaml, slices the step's `run` up to `\nesac`, appends
  `echo "$BASE"`, and runs it with `bash -eo pipefail` in a temp git repo with
  three commits, env limited to `PATH` plus the case's variables. Jest:
  `pnpm --filter @lilnas/cli test` (4 suites, ~2 s). Lint: `pnpm --filter
  @lilnas/cli lint` (eslint + prettier, both must pass).
- `gh` is authenticated here as Jeremy; in Actions it needs
  `GH_TOKEN: ${{ github.token }}` and finds the repo from the checkout.
  Verified shapes: `gh run list --workflow ci.yml --branch main --event push
  --status success --limit 1 --json headSha,databaseId` (newest first);
  `gh api repos/{owner}/{repo}/actions/workflows/ci.yml/runs?branch=<b>&event=<e>&per_page=50`
  → `.workflow_runs[] | {id, status, conclusion, head_sha}` (`status` is
  `queued|in_progress|completed`); `gh api repos/{owner}/{repo}/actions/runs/<id>/jobs`
  → `.jobs[] | {name, status, conclusion}` with the deploy job named exactly
  `deploy` (matrix jobs are `test (apps/x)`); a run cancelled before deploy
  lists `deploy` as `completed`/`cancelled`. Run ids increase monotonically.
- actionlint runs with shellcheck on inline `run:` blocks and passes at base.
  Shell scripts: `#!/usr/bin/env bash`, `set -euo pipefail`, same style as
  `scripts/deploy/lilnas-deploy.sh`.
- **This machine is production.** Never run `docker compose up/down/restart/pull/--build`
  against the `lilnas` or `lilnas-dev` project, never dispatch `ci.yml` with
  `dry_run=false`, never print `.env.keys` or any `.env.prod`/`.decrypted` file.
  Agents have no sudo.

## Done means
Implemented as each task says; `packages/cli` tests cover every case the task
names and pass; all `checks:` pass (actionlint with shellcheck included); no
task ran a compose lifecycle command against `lilnas`/`lilnas-dev` or a
non-dry-run dispatch; `docs/deploy.md` matches the final workflow behaviour.

## Planner notes
- Host-side kill behaviour, verified 2026-10-19: bash with `set -euo pipefail`
  writing to a pipe whose reader died exits 141 (SIGPIPE) at the next `echo`;
  the EXIT trap still runs. sshd sends no signal to a no-PTY session's command
  on disconnect but closes its pipes, so `lilnas-deploy.sh` dies at its next
  `echo "+ docker compose …"` and `docker compose` (Go) dies on its next
  progress write to fd 1/2. A deploy killed between stop and start of a
  container leaves that service down until the next deploy.
- `gh run list --status success` works as a conclusion filter; it returned
  `738fbeb4` (main tip) on 2026-10-19. Run 39163543493 (cancelled dispatch) is
  the reference for how a cancelled run's jobs list looks.
- CLI tests pass at base in ~2 s; actionlint 1.7.12 passes at base with
  shellcheck on. `scripts/ci/` does not exist yet; the `bash -n` check tolerates
  that.
- `inject-workspace-packages=true` means `pnpm lilnas` runs an injected copy of
  `packages/cli`; only matters if a task adds CLI source files (none here).
- Jeremy asked for Fable/high for the planner only; tasks run on the run's
  config (not pinned).
- Ruled out (see Decisions): host HEAD over Tailscale as base; workflow-level
  cancel for push; `workflow_run` deploy workflow; falling back to `event.before`
  on a non-ancestor base.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report,
     the rollout record. Humans may add notes here too. -->
