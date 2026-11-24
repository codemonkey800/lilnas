#!/bin/sh
# Creates (or removes) the read-only `lilnas_monitor` role that the
# postgres-exporter-* services in infra/monitoring.yml connect as, on each of
# the three production Postgres servers.
#
#   postgres-monitor-roles.sh [--dry-run] [--drop] <path to .env.postgres-exporter.decrypted>
#
# The password comes from DATA_SOURCE_PASS in the decrypted env file and
# reaches each container on psql's stdin only: it is never in argv and never
# printed (psql runs with terse errors, so a failing statement is not echoed).
# The server's own log can still contain the statement if log_statement or
# log_min_error_statement captures it, as for any ALTER ROLE ... PASSWORD.
#
# What the role gets: LOGIN, membership in pg_monitor, CONNECT on the
# container's own database. No superuser, no CREATEDB, no table grants.
# Its sessions also default to read-only transactions: before PG15 (Immich runs
# PG14) PUBLIC may create tables in the public schema, so without this the role
# could create a table there even though nothing grants it that.
#
# Idempotent: re-running creates nothing twice and resets the password, so a
# mismatch between the env file and the server is repaired by running it again.
# --drop revokes CONNECT and drops the role (the rollback); also idempotent.
# --dry-run prints the SQL with the password masked and runs nothing.
#
# Run it from the host that runs the containers. Needs docker access. Exits
# non-zero after trying every container, naming each one that failed.

set -eu

ROLE=lilnas_monitor
CONTAINERS='lilnas-tdr-bot-db-1 lilnas-icloud-backup-db-1 lilnas-immich-database-1'

usage() {
  echo "usage: ${0##*/} [--dry-run] [--drop] <path to .env.postgres-exporter.decrypted>" >&2
  exit 2
}

dry_run=0
drop=0
env_file=
for arg in "$@"; do
  case $arg in
    --dry-run) dry_run=1 ;;
    --drop) drop=1 ;;
    -h | --help) usage ;;
    -*)
      echo "unknown option: $arg" >&2
      usage
      ;;
    *)
      [ -z "$env_file" ] || usage
      env_file=$arg
      ;;
  esac
done
[ -n "$env_file" ] || usage
[ -r "$env_file" ] || {
  echo "cannot read $env_file" >&2
  exit 2
}

# Value of KEY in the env file, without surrounding quotes. Never sourced.
env_value() {
  sed -n "s/^$1=//p" "$env_file" | tail -n 1 | sed "s/^\"\(.*\)\"\$/\1/; s/^'\(.*\)'\$/\1/"
}

user=$(env_value DATA_SOURCE_USER)
if [ -n "$user" ] && [ "$user" != "$ROLE" ]; then
  echo "DATA_SOURCE_USER in $env_file is not $ROLE" >&2
  exit 2
fi

password=
if [ "$drop" -eq 0 ]; then
  password=$(env_value DATA_SOURCE_PASS)
  [ -n "$password" ] || {
    echo "DATA_SOURCE_PASS is empty or missing in $env_file" >&2
    exit 2
  }
fi

# SQL literal for $1 that is correct whatever standard_conforming_strings is:
# an E'' string with backslashes and single quotes doubled.
sql_literal() {
  printf "E'%s'" "$(printf '%s' "$1" | sed "s/\\\\/\\\\\\\\/g; s/'/''/g")"
}

# The script psql reads on stdin. $1 is the password to embed (already masked
# for --dry-run). Database names go through format(%I) and \gexec, so nothing
# needs interpolating into the statements.
emit_sql() {
  printf '%s\n' '\set VERBOSITY terse'
  if [ "$drop" -eq 1 ]; then
    cat <<EOF
SELECT format('REVOKE CONNECT ON DATABASE %I FROM $ROLE', current_database())
  WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = '$ROLE') \\gexec
SELECT 'DROP ROLE $ROLE'
  WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = '$ROLE') \\gexec
EOF
  else
    cat <<EOF
SELECT 'CREATE ROLE $ROLE LOGIN'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$ROLE') \\gexec
ALTER ROLE $ROLE WITH LOGIN PASSWORD $(sql_literal "$1");
ALTER ROLE $ROLE SET default_transaction_read_only = on;
GRANT pg_monitor TO $ROLE;
SELECT format('GRANT CONNECT ON DATABASE %I TO $ROLE', current_database()) \\gexec
EOF
  fi
}

# Each container has its own superuser and database in its environment.
remote='psql -q -1 -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

failed=
for container in $CONTAINERS; do
  if [ "$dry_run" -eq 1 ]; then
    echo "-- $container: docker exec -i $container sh -c '$remote'"
    emit_sql '********'
    continue
  fi

  echo "== $container"
  if ! emit_sql "$password" | docker exec -i "$container" sh -c "$remote"; then
    echo "FAILED: $container" >&2
    failed="$failed $container"
  fi
done

if [ -n "$failed" ]; then
  echo "failed on:$failed" >&2
  exit 1
fi
