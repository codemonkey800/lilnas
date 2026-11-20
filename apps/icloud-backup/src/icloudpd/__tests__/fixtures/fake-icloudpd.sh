#!/bin/sh
# Stand-in for the icloudpd binary. The first argument picks the behaviour so
# specs never need the real thing. Everything after it is ignored.
case "$1" in
  lines)
    echo "out line 1"
    echo "err line 1" >&2
    printf 'partial'
    exit 3
    ;;
  args)
    shift
    for a in "$@"; do echo "$a"; done
    ;;
  ignore-term)
    # Ignores SIGTERM; only SIGKILL ends it. sleep's output is detached so it
    # cannot hold the pipes open after the shell is killed.
    trap '' TERM
    echo ready
    while :; do sleep 1 >/dev/null 2>&1; done
    ;;
  env)
    echo "db=[$POSTGRES_PASSWORD] key=[$IMMICH_API_KEY] path=[$PATH]"
    ;;
  wait)
    echo ready
    while :; do sleep 1 >/dev/null 2>&1; done
    ;;
esac
