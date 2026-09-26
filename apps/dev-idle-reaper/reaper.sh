#!/bin/sh
set -u

# Stops+removes dev containers whose network I/O has been flat for longer than
# their lilnas.idle-reap.max-idle-hours label (falls back to
# DEFAULT_MAX_IDLE_HOURS).
#
# A running container is a reap "trigger" when it either:
#   - is labeled lilnas.idle-reap.enabled=true, or
#   - has a Traefik router rule on a *.dev.lilnas.io host (auto-detected),
# unless it's labeled lilnas.idle-reap.enabled=false.
#
# Triggers are grouped into reap units:
#   - Compose projects whose working_dir is under DEV_PROJECTS_ROOT are reaped
#     whole -- every container sharing the trigger's project name AND
#     config_files, so a routed web container doesn't leave its Postgres/Redis
#     sidecars running. Only the triggers' I/O counts as activity; sidecar
#     traffic is mostly the app talking to its own database.
#   - Anything else (notably this repo, whose prod and dev compose files share
#     the `lilnas` project name) is reaped one container at a time, so a dev
#     container here can never drag production down with it.
# A unit is skipped whole if any member is labeled enabled=false or matches
# DENYLIST_REGEX.
#
# Membership comes from the labels Compose stamps on every container
# (com.docker.compose.project, .project.working_dir, .project.config_files),
# so the reaper never needs the project's compose files -- it stops+removes
# the member containers directly and leaves networks and volumes alone.
#
# "Flat" is judged from the Docker Engine API's per-container stats, not
# `docker stats`'s human-formatted output -- rx_bytes/tx_bytes there are
# already-cumulative counters since the container started, so a single
# non-streaming read is enough; there's no need for two samples the way
# CPU-percentage stats would require.
#
# State (last-seen byte total + last-active timestamp per trigger container
# ID) persists to $STATE_FILE across polls and across the reaper's own
# restarts.

POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-300}"
DEFAULT_MAX_IDLE_HOURS="${DEFAULT_MAX_IDLE_HOURS:-6}"
ACTIVITY_BYTES_THRESHOLD="${ACTIVITY_BYTES_THRESHOLD:-1024}"
DEV_PROJECTS_ROOT="${DEV_PROJECTS_ROOT:-/home/jeremy/dev}"
STATE_DIR="/var/lib/reaper"
STATE_FILE="$STATE_DIR/state.json"

# Container names the reaper refuses to touch whatever their labels say --
# a last-resort backstop in case grouping is ever misconfigured into sweeping
# up production's proxy or auth.
DENYLIST_REGEX='^lilnas-(traefik|auth)(-[0-9]+)?$'

# Trailing slash so /home/jeremy/dev doesn't also match /home/jeremy/devfoo.
PROJECTS_ROOT_PREFIX="${DEV_PROJECTS_ROOT%/}/"

# Shared jq definitions, applied to entries from GET /containers/json.
JQ_DEFS='
def labels: .Labels // {};
def name: .Names[0] | ltrimstr("/");
def opt: labels["lilnas.idle-reap.enabled"] // "";
def dev_routed:
  any(labels | to_entries[];
    (.key | test("^traefik\\.http\\.routers\\..+\\.rule$"))
    and (.value | test("\\.dev\\.lilnas\\.io`")));
