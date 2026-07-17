#!/usr/bin/env bash
# daemon.sh — start/stop/restart/status for tdr-code's background process
# tree (main server + its supervised bot child + the Next.js frontend), so
# `pnpm start` can run detached instead of tied to a foreground terminal/tmux
# pane.
#
# Mechanism: `start` backgrounds `pnpm run start` with bash job control
# (`set -m`) turned on for that one subshell. Job control is what makes bash
# put a backgrounded job in a NEW process group (off by default in
# non-interactive scripts) — the PGID of that new group equals the PID of
# the job's first process, which `$!` gives us. Nothing in the tree we spawn
# (pnpm -> run-p -> {node dist/main -> its spawned bot child; node server.js})
# sets `detached`/calls `setpgid` today (confirmed: SupervisorService's own
# spawn() passes detached: false), so every process in the tree inherits and
# stays in that same group. That's what lets `stop` signal the WHOLE tree
# with one `kill -TERM -$PGID` — a negative PID targets the whole process
# group — without depending on any wrapper (pnpm, run-p) forwarding signals
# to its own children.
#
# If that assumption ever stops holding (some future dependency starts a
# detached child of its own), `stop` will under-signal rather than
# over-signal: it only ever touches the one process group it tracked, never
# a broader pgrep-based sweep, on purpose (a false-positive kill of an
# unrelated process is worse than a stop that times out and needs a manual
# follow-up).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

RUN_DIR=/tmp/tdr-code
PID_FILE="$RUN_DIR/daemon.pid"
LOG_FILE="$RUN_DIR/daemon.log"
STOP_TIMEOUT=35 # seconds. bootstrap.ts/bot-bootstrap.ts each code an 8s
                # force-exit fallback, but measured directly (3 full-tree
                # start/stop cycles, `ps` snapshots at each step): the bot
                # child consistently outlives that by 10s+ — main and the
                # frontend both exit within ~10s, but dist/bot-main.js is
                # reproducibly still alive at t=18s and gone by ~t=21s.
                # Likely cause: SupervisorService.defaultSpawn() opens an
                # 'ipc' stdio channel to the bot, which is a referenced
                # handle that can keep its event loop alive independent of
                # its own .unref()'d force-exit timer. Not investigated
                # further here (existing app behavior, out of scope for this
                # script) — 35s is sized off the REAL observed worst case
                # (~21s) plus real margin, not the code's stated 8s.

mkdir -p "$RUN_DIR"

# Prints the validated numeric PGID from the pidfile, or fails (nothing
# printed) if the file is absent, empty, non-numeric, or a value that would
# make `kill -TERM -$pgid` dangerous (0/1 broadcasts to every process we own).
pgid_from_file() {
  [[ -f "$PID_FILE" ]] || return 1
  local pgid
  pgid="$(<"$PID_FILE")"
  [[ "$pgid" =~ ^[0-9]+$ ]] || return 1
  (( pgid > 1 )) || return 1
  echo "$pgid"
}

# True only if the pidfile's PGID is both alive AND still looks like our own
# process tree (its group leader's command contains "node" or "pnpm"). The
# identity check is what makes a stale pidfile fail safe: if this exact PGID
# ever got reused by an unrelated process (e.g. after a reboot), we treat
# tdr-code as "not running" and never signal something we didn't start.
is_running() {
  local pgid
  pgid="$(pgid_from_file)" || return 1
  kill -0 "-$pgid" 2>/dev/null || return 1
  local comm
  comm="$(ps -o comm= -p "$pgid" 2>/dev/null || true)"
  [[ "$comm" == *node* || "$comm" == *pnpm* ]]
}

# Read-only sanity check, never kills anything: warns if a bot process is
# still alive outside the group we just stopped — the "duplicate bot from an
# imperfect restart" failure mode the two-process-substrate plan itself
# flagged as a risk.
warn_stray_bot() {
  local stray
  stray="$(pgrep -f 'dist/bot-main' 2>/dev/null || true)"
  if [[ -n "$stray" ]]; then
    echo "warning: a tdr-code bot process is still alive after stop (pid(s): $stray) and was not part of the tracked daemon — investigate with: ps -p $stray -o pid,ppid,pgid,command" >&2
  fi
}

cmd_start() {
  if is_running; then
    echo "tdr-code is already running (pgid $(pgid_from_file)) — see $LOG_FILE" >&2
    exit 1
  fi
  rm -f "$PID_FILE"
  echo "starting tdr-code in the background — logging to $LOG_FILE"
  (
    set -m
    nohup pnpm run start >>"$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
  )
  sleep 2
  if is_running; then
    echo "tdr-code started (pgid $(pgid_from_file)) — run 'pnpm run daemon:status' to check it, tail $LOG_FILE for boot output"
  else
    echo "tdr-code failed to start — last lines of $LOG_FILE:" >&2
    tail -n 20 "$LOG_FILE" >&2 || true
    exit 1
  fi
}

cmd_stop() {
  local pgid
  if ! pgid="$(pgid_from_file)"; then
    echo "tdr-code is not running (no pidfile)"
    return 0
  fi
  if ! is_running; then
    echo "tdr-code is not running (stale pidfile) — removing it"
    rm -f "$PID_FILE"
    return 0
  fi
  echo "stopping tdr-code (pgid $pgid)…"
  kill -TERM "-$pgid" 2>/dev/null || true
  local waited=0
  while kill -0 "-$pgid" 2>/dev/null; do
    if (( waited >= STOP_TIMEOUT )); then
      echo "tdr-code did not exit after ${STOP_TIMEOUT}s — sending SIGKILL" >&2
      kill -KILL "-$pgid" 2>/dev/null || true
      break
    fi
    sleep 1
    (( waited++ ))
  done
  rm -f "$PID_FILE"
  echo "tdr-code stopped"
  warn_stray_bot
}

cmd_restart() {
  cmd_stop
  cmd_start
}

cmd_status() {
  if is_running; then
    local pgid uptime
    pgid="$(pgid_from_file)"
    uptime="$(ps -o etime= -p "$pgid" 2>/dev/null | tr -d ' ')"
    echo "tdr-code is running (pgid $pgid, uptime ${uptime:-unknown})"
    echo "  daemon log: $LOG_FILE"
    echo "  app logs:   $RUN_DIR/{backend,frontend-server,frontend-browser}.{dev,prod}.log"
  else
    echo "tdr-code is not running"
  fi
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  *)
    echo "usage: $(basename "$0") {start|stop|restart|status}" >&2
    exit 1
    ;;
esac
