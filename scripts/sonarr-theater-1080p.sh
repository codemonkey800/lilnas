#!/usr/bin/env bash
#
# TV counterpart of radarr-theater-1080p.sh: move the Sonarr library to 1080p
# x264 WEB releases so the theater app can direct-play episodes for a room of
# 5-7 viewers. Background and measurements:
#   docs/research/2026-07-31-multi-viewer-transcode-capacity.md
#
# Differences from the movie script, on purpose:
#   - WEB only (no Bluray-1080p): 1080p BluRay x264 TV episodes run 20-30 Mbps
#     and ~8 GB each; WEB-DL x264 is 3-8 Mbps. The theater streams over the
#     internet, so WEB is both the smaller and the better fit.
#   - The unit of work is a SEASON, not a title — Sonarr grabs season packs, so
#     one search covers many episodes with a handful of indexer calls.
#   - cutoffFormatScore is 0 rather than 100, so an H.264 file whose name just
#     doesn't mention the codec (score 0) is left alone instead of being churned
#     by RSS; only the x265/AV1/foreign files (-10000) are below the cutoff.
#
# Usage:
#   scripts/sonarr-theater-1080p.sh setup                 # custom formats + profile (idempotent)
#   scripts/sonarr-theater-1080p.sh assign [seriesId]     # put every series (or one) on the profile
#   scripts/sonarr-theater-1080p.sh pending               # seasons whose files still need replacing
#   scripts/sonarr-theater-1080p.sh search [N]            # search the next N pending seasons (default 5)
#   scripts/sonarr-theater-1080p.sh loop [N]              # search N seasons whenever the queue drains
#   scripts/sonarr-theater-1080p.sh status                # queue / pending / disk summary
#
# Env: SONARR_URL, SONARR_API_KEY (both default to the prod container + config.xml),
#      STATE_FILE (series:season keys already searched, so a season with no
#      release isn't re-searched every round; default ~/.cache/...).

set -euo pipefail

PROFILE_NAME='lilnas · Theater 1080p x264 (WEB)'
CF_X264='lilnas · x264'
CF_X265='lilnas · x265/HEVC'
CF_HDR='lilnas · HDR/DV'
CF_AV1='lilnas · AV1'
# Foreign-only releases are blocked outright. Multi-audio ones (MULTi WEB-DLs
# from French groups, JPN-tagged anime, NORDiC) carry an English track and are
# often the only WEB-DL of a show, so they're merely scored below a clean
# release — and an existing H.264 multi-audio file is NOT treated as pending.
CF_FOREIGN='lilnas · Non-English'
CF_MULTI='lilnas · Multi-audio'
FOREIGN_REGEX='\b(iTA|ITALIAN|German|FRENCH|TRUEFRENCH|VOSTFR|SPANISH|CASTELLANO|LATINO|HINDI|RUS|KOR|CHI|TR|TURKISH|TURK)\b'
MULTI_REGEX='\b(MULTi\d?|MULTI|MultiAudio|Multi\d|Dual[ ._-]?Audio|DUAL|JPN|NORDiC)\b'
STATE_FILE=${STATE_FILE:-$HOME/.cache/sonarr-theater-1080p.searched}
RESEARCH_AFTER_SECONDS=$((24 * 3600))

if [[ -z "${SONARR_API_KEY:-}" ]]; then
  SONARR_API_KEY=$(grep -oP '(?<=<ApiKey>)[^<]+' /storage/app-data/sonarr/config.xml)