def trigger: .State == "running" and opt != "false" and (opt == "true" or dev_routed);
def project_scoped:
  (labels["com.docker.compose.project"] // "") != ""
  and ((labels["com.docker.compose.project.working_dir"] // "") | startswith($root));
def unit_key:
  if project_scoped then
    "project:" + labels["com.docker.compose.project"]
      + " (" + (labels["com.docker.compose.project.config_files"] // "") + ")"
  else "container:" + name end;
'

mkdir -p "$STATE_DIR"
[ -f "$STATE_FILE" ] || echo '{}' >"$STATE_FILE"

log() {
    echo "$(date -Iseconds): $*"
}

docker_api() {
    curl -s --unix-socket /var/run/docker.sock "http://localhost$1"
}

state_set() {
    # $1=id $2=bytes $3=lastActive
    jq --arg id "$1" --argjson bytes "$2" --argjson seen "$3" \
        '.[$id] = {bytes: $bytes, lastActive: $seen}' "$STATE_FILE" >"$STATE_FILE.tmp" \
        && mv "$STATE_FILE.tmp" "$STATE_FILE"
}

state_drop() {
    jq --arg id "$1" 'del(.[$id])' "$STATE_FILE" >"$STATE_FILE.tmp" \
        && mv "$STATE_FILE.tmp" "$STATE_FILE"
}

prune_state() {
    # Drops entries for containers that no longer exist or are no longer
    # triggers -- otherwise a recreated container (new ID each time) leaves
    # its old ID's entry behind forever.
    live_ids="$1"
    jq --argjson ids "$(printf '%s\n' "$live_ids" | jq -R . | jq -s .)" \
        'with_entries(select(.key as $k | $ids | index($k)))' "$STATE_FILE" >"$STATE_FILE.tmp" \
        && mv "$STATE_FILE.tmp" "$STATE_FILE"
}

track_activity() {
    # $1=id $2=name $3=now -- updates the trigger's bytes/lastActive state.
    id="$1"
    name="$2"
    now="$3"

    stats=$(docker_api "/containers/$id/stats?stream=false")
    [ -z "$stats" ] && return

    total=$(echo "$stats" | jq '([.networks[]?.rx_bytes] | add // 0) + ([.networks[]?.tx_bytes] | add // 0)')
    { [ -z "$total" ] || [ "$total" = "null" ]; } && return

    prev=$(jq -r --arg id "$id" '.[$id] // empty' "$STATE_FILE")

    if [ -z "$prev" ]; then
        state_set "$id" "$total" "$now"
        log "$name: first sighting, seeding state (total=${total}B)"
        return
    fi

    prev_bytes=$(echo "$prev" | jq -r '.bytes')
    prev_active=$(echo "$prev" | jq -r '.lastActive')
    delta=$((total - prev_bytes))

    # A negative delta means the counters reset -- almost always because
    # the container was recreated between polls, which is itself a sign
    # of real activity, so treat it the same as "activity seen".
    if [ "$delta" -gt "$ACTIVITY_BYTES_THRESHOLD" ] || [ "$delta" -lt 0 ]; then
        last_active=$now
    else
        last_active=$prev_active
    fi

    state_set "$id" "$total" "$last_active"
}

evaluate_units() {
    # $1=containers JSON $2=now -- prints one TSV row per reap unit:
    # key, verdict, idle hours, max hours, member names, member IDs.
    echo "$1" | jq -r \
        --arg root "$PROJECTS_ROOT_PREFIX" \
        --arg deny "$DENYLIST_REGEX" \
        --argjson state "$(cat "$STATE_FILE")" \
        --argjson now "$2" \
        --argjson default "$DEFAULT_MAX_IDLE_HOURS" \
        "$JQ_DEFS"'
        . as $all
        | [.[] | select(trigger and $state[.Id] != null)]
        | group_by(unit_key)[]
        | . as $triggers
        | (.[0] | unit_key) as $key
        | (if $key | startswith("project:")
            then [$all[] | select(unit_key == $key)]
            else $triggers end) as $members
        | ([$triggers[] | $state[.Id].lastActive] | max) as $last
        | ([$triggers[]
            | (labels["lilnas.idle-reap.max-idle-hours"] // "" | tonumber? // $default)]
            | min) as $max
        | ((($now - $last) / 3600) | floor) as $idle
        | (if any($members[]; name | test($deny)) then "denied"
            elif any($members[]; opt == "false") then "exempt"
            elif $idle >= $max then "reap"
            else "keep" end) as $verdict
        | [$key, $verdict, $idle, $max,
            ([$members[] | name] | join(",")),
            ([$members[] | .Id] | join(" "))]
        | @tsv'
}

poll_once() {
    now=$(date +%s)
    containers=$(docker_api "/containers/json?all=true")
    [ -z "$containers" ] && return

    triggers=$(echo "$containers" | jq -r --arg root "$PROJECTS_ROOT_PREFIX" \
        "$JQ_DEFS"'.[] | select(trigger) | [.Id, name] | @tsv')

    prune_state "$(printf '%s\n' "$triggers" | cut -f1)"

    printf '%s\n' "$triggers" | while IFS="$(printf '\t')" read -r id name; do
        [ -n "$id" ] && track_activity "$id" "$name" "$now"
    done

    evaluate_units "$containers" "$now" | while IFS="$(printf '\t')" read -r key verdict idle max names ids; do
        case "$verdict" in
        reap)
            log "$key: idle ${idle}h (>= ${max}h) -- stopping and removing $names"
            # shellcheck disable=SC2086 # $ids is a space-separated ID list
            docker stop $ids >/dev/null 2>&1
            # shellcheck disable=SC2086
            docker rm $ids >/dev/null 2>&1
            for id in $ids; do state_drop "$id"; done
            ;;
        exempt)
            log "$key: idle ${idle}h / ${max}h -- exempt (a member is labeled lilnas.idle-reap.enabled=false)"
            ;;
        denied)
            log "$key: idle ${idle}h / ${max}h -- REFUSING, unit includes a denylisted container ($names)"
            ;;
        *)
            log "$key: idle ${idle}h / ${max}h"
            ;;
        esac
    done
}

log "dev-idle-reaper starting (poll every ${POLL_INTERVAL_SECONDS}s, default max idle ${DEFAULT_MAX_IDLE_HOURS}h, activity threshold ${ACTIVITY_BYTES_THRESHOLD}B, project root ${PROJECTS_ROOT_PREFIX})"

while true; do
    poll_once
    sleep "$POLL_INTERVAL_SECONDS"
done
