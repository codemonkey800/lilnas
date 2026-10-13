#!/usr/bin/env bash
#
# Move the Radarr movie library to 1080p x264 so the theater app can direct-play
# for a room of 5-7 viewers. Background and measurements:
#   docs/research/2026-07-31-multi-viewer-transcode-capacity.md
#
# Radarr replaces a movie's file when the profile no longer allows its quality
# (or its custom-format score is under the cutoff), so switching profiles and
# searching is what downloads the 1080p release *and* deletes the 4K one. No
# recycle bin is involved: 4K can be re-grabbed later by moving a movie back to
# a 4K profile.
#
# Usage:
#   scripts/radarr-theater-1080p.sh setup              # custom formats + profile (idempotent)
#   scripts/radarr-theater-1080p.sh assign [movieId]   # put every movie (or one) on the profile
#   scripts/radarr-theater-1080p.sh pending            # movies whose file still needs replacing
#   scripts/radarr-theater-1080p.sh search [N]         # search the next N pending (default 25)
#   scripts/radarr-theater-1080p.sh loop [N]           # search N at a time whenever the queue drains
#   scripts/radarr-theater-1080p.sh status             # queue / pending / disk summary
#
# Env: RADARR_URL, RADARR_API_KEY (both default to the prod container + config.xml),
#      STATE_FILE (ids already searched, so a movie with no release isn't re-searched
#      every round and burn the indexers' daily API caps; default ~/.cache/...).

set -euo pipefail

PROFILE_NAME='lilnas · Theater 1080p x264'
CF_X264='lilnas · x264'
CF_X265='lilnas · x265/HEVC'
CF_HDR='lilnas · HDR/DV'
CF_AV1='lilnas · AV1'
CF_FOREIGN='lilnas · Non-English/Multi'
# Remux is already disallowed by the profile, but an H.264 remux on disk is
# named "AVC" and so scores +100 — equal to any replacement — and Radarr
# refuses a same-score downgrade. Scoring remux -10000 makes a Bluray/WEB
# x264 release a custom-format upgrade instead.
CF_REMUX='lilnas · Remux'
# Same patterns the custom formats use, applied to on-disk filenames so an
# already-imported dual-audio or AV1 release counts as pending too.
FOREIGN_REGEX='\b(iTA|ITALIAN|German|FRENCH|TRUEFRENCH|VOSTFR|SPANISH|CASTELLANO|LATINO|HINDI|RUS|KOR|JPN|CHI|NORDiC|TR|TURKISH|TURK|DUAL|MULTi\d?|MULTI|MultiAudio|Multi\d|Dual[ ._-]?Audio)\b'
STATE_FILE=${STATE_FILE:-$HOME/.cache/radarr-theater-1080p.searched}
RESEARCH_AFTER_SECONDS=$((24 * 3600))

if [[ -z "${RADARR_API_KEY:-}" ]]; then
  RADARR_API_KEY=$(grep -oP '(?<=<ApiKey>)[^<]+' /storage/app-data/radarr/config.xml)
fi
if [[ -z "${RADARR_URL:-}" ]]; then
  ip=$(docker inspect lilnas-radarr-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
  RADARR_URL="http://${ip}:7878"
fi

api() {
  local method=$1 path=$2
  shift 2
  curl -sS -f -X "$method" -H "X-Api-Key: $RADARR_API_KEY" -H 'Content-Type: application/json' \
    "${RADARR_URL}/api/v3${path}" "$@"
}

# Custom format with a single release-title regex condition.
ensure_cf() {
  local name=$1 regex=$2
  local existing
  existing=$(api GET /customformat | jq -r --arg n "$name" '.[] | select(.name == $n) | .id')
  if [[ -n "$existing" ]]; then
    echo "$existing"
    return
  fi
  jq -n --arg n "$name" --arg r "$regex" '{
    name: $n,
    includeCustomFormatWhenRenaming: false,
    specifications: [{
      name: $n, implementation: "ReleaseTitleSpecification",
      negate: false, required: true,
      fields: [{ name: "value", value: $r }]
    }]
  }' | api POST /customformat -d @- | jq -r .id
}

profile_id() {
  api GET /qualityprofile | jq -r --arg n "$PROFILE_NAME" '.[] | select(.name == $n) | .id'
}

