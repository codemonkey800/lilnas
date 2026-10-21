#!/usr/bin/env bash
set -euo pipefail

# Prints each package dir whose pass marker is missing, one per line, in
# argument order. The deploy gate uses it to tell which checks did not pass.
#
# Usage: gate-check.sh <markers-dir> [<package-dir>...]
#
# A pass marker is an empty file named pass-<slug> in <markers-dir>, where the
# slug is the package dir with "/" replaced by "-" (apps/theater ->
# pass-apps-theater). Exits 0 whether or not packages are missing, with no
# package dirs, and with a markers dir that does not exist (then every package
# is missing). Exits 2 with usage when <markers-dir> is absent.

if [ "$#" -lt 1 ] || [ -z "$1" ]; then
  echo "usage: gate-check.sh <markers-dir> [<package-dir>...]" >&2
  exit 2
fi

MARKERS_DIR="$1"
shift

for package in "$@"; do
  if [ ! -f "$MARKERS_DIR/pass-${package//\//-}" ]; then
    echo "$package"
  fi
done
