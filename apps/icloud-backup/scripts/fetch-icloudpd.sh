#!/usr/bin/env bash
# Download the pinned icloudpd release binary, verify its checksum and install
# it, executable, at <dest>. Exits non-zero on a download failure or a
# checksum mismatch, leaving nothing at <dest>.
#
# Usage: fetch-icloudpd.sh <dest>
set -euo pipefail

ICLOUDPD_VERSION=1.33.1
ICLOUDPD_SHA256=961131997d58f349f437b3a9637ce92f04213fdfe4f484913b85eb4bae64ccc2

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <dest>" >&2
  exit 2
fi
dest=$1

url="https://github.com/icloud-photos-downloader/icloud_photos_downloader/releases/download/v${ICLOUDPD_VERSION}/icloudpd-${ICLOUDPD_VERSION}-linux-amd64"

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

curl --fail --silent --show-error --location --output "$tmp" "$url"

actual=$(sha256sum "$tmp" | cut -d' ' -f1)
if [ "$actual" != "$ICLOUDPD_SHA256" ]; then
  echo "icloudpd ${ICLOUDPD_VERSION}: sha256 mismatch (expected ${ICLOUDPD_SHA256}, got ${actual})" >&2
  exit 1
fi

install -m 0755 "$tmp" "$dest"
