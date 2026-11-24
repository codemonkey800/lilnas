#!/bin/sh
# Publishes the /storage/<name> -> /mnt/<disk> symlinks as a node-exporter
# textfile metric, so Grafana can label mounts by what they hold:
#
#   lilnas_storage_volume{name="tv",mountpoint="/mnt/hdd2",volume="tv (hdd2)"} 1
#
# Runs in the storage-volumes sidecar (infra/monitoring.yml) and rewrites the
# file every five minutes, so a re-pointed symlink shows up on its own.
set -eu

out=/textfile/storage_volumes.prom

while true; do
  # node-exporter only reads *.prom, so the temp file is never half-read.
  tmp="$out.tmp"
  {
    echo '# HELP lilnas_storage_volume A /storage/<name> symlink and the mount it points at.'
    echo '# TYPE lilnas_storage_volume gauge'
    for link in /storage/*; do
      [ -L "$link" ] || continue
      name=${link##*/}
      target=$(readlink "$link")
      target=${target%/}
      echo "lilnas_storage_volume{name=\"$name\",mountpoint=\"$target\",volume=\"$name (${target##*/})\"} 1"
    done
  } >"$tmp"
  mv "$tmp" "$out"
  sleep 300
done
