import {
  DownloadType,
  type Movie,
  type Show,
  type TimeRange,
} from '@lilnas/utils/download/types'

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

/**
 * The one derivation point for `Media.id` / `jobs.media_id` (plan §"What
 * 'derived' means"). Takes the raw identifying fields rather than a full
 * `Media` object on purpose: for a movie/show it's the field already
 * present on `Movie`/`Show` before `.id` is ever set, and for a video it's
 * the `videos` row's own PK - hydrating a `Video`'s `.id` (§1.3) is exactly
 * `mediaId({type: Video, id: row.id})`, so the function must not require an
 * `id` that doesn't exist yet.
 */
export type MediaIdInput =
  | Pick<Movie, 'tmdbId' | 'type'>
  | Pick<Show, 'tvdbId' | 'type'>
  | { id: string; type: typeof DownloadType.Video }

export function mediaId(input: MediaIdInput): string {
  switch (input.type) {
    case DownloadType.Movie:
      return `tmdb:${input.tmdbId}`
    case DownloadType.Show:
      return `tvdb:${input.tvdbId}`
    case DownloadType.Video:
      return `video:${input.id}`
  }
}

/**
 * The inverse-ish half of `mediaId()` - strips the `tmdb:`/`tvdb:`/`video:`
 * prefix, leaving the raw external id (as a string; the caller `Number()`s
 * it for tmdb/tvdb) or `videos.id`. Used by `MediaResolverService`, which
 * receives `(type, mediaId)` pairs and needs the bare id back out to key a
 * library-cache lookup or a `videos` query.
 */
export function mediaIdSuffix(id: string): string {
  return id.slice(id.indexOf(':') + 1)
}
