#!/bin/sh
set -u

# Polls every container labeled lilnas.idle-reap.enabled=true and stops+
# removes any whose network I/O has been flat for longer than its own
# lilnas.idle-reap.max-idle-hours label (falls back to DEFAULT_MAX_IDLE_HOURS).
#
# "Flat" is judged from the Docker Engine API's per-container stats, not
# `docker stats`'s human-formatted output -- rx_bytes/tx_bytes there are
# already-cumulative counters since the container started, so a single
# non-streaming read is enough; there's no need for two samples the way
# CPU-percentage stats would require.
#
# State (last-seen byte total + last-active timestamp per container ID)
# persists to $STATE_FILE across polls and across the reaper's own restarts.

POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-300}"
DEFAULT_MAX_IDLE_HOURS="${DEFAULT_MAX_IDLE_HOURS:-6}"
ACTIVITY_BYTES_THRESHOLD="${ACTIVITY_BYTES_THRESHOLD:-1024}"
STATE_DIR="/var/lib/reaper"
STATE_FILE="$STATE_DIR/state.json"
LABEL_FILTER="label=lilnas.idle-reap.enabled=true"

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
    # opted in -- otherwise a recreated container (new ID each time) leaves
    # its old ID's entry behind forever.
    live_ids="$1"
    jq --argjson ids "$(printf '%s\n' "$live_ids" | jq -R . | jq -s .)" \
        'with_entries(select(.key as $k | $ids | index($k)))' "$STATE_FILE" >"$STATE_FILE.tmp" \
        && mv "$STATE_FILE.tmp" "$STATE_FILE"
}

poll_once() {
    now=$(date +%s)
    candidates=$(docker ps --filter "$LABEL_FILTER" --format '{{.ID}}')

    prune_state "$candidates"

    for id in $candidates; do
        name=$(docker inspect --format '{{.Name}}' "$id" 2>/dev/null | sed 's#^/##')
        [ -z "$name" ] && continue # container vanished mid-poll

        max_hours=$(docker inspect --format '{{ index .Config.Labels "lilnas.idle-reap.max-idle-hours" }}' "$id" 2>/dev/null)
        [ -z "$max_hours" ] && max_hours="$DEFAULT_MAX_IDLE_HOURS"

        stats=$(docker_api "/containers/$id/stats?stream=false")
        [ -z "$stats" ] && continue

        total=$(echo "$stats" | jq '([.networks[]?.rx_bytes] | add // 0) + ([.networks[]?.tx_bytes] | add // 0)')
        [ -z "$total" ] || [ "$total" = "null" ] && continue

        prev=$(jq -r --arg id "$id" '.[$id] // empty' "$STATE_FILE")

        if [ -z "$prev" ]; then
            state_set "$id" "$total" "$now"
            log "$name: first sighting, seeding state (total=${total}B)"
            continue
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

        idle_hours=$(((now - last_active) / 3600))
        if [ "$idle_hours" -ge "$max_hours" ]; then
            log "$name: idle ${idle_hours}h (>= ${max_hours}h) -- stopping and removing"
            docker stop "$id" >/dev/null 2>&1
            docker rm "$id" >/dev/null 2>&1
            state_drop "$id"
        else
            log "$name: idle ${idle_hours}h / ${max_hours}h (delta=${delta}B)"
        fi
    done
}

log "dev-idle-reaper starting (poll every ${POLL_INTERVAL_SECONDS}s, default max idle ${DEFAULT_MAX_IDLE_HOURS}h, activity threshold ${ACTIVITY_BYTES_THRESHOLD}B)"

while true; do
    poll_once
    sleep "$POLL_INTERVAL_SECONDS"
done