fi
if [[ -z "${SONARR_URL:-}" ]]; then
  ip=$(docker inspect lilnas-sonarr-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
  SONARR_URL="http://${ip}:8989"
fi

api() {
  local method=$1 path=$2
  shift 2
  curl -sS -f -X "$method" -H "X-Api-Key: $SONARR_API_KEY" -H 'Content-Type: application/json' \
    "${SONARR_URL}/api/v3${path}" "$@"
}

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
  local x264 x265 hdr av1 foreign
  x264=$(ensure_cf "$CF_X264" '[xh][ ._-]?264|\bAVC\b')
  x265=$(ensure_cf "$CF_X265" '[xh][ ._-]?265|\bHEVC(\b|\d)')
  hdr=$(ensure_cf "$CF_HDR" '\b(DV|DoVi|Dolby[ ._-]?Vision|HDR10\+?|HDR)\b')
  av1=$(ensure_cf "$CF_AV1" '\bAV1\b')
  foreign=$(ensure_cf "$CF_FOREIGN" "$FOREIGN_REGEX")
  multi=$(ensure_cf "$CF_MULTI" "$MULTI_REGEX")
  echo "custom formats: x264=$x264 x265=$x265 hdr=$hdr av1=$av1 foreign=$foreign multi=$multi"

  local existing
  existing=$(profile_id)
  if [[ -n "$existing" ]]; then
    echo "profile exists: id=$existing"
    return
  fi

  api GET /qualityprofile \
    | jq -c --arg n "$PROFILE_NAME" --argjson x264 "$x264" --argjson x265 "$x265" --argjson hdr "$hdr" \
        --argjson av1 "$av1" --argjson foreign "$foreign" --argjson multi "$multi" '
      def allowed: ["WEB 1080p", "HDTV-1080p", "WEB 720p", "HDTV-720p"];
      (.[] | select(.name == "lilnas · HD (up to 1080p)")) as $p
      | ($p.items | map(select(.name == "WEB 1080p") | .id) | first) as $cutoff
      | $p
      | del(.id)
      | .name = $n
      | .upgradeAllowed = true
      | .cutoff = $cutoff
      | .minFormatScore = -100
      | .cutoffFormatScore = 0
      | .minUpgradeFormatScore = 1
      | .items |= map(.allowed = ((.name // .quality.name) as $q | allowed | index($q) != null))
      | .formatItems = [
          { format: $x264, score: 100 },
          { format: $x265, score: -10000 },
          { format: $hdr, score: -10000 },
          { format: $av1, score: -10000 },
          { format: $foreign, score: -10000 },
          { format: $multi, score: -50 }
        ]
    ' \
    | api POST /qualityprofile -d @- | jq -r '"profile created: id=\(.id)"'
}

series_json() {
  api GET /series
}

# One JSON line per season that still holds a file the theater can't
# direct-play: HEVC/AV1/MPEG-2/VC-1 video, >8-bit, or a foreign-only release.
# Fetches every series' episode files, so cache the result per invocation.
PENDING_CACHE=""
pending_seasons() {
  if [[ -z "$PENDING_CACHE" ]]; then
    PENDING_CACHE=$(mktemp)
    trap 'rm -f "$PENDING_CACHE"' EXIT
    series_json | jq -r '.[] | select(.statistics.episodeFileCount > 0) | "\(.id)\t\(.title)\t\(.qualityProfileId)\t\(.monitored)"' \
      | while IFS=$'\t' read -r sid title pid monitored; do
          api GET "/episodefile?seriesId=$sid" \
            | jq -c --arg foreign "$FOREIGN_REGEX" --argjson sid "$sid" --arg title "$title" \
                --argjson pid "$pid" --argjson monitored "$monitored" '
              map(select(
                (.mediaInfo.videoCodec // "" | test("HEVC|x265|h265|AV1|MPEG2|VC1"; "i"))
                or ((.mediaInfo.videoBitDepth // 8) != 8)
                or (.relativePath | test($foreign))
              ))
              | group_by(.seasonNumber)[]
              | { sid: $sid, title: $title, pid: $pid, monitored: $monitored,
                  season: .[0].seasonNumber, episodes: length,
                  gb: ((map(.size) | add) / 1e9 * 10 | round / 10) }
            '
        done >"$PENDING_CACHE"
  fi
  cat "$PENDING_CACHE"
}

cmd_assign() {
  local pid ids
  pid=$(profile_id)
  [[ -n "$pid" ]] || { echo "run setup first" >&2; exit 1; }
  if [[ -n "${1:-}" ]]; then
    ids="[$1]"
  else
    ids=$(series_json | jq -c '[.[].id]')
  fi
  jq -n --argjson ids "$ids" --argjson pid "$pid" '{ seriesIds: $ids, qualityProfileId: $pid }' \
    | api PUT /series/editor -d @- | jq -r 'length | "assigned profile to \(.) series"'
}

cmd_pending() {
  pending_seasons | jq -r '"\(.sid)\tS\(.season | tostring | if length < 2 then "0" + . else . end)\t\(.title)\t\(.episodes) eps\t\(.gb) GB"' | sort -t$'\t' -k3,3 -k2,2
}

queued_series_ids() {
  api GET '/queue?pageSize=1000' | jq -c '[.records[].seriesId] | unique'
}

recently_searched_keys() {
  mkdir -p "$(dirname "$STATE_FILE")"
  touch "$STATE_FILE"
  awk -v cutoff="$(($(date +%s) - RESEARCH_AFTER_SECONDS))" '$2 >= cutoff { print $1 }' "$STATE_FILE" \
    | jq -Rsc 'split("\n") | map(select(length > 0))'
}

cmd_search() {
  local n=${1:-5} pid queued skip picks
  pid=$(profile_id)
  queued=$(queued_series_ids)
  skip=$(recently_searched_keys)
  picks=$(pending_seasons | jq -sc --argjson pid "$pid" --argjson queued "$queued" --argjson skip "$skip" --argjson n "$n" '
    map(select(.pid == $pid))
    | map(select(.sid as $s | $queued | index($s) | not))
    | map(select("\(.sid):\(.season)" as $k | $skip | index($k) | not))
    | .[:$n]
  ')
  if [[ "$picks" == "[]" ]]; then
    echo "nothing to search (every pending season is queued or was searched in the last 24h)"
    return 1
  fi
  jq -c '.[]' <<<"$picks" | while read -r pick; do
    jq -c '{ name: "SeasonSearch", seriesId: .sid, seasonNumber: .season }' <<<"$pick" \
      | api POST /command -d @- >/dev/null
    jq -r '"queued search: \(.title) S\(.season) (\(.episodes) eps)"' <<<"$pick"
    jq -r --arg now "$(date +%s)" '"\(.sid):\(.season)\t\($now)"' <<<"$pick" >>"$STATE_FILE"
  done
}

cmd_status() {
  local pending
  pending=$(pending_seasons | jq -s '.')
  echo "profile:   $(profile_id)"
  echo "on it:     $(series_json | jq --argjson pid "$(profile_id)" '[.[] | select(.qualityProfileId == $pid)] | length') series"
  echo "pending:   $(jq 'length' <<<"$pending") seasons, $(jq 'map(.episodes) | add // 0' <<<"$pending") episodes, $(jq 'map(.gb) | add // 0 | . * 10 | round / 10' <<<"$pending") GB"
  echo "queue:     $(api GET '/queue?pageSize=1000' | jq -r '[.records[].downloadId] | unique | length') downloads"
  api GET /rootfolder | jq -r '.[] | "free:      \(.freeSpace / 1e12 * 10 | round / 10) TB on \(.path)"'
}

cmd_loop() {
  local n=${1:-5} low=${QUEUE_LOW:-5} interval=${INTERVAL:-600} queue
  while true; do
    echo "== $(date '+%F %T')"
    cmd_status
    # A season pack is one download but N queue rows; throttle on downloads,
    # and don't let one stuck import (warning state) hold the loop forever.
    queue=$(api GET '/queue?pageSize=1000' | jq -r '[.records[] | select(.trackedDownloadStatus != "warning") | .downloadId] | unique | length')
    if (( queue < low )); then
      if ! cmd_search "$n" && (( queue == 0 )); then
        echo "done: queue empty and nothing left to search — run 'pending' for the ffmpeg fallback list"
        return
      fi
    fi
    rm -f "$PENDING_CACHE"; PENDING_CACHE=""
    sleep "$interval"
  done
}

case "${1:-}" in
  setup) cmd_setup ;;
  assign) cmd_assign "${2:-}" ;;
  pending) cmd_pending ;;
  search) cmd_search "${2:-}" ;;
  loop) cmd_loop "${2:-}" ;;
  status) cmd_status ;;
  *) sed -n '2,30p' "$0"; exit 1 ;;
esac
