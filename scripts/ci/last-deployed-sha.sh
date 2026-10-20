#!/usr/bin/env bash
set -euo pipefail

# Prints "<headSha> <runId>" of the newest successful `push` run of ci.yml on a
# branch, i.e. the last commit CI handled (and deployed) there. The detect job
# diffs from it so the newest run covers every commit no run has deployed yet.
#
# Usage: last-deployed-sha.sh <branch>
#
# Needs GH_TOKEN in the environment; gh infers the repo from the checkout.
# Prints nothing and exits 0 when there is no such run, or when gh fails or
# returns unparsable JSON (the reason goes to stderr). A lookup problem never
# fails the caller: it falls back to another base.

BRANCH="${1:-}"
if [ -z "$BRANCH" ]; then
  echo "usage: last-deployed-sha.sh <branch>" >&2
  exit 2
fi

if ! RUNS="$(gh run list --workflow ci.yml --branch "$BRANCH" --event push \
  --status success --limit 1 --json headSha,databaseId)"; then
  echo "last-deployed-sha: gh run list failed for branch '$BRANCH'" >&2
  exit 0
fi

if ! RESULT="$(jq -r 'if length > 0 then "\(.[0].headSha) \(.[0].databaseId)" else empty end' <<<"$RUNS")"; then
  echo "last-deployed-sha: could not parse gh output for branch '$BRANCH'" >&2
  exit 0
fi

if [ -n "$RESULT" ] && ! [[ "$RESULT" =~ ^[0-9a-f]{40}\ [0-9]+$ ]]; then
  echo "last-deployed-sha: unexpected run shape '$RESULT'" >&2
  exit 0
fi

if [ -n "$RESULT" ]; then
  echo "$RESULT"
fi
