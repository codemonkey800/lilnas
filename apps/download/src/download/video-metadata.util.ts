import type {
  TimeRange,
  VideoFile,
  VideoInfo,
  VideoSourceInfo,
} from '@lilnas/utils/download/types'

/** Tags beyond this are keyword stuffing, not something anyone reads. */
export const VIDEO_TAG_LIMIT = 30

/**
 * yt-dlp's extractor keys that are not already a platform's own spelling,
 * matched as a prefix so the per-kind extractors (`YoutubeTab`, `TwitchVod`,
 * `TwitchClips`) land on the same name. Anything else is shown as yt-dlp
 * spells it, which for most extractors (`TikTok`, `Instagram`, `Reddit`) is
 * already right.
 */
const PLATFORM_NAMES: readonly (readonly [prefix: string, name: string])[] = [
  ['bilibili', 'Bilibili'],
  ['twitch', 'Twitch'],
  ['twitter', 'X'],
  ['vimeo', 'Vimeo'],
  ['youtube', 'YouTube'],
]

/** yt-dlp's fallback for a page with a bare `<video>` - not a platform. */
const GENERIC_EXTRACTOR = 'generic'

const UPLOAD_DATE = /^(\d{4})(\d{2})(\d{2})$/

/** `''`, `null` and whitespace all mean "yt-dlp did not say". */
function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** A count, or `undefined` for anything that is not a real one. */
function count(value: number | null | undefined): number | undefined {
  return value != null && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined
}

function positive(value: number | null | undefined): number | undefined {
  return value != null && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

/** `Youtube` -> `YouTube`, `Generic` -> nothing. */
export function platformName(
  extractorKey: string | null | undefined,
): string | undefined {
  const key = text(extractorKey)

  if (!key || key.toLowerCase() === GENERIC_EXTRACTOR) {
    return undefined
  }

  const lower = key.toLowerCase()
  const known = PLATFORM_NAMES.find(([prefix]) => lower.startsWith(prefix))

  return known ? known[1] : key
}

/** `20250304` -> `2025-03-04`, or `undefined` for anything else. */
export function uploadDay(
  uploadDate: string | null | undefined,
): string | undefined {
  const match = text(uploadDate)?.match(UPLOAD_DATE)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined
}

/** `01:02:03` -> `3723`. `TIME_REGEX` already vetted the shape. */
function clockSeconds(clock: string): number {
  return clock
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, 0)
}

/**
 * How long the downloaded file runs, in seconds. A clip is its requested
 * range, not the source's `duration` - `--download-sections` cuts exactly
 * that span.
 */
export function videoRuntime(
  duration: number | null | undefined,
  timeRange: TimeRange | null | undefined,
): number | undefined {
  if (timeRange) {
    const seconds = clockSeconds(timeRange.end) - clockSeconds(timeRange.start)
    return seconds > 0 ? seconds : undefined
  }

  const seconds = positive(duration)
  return seconds === undefined ? undefined : Math.round(seconds)
}

function tagList(tags: readonly string[] | null | undefined): string[] {
  const seen = new Map<string, string>()

  for (const tag of tags ?? []) {
    const trimmed = text(tag)
    const key = trimmed?.toLowerCase()

    if (trimmed && key && !seen.has(key)) {
      seen.set(key, trimmed)
    }
  }

  return [...seen.values()].slice(0, VIDEO_TAG_LIMIT)
}

/** Drops `undefined` keys, and answers `undefined` when none are left. */
function compact<T extends Record<string, unknown>>(value: T): T | undefined {
  const present = Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  )

  return Object.keys(present).length > 0 ? (present as T) : undefined
}

export interface VideoMetadata {
  fileInfo?: VideoFile
  runtime?: number
  sourceInfo?: VideoSourceInfo
}

/**
 * yt-dlp's `--dump-json` -> what the `videos` row keeps of it. Each part is
 * left out when yt-dlp reported nothing for it, so a patch built from this
 * never blanks a column.
 */
export function toVideoMetadata(
  info: VideoInfo,
  timeRange?: TimeRange | null,
): VideoMetadata {
  const tags = tagList(info.tags)
  const width = positive(info.width)
  const height = positive(info.height)

  return (
    compact({
      fileInfo: compact({
        fps: positive(info.fps),
        resolution:
          width && height
            ? `${Math.round(width)}x${Math.round(height)}`
            : undefined,
      }),
      runtime: videoRuntime(info.duration, timeRange),
      sourceInfo: compact({
        channel: text(info.channel) ?? text(info.uploader),
        channelUrl: text(info.channel_url) ?? text(info.uploader_url),
        commentCount: count(info.comment_count),
        likeCount: count(info.like_count),
        platform: platformName(info.extractor_key),
        publishedAt: uploadDay(info.upload_date),
        tags: tags.length > 0 ? tags : undefined,
        viewCount: count(info.view_count),
        wasLive: info.was_live === true ? true : undefined,
      }),
    }) ?? {}
  )
}