cmd_setup() {
  local x264 x265 hdr
  x264=$(ensure_cf "$CF_X264" '[xh][ ._-]?264|\bAVC\b')
  x265=$(ensure_cf "$CF_X265" '[xh][ ._-]?265|\bHEVC(\b|\d)')
  hdr=$(ensure_cf "$CF_HDR" '\b(DV|DoVi|Dolby[ ._-]?Vision|HDR10\+?|HDR)\b')
  av1=$(ensure_cf "$CF_AV1" '\bAV1\b')
  foreign=$(ensure_cf "$CF_FOREIGN" "$FOREIGN_REGEX")
  remux=$(ensure_cf "$CF_REMUX" '\bREMUX\b')
  echo "custom formats: x264=$x264 x265=$x265 hdr=$hdr av1=$av1 foreign=$foreign remux=$remux"

  # Bluray-1080p is unlimited by default; cap it near the WEB tier so encodes
  # stay well under the theater's per-client bitrate ceiling.
  api GET /qualitydefinition \
    | jq -c '.[] | select(.quality.name == "Bluray-1080p") | .preferredSize = 60 | .maxSize = 100' \
    | api PUT /qualitydefinition/"$(api GET /qualitydefinition | jq -r '.[] | select(.quality.name == "Bluray-1080p") | .id')" -d @- >/dev/null
  echo "Bluray-1080p size limits: pref=60 max=100 MB/min"

  local existing
  existing=$(profile_id)
  if [[ -n "$existing" ]]; then
    echo "profile exists: id=$existing"
    return
  fi

  # Clone the stock "lilnas · HD (up to 1080p)" profile for its full items list
  # (Radarr requires every quality to be present), then flip what's allowed.
  api GET /qualityprofile \
    | jq -c --arg n "$PROFILE_NAME" --argjson x264 "$x264" --argjson x265 "$x265" --argjson hdr "$hdr" \
        --argjson av1 "$av1" --argjson foreign "$foreign" --argjson remux "$remux" '
      def allowed: ["WEB 1080p", "Bluray-1080p", "HDTV-1080p", "WEB 720p", "Bluray-720p"];
      (.[] | select(.name == "lilnas · HD (up to 1080p)")) as $p
      | ($p.items | map(select(.name == "WEB 1080p") | .id) | first) as $cutoff
      | $p
      | del(.id)
      | .name = $n
      | .upgradeAllowed = true
      | .cutoff = $cutoff
      | .minFormatScore = 0
      | .cutoffFormatScore = 100
      | .minUpgradeFormatScore = 1
      | .items |= map(.allowed = ((.name // .quality.name) as $q | allowed | index($q) != null))
      # Item order is preference order (index 0 = lowest). Radarr refuses to
      # replace a file with a lower-preference quality, even one the profile
      # disallows, so push Remux-1080p to the bottom alongside the 2160p tiers.
      | .items |= ((map(select((.name // .quality.name) == "Remux-1080p"))) + map(select((.name // .quality.name) != "Remux-1080p")))
      | .formatItems = [
          { format: $x264, score: 100 },
          { format: $x265, score: -10000 },
          { format: $hdr, score: -10000 },
          { format: $av1, score: -10000 },
          { format: $foreign, score: -10000 },
          { format: $remux, score: -10000 }
        ]
    ' \
    | api POST /qualityprofile -d @- | jq -r '"profile created: id=\(.id)"'
}

movies_json() {
  api GET /movie
}

# Movies whose on-disk file the theater can't direct-play: 4K, any 1080p remux
# (bitrate), HEVC/AV1/MPEG-2/VC-1 video, or >8-bit. Dual-audio H.264 is accepted.
pending_filter() {
  jq -c '
    .[] | select(.hasFile) | .movieFile as $f
    | select(
        ($f.quality.quality.name | test("2160p|Remux"))
        or ($f.mediaInfo.videoCodec // "" | test("HEVC|x265|h265|AV1|MPEG2|VC1"; "i"))
        or (($f.mediaInfo.videoBitDepth // 8) != 8)
      )
    | { id, title, year, quality: $f.quality.quality.name, codec: $f.mediaInfo.videoCodec, gb: (($f.size // 0) / 1e9 * 10 | round / 10) }
  '
}

cmd_assign() {
  local pid ids
  pid=$(profile_id)
  [[ -n "$pid" ]] || { echo "run setup first" >&2; exit 1; }
  if [[ -n "${1:-}" ]]; then
    ids="[$1]"
  else
    ids=$(movies_json | jq -c '[.[].id]')
  fi
  jq -n --argjson ids "$ids" --argjson pid "$pid" '{ movieIds: $ids, qualityProfileId: $pid }' \
    | api PUT /movie/editor -d @- | jq -r 'length | "assigned profile to \(.) movie(s)"'
}

cmd_pending() {
  movies_json | pending_filter | jq -r '"\(.id)\t\(.title) (\(.year))\t\(.quality)\t\(.codec)\t\(.gb) GB"' | sort -t$'\t' -k2
}

queued_movie_ids() {
  api GET '/queue?pageSize=1000' | jq -c '[.records[].movieId] | unique'
}

# Ids searched within the last RESEARCH_AFTER_SECONDS, from the state file.
recently_searched_ids() {
  mkdir -p "$(dirname "$STATE_FILE")"
  touch "$STATE_FILE"
  awk -v cutoff="$(($(date +%s) - RESEARCH_AFTER_SECONDS))" '$2 >= cutoff { print $1 }' "$STATE_FILE" \
    | jq -sc '.'
}

cmd_search() {
  local n=${1:-25} pid queued skip ids
  pid=$(profile_id)
  queued=$(queued_movie_ids)
  skip=$(jq -c --argjson a "$queued" --argjson b "$(recently_searched_ids)" -n '$a + $b | unique')
  ids=$(movies_json | jq -c --argjson pid "$pid" --argjson skip "$skip" '
    [ .[] | select(.qualityProfileId == $pid and .monitored) ] | map(select(.id as $i | $skip | index($i) | not))
  ' | pending_filter | jq -sc --argjson n "$n" '[.[:$n][].id]')
  if [[ "$ids" == "[]" ]]; then
    echo "nothing to search (every pending movie is queued or was searched in the last 24h)"
    return 1
  fi
  jq -n --argjson ids "$ids" '{ name: "MoviesSearch", movieIds: $ids }' \
    | api POST /command -d @- | jq -r '"queued search for \(.body.movieIds | length) movie(s), command id \(.id)"'
  jq -r --arg now "$(date +%s)" '.[] | "\(.)\t\($now)"' <<<"$ids" >>"$STATE_FILE"
}

# Keep the queue fed: whenever fewer than QUEUE_LOW items are downloading, search
# the next batch. Stops once nothing is left to search and the queue is empty.
cmd_loop() {
  local n=${1:-20} low=${QUEUE_LOW:-8} interval=${INTERVAL:-300} queue
  while true; do
    echo "== $(date '+%F %T')"
    cmd_status
    # Don't let a stuck import (warning state) hold the loop forever.
    queue=$(api GET '/queue?pageSize=1000' | jq -r '[.records[] | select(.trackedDownloadStatus != "warning")] | length')
    if (( queue < low )); then
      if ! cmd_search "$n" && (( queue == 0 )); then
        echo "done: queue empty and nothing left to search — run 'pending' for the ffmpeg fallback list"
        return
      fi
    fi
    sleep "$interval"
  done
}

cmd_status() {
  local movies
  movies=$(movies_json)
  echo "profile:   $(profile_id)"
  echo "on it:     $(jq --argjson pid "$(profile_id)" '[.[] | select(.qualityProfileId == $pid)] | length' <<<"$movies") movies"
  echo "pending:   $(pending_filter <<<"$movies" | jq -s 'length') movies, $(pending_filter <<<"$movies" | jq -s 'map(.gb) | add | . * 10 | round / 10') GB"
  echo "queue:     $(api GET '/queue?pageSize=1000' | jq -r '.totalRecords') items"
  api GET /rootfolder | jq -r '.[] | "free:      \(.freeSpace / 1e12 * 10 | round / 10) TB on \(.path)"'
}

case "${1:-}" in
  setup) cmd_setup ;;
  assign) cmd_assign "${2:-}" ;;
  pending) cmd_pending ;;
  search) cmd_search "${2:-}" ;;
  loop) cmd_loop "${2:-}" ;;
  status) cmd_status ;;
  *) sed -n '2,20p' "$0"; exit 1 ;;
esac
