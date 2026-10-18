#!/bin/sh
set -u

# Stops+removes dev containers nobody has visited for longer than their
# lilnas.idle-reap.max-idle-hours label (falls back to DEFAULT_MAX_IDLE_HOURS).
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
# "Visited" is asked of the auth service, not inferred from network traffic:
# Traefik calls auth's /verify for every request to a host behind lilnas-auth,
# and auth records the user of each allowed request. Network byte counters
# were useless here -- background chatter on the shared Docker network (UPnP
# broadcasts, *arr polling) moved them with nobody using the app. Each poll
# the reaper takes the Host(`...`) names from the container's Traefik router
# rules and calls $AUTH_URL/internal/host-activity?host=<host>&hours=<window>
# for each, which returns the distinct users in the window and the last
# visit. A container's last-active time only ever moves forward to the latest
# lastVisitAt seen, and starts at the moment the reaper first sees the
# container -- so a fresh container (or a freshly migrated auth with no
# history) always gets a full max-idle-hours before it can be reaped.
#
# A container is only reaped on a real answer. If auth is unreachable, the
# route is missing (an auth deploy older than this reaper), or the container
# has no Host() rule to ask about, its unit is left alone that poll.
#
# State (last-active timestamp, whether the last lookup succeeded, and the
# user count it returned, per trigger container ID) persists to $STATE_FILE
# across polls and across the reaper's own restarts.

POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-300}"
DEFAULT_MAX_IDLE_HOURS="${DEFAULT_MAX_IDLE_HOURS:-2}"
AUTH_URL="${AUTH_URL:-http://auth:8081}"
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
def hosts:
  [labels | to_entries[]
    | select(.key | test("^traefik\\.http\\.routers\\..+\\.rule$"))
    | .value
    | match("Host\\(`([^`]+)`\\)"; "g")
    | .captures[0].string
    | ascii_downcase]
  | unique;
def max_hours: (labels["lilnas.idle-reap.max-idle-hours"] // "" | tonumber? // $default);
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
    # $1=id $2=lastActive $3=lookupOk (true|false) $4=users
    jq --arg id "$1" --argjson seen "$2" --argjson ok "$3" --argjson users "$4" \
        '.[$id] = {lastActive: $seen, lookupOk: $ok, users: $users}' "$STATE_FILE" >"$STATE_FILE.tmp" \
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

fetch_host_activity() {
    # $1=host $2=window hours -- prints auth's JSON on a 200, fails otherwise
    # (unreachable, timeout, 404 from an auth deploy without the route, 5xx,
    # or a body that isn't the expected shape).
    body=$(curl -s --max-time 5 --get -w '\n%{http_code}' \
        --data-urlencode "host=$1" --data-urlencode "hours=$2" \
        "$AUTH_URL/internal/host-activity") || return 1
    code=$(printf '%s\n' "$body" | tail -n 1)
    [ "$code" = "200" ] || return 1
    json=$(printf '%s\n' "$body" | sed '$d')
    printf '%s' "$json" | jq -e '.activeUsers | numbers' >/dev/null 2>&1 || return 1
    printf '%s' "$json"
}

track_activity() {
    # $1=id $2=name $3=now $4=window hours $5=comma-separated hosts, or "-"
    # -- moves the trigger's lastActive forward to its latest visit and
    # records whether every host lookup got a real answer.
    id="$1"
    name="$2"
    now="$3"
    window="$4"
    hosts="$5"

    prev=$(jq -r --arg id "$id" '.[$id] // empty' "$STATE_FILE")
    if [ -z "$prev" ]; then
        last_active=$now
        log "$name: first sighting, seeding state"
    else
        last_active=$(echo "$prev" | jq -r '.lastActive')
    fi

    lookup_ok=true
    users=0

    if [ "$hosts" = "-" ]; then
        lookup_ok=false
    else
        for host in $(echo "$hosts" | tr ',' ' '); do
            if ! summary=$(fetch_host_activity "$host" "$window"); then
                lookup_ok=false
                log "$name: could not get activity for $host from $AUTH_URL -- not reaping this poll"
                continue
            fi
            users=$((users + $(echo "$summary" | jq -r '.activeUsers')))
            last_visit=$(echo "$summary" | jq -r \
                '.lastVisitAt // empty | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601? // empty')
            if [ -n "$last_visit" ] && [ "$last_visit" -gt "$last_active" ]; then
                last_active=$last_visit
            fi
        done
    fi

    state_set "$id" "$last_active" "$lookup_ok" "$users"
}

evaluate_units() {
    # $1=containers JSON $2=now -- prints one TSV row per reap unit:
    # key, verdict, idle hours, max hours, users in window, member names,
    # member IDs.
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
        | ([$triggers[] | $state[.Id].users // 0] | add) as $users
        | (if any($members[]; name | test($deny)) then "denied"
            elif any($members[]; opt == "false") then "exempt"
            elif any($triggers[]; $state[.Id].lookupOk != true) then "unknown"
            elif $idle >= $max and $users == 0 then "reap"
            else "keep" end) as $verdict
        | [$key, $verdict, $idle, $max, $users,
            ([$members[] | name] | join(",")),
            ([$members[] | .Id] | join(" "))]
        | @tsv'
}

poll_once() {
    now=$(date +%s)
    containers=$(docker_api "/containers/json?all=true")
    [ -z "$containers" ] && return

    triggers=$(echo "$containers" | jq -r --arg root "$PROJECTS_ROOT_PREFIX" \
        --argjson default "$DEFAULT_MAX_IDLE_HOURS" \
        "$JQ_DEFS"'.[] | select(trigger)
            | (hosts | join(",") | if . == "" then "-" else . end) as $h
            | [.Id, name, max_hours, $h] | @tsv')

    prune_state "$(printf '%s\n' "$triggers" | cut -f1)"

    printf '%s\n' "$triggers" | while IFS="$(printf '\t')" read -r id name window hosts; do
        [ -n "$id" ] && track_activity "$id" "$name" "$now" "$window" "$hosts"
    done

    evaluate_units "$containers" "$now" | while IFS="$(printf '\t')" read -r key verdict idle max users names ids; do
        case "$verdict" in
        reap)
            log "$key: idle ${idle}h (>= ${max}h), $users users in the last ${max}h -- stopping and removing $names"
            # shellcheck disable=SC2086 # $ids is a space-separated ID list
            docker stop $ids >/dev/null 2>&1
            # shellcheck disable=SC2086
            docker rm $ids >/dev/null 2>&1
            for id in $ids; do state_drop "$id"; done
            ;;
        exempt)
            log "$key: idle ${idle}h / ${max}h -- exempt (a member is labeled lilnas.idle-reap.enabled=false)"
            ;;
        unknown)
            log "$key: idle ${idle}h / ${max}h -- not reaping, no activity answer from auth (unreachable, route missing, or no Host() rule) ($names)"
            ;;
        denied)
            log "$key: idle ${idle}h / ${max}h -- REFUSING, unit includes a denylisted container ($names)"
            ;;
        *)
            log "$key: idle ${idle}h / ${max}h, $users users in the last ${max}h"
            ;;
        esac
    done
}

log "dev-idle-reaper starting (poll every ${POLL_INTERVAL_SECONDS}s, default max idle ${DEFAULT_MAX_IDLE_HOURS}h, auth ${AUTH_URL}, project root ${PROJECTS_ROOT_PREFIX})"

while true; do
    poll_once
    sleep "$POLL_INTERVAL_SECONDS"
done
