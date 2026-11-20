#!/usr/bin/env bash
# Download the pinned icloudpd release binary, verify its checksum and install
# it, executable, at <dest>. Exits non-zero on a download failure or a
# checksum mismatch, leaving nothing at <dest>.
#
# Usage: fetch-icloudpd.sh <dest>
set -euo pipefail

# Pinned at 1.32.3, musl build, on purpose (measured 2026-11-20 with a real
# Apple ID whose password signs in at icloud.com): Apple refuses the glibc
# `linux-amd64` release with error -20101 ("Invalid email/password
# combination", HTTP 401) for a valid password, in 1.32.3 and in 1.33.1, from
# the hidden prompt and from the web form alike. The `linux-musl-amd64` build
# of 1.32.3 is accepted and moves on to two-factor. It is the same version and
# the same Python source, so the build is what matters. Do not change the
# build or the version without a real sign-in. The musl binary needs musl's
# loader and libz at run time; the Dockerfile supplies both.
ICLOUDPD_VERSION=1.32.3
ICLOUDPD_SHA256=acbe7149c5487088ecf0a660e4e75a931baec5af736e85beddf96be4aece6fd6

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <dest>" >&2
  exit 2
fi
dest=$1

url="https://github.com/icloud-photos-downloader/icloud_photos_downloader/releases/download/v${ICLOUDPD_VERSION}/icloudpd-${ICLOUDPD_VERSION}-linux-musl-amd64"

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

curl --fail --silent --show-error --location --output "$tmp" "$url"

actual=$(sha256sum "$tmp" | cut -d' ' -f1)
if [ "$actual" != "$ICLOUDPD_SHA256" ]; then
  echo "icloudpd ${ICLOUDPD_VERSION}: sha256 mismatch (expected ${ICLOUDPD_SHA256}, got ${actual})" >&2
  exit 1
fi

install -m 0755 "$tmp" "$dest"
