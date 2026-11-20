#!/usr/bin/env bash
# Download the pinned icloudpd release binary, verify its checksum and install
# it, executable, at <dest>. Exits non-zero on a download failure or a
# checksum mismatch, leaving nothing at <dest>.
#
# Usage: fetch-icloudpd.sh <dest>
set -euo pipefail

# Pinned at 1.32.3 on purpose: 1.33.1 is refused by Apple with error -20101
# ("Invalid email/password combination", HTTP 401) for a valid password
# (observed 2026-11-20), while 1.32.3 signs in and moves on to two-factor. Do
# not raise the pin without a real sign-in.
ICLOUDPD_VERSION=1.32.3
ICLOUDPD_SHA256=cbe4de08f715a9b524795eccd75f33a97661cd27fa7f0282c58611d760fce093

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
