#!/usr/bin/env bash
set -euo pipefail

# Cancels older ci.yml runs that a newer push to the same branch supersedes,
# except runs that already reached the deploy job: a deploy killed mid-SSH dies
# on the host at its next write and can leave a service down. The newer run's
# detect job diffs from the last successful push run, so it still covers every
# commit a cancelled run would have handled.
#
# Usage: cancel-superseded-runs.sh <this-run-id> <branch> <event>
#
# Needs GH_TOKEN (actions: write) in the environment; gh infers the repo from
# the checkout. Best effort: a gh or parse failure prints a ::warning:: and the
# script still exits 0, so cancellation never fails or blocks the new run.

if [ "$#" -ne 3 ]; then
  echo "usage: cancel-superseded-runs.sh <this-run-id> <branch> <event>" >&2
  exit 2
fi

THIS_RUN="$1"
BRANCH="$2"
EVENT="$3"

warn() {
  echo "::warning::cancel-superseded-runs: $*"
}

if ! [[ "$THIS_RUN" =~ ^[0-9]+$ ]]; then
  warn "run id '$THIS_RUN' is not a number"
  exit 0
fi

BRANCH_QUERY="$(jq -rn --arg v "$BRANCH" '$v | @uri')"
EVENT_QUERY="$(jq -rn --arg v "$EVENT" '$v | @uri')"

if ! RUNS="$(gh api "repos/{owner}/{repo}/actions/workflows/ci.yml/runs?branch=${BRANCH_QUERY}&event=${EVENT_QUERY}&per_page=50")"; then
  warn "could not list ci.yml runs for '$BRANCH' ($EVENT)"
  exit 0
fi

if ! OLDER="$(jq -r --argjson this "$THIS_RUN" \
  '.workflow_runs[] | select(.status != "completed" and .id < $this) | "\(.id) \(.head_sha)"' \
  <<<"$RUNS")"; then
  warn "could not parse the run list for '$BRANCH' ($EVENT)"
  exit 0
fi

LINES=()
while read -r RUN_ID HEAD_SHA; do
  [ -n "$RUN_ID" ] || continue

  if ! JOBS="$(gh api --paginate "repos/{owner}/{repo}/actions/runs/${RUN_ID}/jobs")"; then
    warn "could not list jobs of run $RUN_ID; leaving it running"
    continue
  fi

  # `--paginate` prints one JSON document per page; jq reads them as a stream.
  if ! DEPLOY="$(jq -r '.jobs[] | select(.name == "deploy") | "\(.status) \(.conclusion // "")"' <<<"$JOBS")"; then
    warn "could not parse jobs of run $RUN_ID; leaving it running"
    continue
  fi

  # Deploying: running, or finished having run (a failed deploy may have
  # touched the host). A deploy that was cancelled or skipped never ran.
  case "$DEPLOY" in
    "in_progress "* | "completed success" | "completed failure")
      LINES+=("keeping $RUN_ID ($HEAD_SHA): deploy ${DEPLOY%% *}")
      continue
      ;;
  esac

  if gh run cancel "$RUN_ID" >/dev/null; then
    LINES+=("cancelled $RUN_ID ($HEAD_SHA)")
  else
    warn "could not cancel run $RUN_ID"
  fi
done <<<"$OLDER"

if [ "${#LINES[@]}" -gt 0 ]; then
  printf '%s\n' "${LINES[@]}"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "## Superseded runs"
      echo
      printf -- '- %s\n' "${LINES[@]}"
    } >>"$GITHUB_STEP_SUMMARY" || warn "could not write the step summary"
  fi
fi
