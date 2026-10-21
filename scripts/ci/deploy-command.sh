#!/usr/bin/env bash
set -euo pipefail

# Prints the host `deploy` command for a CI run, minus everything whose image
# is held back. An image is held back when any of its gates (package dirs) has
# no pass marker, or when its build marker is missing.
#
# Usage: deploy-command.sh <markers-dir>
#
# Markers are empty files in <markers-dir>: pass-<slug> (slug = package dir with
# "/" replaced by "-") and built-<image name>.
#
# Env:
#   PLAN                the `lilnas ci detect --json` object
#   SHA                 commit to deploy
#   DRY_RUN             "true" adds --dry-run
#   INPUT_FULL          "true" when the dispatch asked for a full deploy
#   GITHUB_STEP_SUMMARY optional; gets a "Held back" table when anything is held
#
# Prints the command on stdout, or nothing when there is nothing to deploy.
# Exits 2 with usage on a bad argument, a missing PLAN or SHA, or an invalid PLAN.

usage() {
  echo "usage: PLAN=<json> SHA=<sha> deploy-command.sh <markers-dir>" >&2
  exit 2
}

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  usage
fi

MARKERS_DIR="$1"
PLAN="${PLAN:-}"
SHA="${SHA:-}"
DRY_RUN="${DRY_RUN:-}"
INPUT_FULL="${INPUT_FULL:-}"

if [ -z "$PLAN" ] || [ -z "$SHA" ]; then
  usage
fi

if ! jq -e 'type == "object"' >/dev/null 2>&1 <<<"$PLAN"; then
  echo "deploy-command: PLAN is not a JSON object" >&2
  exit 2
fi

blocked=""
rows=""

# One tab-separated line per image: name, services, gates (comma-joined).
while IFS=$'\t' read -r name services gates; do
  reasons=""

  missing=""
  IFS=',' read -r -a gate_list <<<"$gates"
  for gate in "${gate_list[@]}"; do
    [ -n "$gate" ] || continue
    if [ ! -f "$MARKERS_DIR/pass-${gate//\//-}" ]; then
      missing+="${missing:+, }$gate"
    fi
  done
  if [ -n "$missing" ]; then
    reasons="checks failed or missing: $missing"
  fi

  if [ ! -f "$MARKERS_DIR/built-$name" ]; then
    reasons+="${reasons:+; }image not built"
  fi

  if [ -n "$reasons" ]; then
    blocked+="${blocked:+,}$services"
    rows+="| $name | ${services//,/, } | $reasons |"$'\n'
  fi
done < <(jq -r '.images // [] | .[] | [.name, ((.services // []) | join(",")), ((.gates // []) | join(","))] | @tsv' <<<"$PLAN")

full=false
if [ "$INPUT_FULL" = "true" ] || [ "$(jq -r '.full // false' <<<"$PLAN")" = "true" ]; then
  full=true
fi

if [ -n "$rows" ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Held back"
    echo
    echo "| image | services | reason |"
    echo "| --- | --- | --- |"
    printf '%s' "$rows"
  } >>"$GITHUB_STEP_SUMMARY"
fi

cmd="deploy $SHA"
if [ "$DRY_RUN" = "true" ]; then
  cmd+=" --dry-run"
fi

if [ "$full" = "true" ] && [ -z "$rows" ]; then
  # The host script ignores service lists under --full.
  echo "$cmd --full"
  exit 0
fi

# Lists keep PLAN order; `-` removes the blocked services from each.
lists="$(jq -c --arg blocked "$blocked" --argjson full "$full" '
  ($blocked | split(",") | map(select(. != ""))) as $b
  | {
      pull: ((.pull // []) - $b | join(",")),
      up: ((.up // []) - $b | join(",")),
      force: ((.forceRecreate // []) - $b | join(",")),
      decrypt: ($full or ((.decrypt // false) and (((.decryptServices // []) - $b) | length > 0)))
    }' <<<"$PLAN")"

pull="$(jq -r '.pull' <<<"$lists")"
up="$(jq -r '.up' <<<"$lists")"
force="$(jq -r '.force' <<<"$lists")"
decrypt="$(jq -r '.decrypt' <<<"$lists")"

if [ "$decrypt" != "true" ] && [ -z "$pull" ] && [ -z "$up" ] && [ -z "$force" ]; then
  exit 0
fi

if [ "$decrypt" = "true" ]; then
  cmd+=" --decrypt"
fi
if [ -n "$pull" ]; then
  cmd+=" --pull $pull"
fi
if [ -n "$up" ]; then
  cmd+=" --up $up"
fi
if [ -n "$force" ]; then
  cmd+=" --force-recreate $force"
fi
echo "$cmd"
