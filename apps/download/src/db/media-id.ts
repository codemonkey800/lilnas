import { DownloadType, type TimeRange } from '@lilnas/utils/download/types'

/**
 * The dedupe key for a `videos` row - a clip and its full-length sibling are
 * distinct videos, so the time range is part of the key. Empty start/end
 * coalesce to `''`, matching migration `0003`'s
 * `COALESCE(json_extract(time_range,'$.start'),'')` exactly so the backfill
 * and the app compute the identical string for the identical input.
 */
export interface VideoNaturalKeyInput {
  sourceUrl: string
  timeRange?: TimeRange
}

export function videoNaturalKey({
  sourceUrl,
  timeRange,
}: VideoNaturalKeyInput): string {
  return `${sourceUrl}#${timeRange?.start ?? ''}-${timeRange?.end ?? ''}`
}

// `mediaId()` and `mediaIdSuffix()` moved to `@lilnas/utils` so clients
// outside this app (the Discord bot) spell keys the same way; re-exported so
// this module stays the one import site inside the app.
export {
  mediaId,
  type MediaIdInput,
  mediaIdSuffix,
} from '@lilnas/utils/download/media-id'

/**
 * The media type a derived key names, or `undefined` for an unrecognized
 * prefix. The exact inverse of `mediaId()`'s prefix choice, which is why it
 * lives beside it rather than next to any one caller - it is the one place a
 * raw `:id` path param becomes a type, and the reason a garbage key is
 * rejected before it can reach Radarr/Sonarr.
 */
export function mediaTypeFromKey(key: string): DownloadType | undefined {
  if (key.startsWith('tmdb:')) return DownloadType.Movie
  if (key.startsWith('tvdb:')) return DownloadType.Show
  if (key.startsWith('video:')) return DownloadType.Video
  return undefined
}
