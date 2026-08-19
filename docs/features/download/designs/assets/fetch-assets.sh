#!/bin/bash
# Fetches real poster art (Emby) and video thumbnails (yt-dlp) for the
# download-app home mockup (../home.html), so it can be previewed with real
# imagery instead of the CSS-gradient placeholder.
#
# Output lands in emby/ and video/, both gitignored: Emby's posters are
# studio-owned art and this repo is public, so they're regenerated locally
# instead of committed. See README.md for the reasoning and how home.html
# falls back to the placeholder when these files aren't present.
#
# Usage:
#   cp .env.example .env   # fill in EMBY_API_KEY (1Password: "Emby - TDR API Key")
#   ./fetch-assets.sh
set -e

ASSETS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$ASSETS_DIR/.env" ] && source "$ASSETS_DIR/.env"

EMBY_URL="${EMBY_URL:-https://emby.lilnas.io}"
YT_KETTLEBELL_QUERY="${YT_KETTLEBELL_QUERY:-ytsearch1:kettlebell swing tutorial short}"
YT_ZOO_QUERY="${YT_ZOO_QUERY:-ytsearch1:me at the zoo first youtube video}"

mkdir -p "$ASSETS_DIR/emby" "$ASSETS_DIR/video"

# ── Emby posters ─────────────────────────────────────────────────────────
fetch_posters() {
  local item_type="$1" count="$2" prefix="$3" user_id="$4"
  local items
  items=$(curl -sf "$EMBY_URL/emby/Users/$user_id/Items?IncludeItemTypes=$item_type&Recursive=true&SortBy=DateCreated&SortOrder=Descending&Limit=$count&Fields=ProductionYear&api_key=$EMBY_API_KEY")

  echo "$items" | jq -r '.Items | to_entries[] | "\(.key+1)\t\(.value.Id)"' | while IFS=$'\t' read -r n id; do
    curl -sf "$EMBY_URL/emby/Items/$id/Images/Primary?api_key=$EMBY_API_KEY&maxWidth=480" -o "$ASSETS_DIR/emby/${prefix}-${n}.jpg"
  done

  echo "$items" | jq --arg prefix "$prefix" --arg type "$item_type" \
    '[.Items | to_entries[] | {file: ($prefix + "-" + ((.key+1)|tostring) + ".jpg"), name: .value.Name, year: .value.ProductionYear, type: $type}]'
}

if [ -z "$EMBY_API_KEY" ]; then
  echo "EMBY_API_KEY not set - skipping Emby poster fetch (see .env.example)." >&2
else
  echo "Authenticating with $EMBY_URL ..."
  USER_ID=$(curl -sf "$EMBY_URL/emby/Users?api_key=$EMBY_API_KEY" | jq -r '.[0].Id')
  if [ -z "$USER_ID" ] || [ "$USER_ID" = "null" ]; then
    echo "Could not authenticate to Emby - check EMBY_URL/EMBY_API_KEY." >&2
    exit 1
  fi

  echo "Fetching movie posters ..."
  movies=$(fetch_posters Movie 4 movie "$USER_ID")
  echo "Fetching show posters ..."
  shows=$(fetch_posters Series 4 show "$USER_ID")

  if ! jq -n --argjson movies "$movies" --argjson shows "$shows" '$movies + $shows' > "$ASSETS_DIR/emby/manifest.json"; then
    echo "Emby poster fetch produced no usable data - see errors above." >&2
    exit 1
  fi
  echo "Wrote $ASSETS_DIR/emby/manifest.json"
fi

# ── YouTube thumbnails ───────────────────────────────────────────────────
fetch_video() {
  local query="$1" out="$2"
  # --print-to-file, not --print: yt-dlp takes a metadata-only fast path
  # when --print (stdout) is combined with --skip-download, which skips
  # --write-thumbnail entirely (verified empirically against 2026.03.13).
  # --print-to-file runs the full pipeline, so the thumbnail actually gets
  # written. "|" instead of a tab: yt-dlp emits \t in templates literally
  # rather than as a real tab byte, so a tab-based split never matches.
  yt-dlp --skip-download --write-thumbnail --convert-thumbnails jpg --no-playlist -q \
    --print-to-file "%(title)s|%(duration)s" "$ASSETS_DIR/video/${out}.meta" \
    -o "$ASSETS_DIR/video/${out}.%(ext)s" "$query"

  # $p[:-1] (rejoined) handles a title that itself contains "|".
  jq -R --arg file "${out}.jpg" \
    'split("|") as $p | {file: $file, name: ($p[:-1] | join("|")), duration: ($p[-1] | tonumber)}' \
    "$ASSETS_DIR/video/${out}.meta" > "$ASSETS_DIR/video/${out}.json"
  rm "$ASSETS_DIR/video/${out}.meta"
}

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp not found - skipping video thumbnail fetch." >&2
else
  echo "Fetching video thumbnails ..."
  fetch_video "$YT_KETTLEBELL_QUERY" video-1
  fetch_video "$YT_ZOO_QUERY" video-2

  jq -s '.' "$ASSETS_DIR"/video/video-*.json > "$ASSETS_DIR/video/manifest.json"
  rm "$ASSETS_DIR"/video/video-*.json
  echo "Wrote $ASSETS_DIR/video/manifest.json"
fi

echo "Done. Open ../home.html - any asset that isn't present falls back to the CSS placeholder automatically."
