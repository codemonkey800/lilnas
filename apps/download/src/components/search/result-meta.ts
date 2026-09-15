import type { Media } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'

import type { IconName } from 'src/components/ui/icon'
import { formatRuntime, UNKNOWN_VALUE } from 'src/lib/format'

/**
 * `search.mjs` tags each result `film` or `tv`. `video` cannot reach this page
 * — discovery only ever asks Radarr and Sonarr — but `Media` is a three-way
 * union, so the map is total rather than partial with a cast.
 */
export const RESULT_KIND_ICONS: Record<DownloadType, IconName> = {
  [DownloadType.Movie]: 'film',
  [DownloadType.Show]: 'tv',
  [DownloadType.Video]: 'play',
}

/**
 * Lowercase, matching `search.mjs` and the rest of the mono register this sits
 * in — the table's own column headers, the filter panel's group labels and the
 * hero's hint are all lowercase. It is the machine annotating, not a proper
 * noun.
 */
export const RESULT_KIND_LABELS: Record<DownloadType, string> = {
  [DownloadType.Movie]: 'movie',
  [DownloadType.Show]: 'show',
  [DownloadType.Video]: 'video',
}

/** `1977`, or an em dash when the upstream has no release date for it. */
export function resultYear(media: Media): string {
  return media.year === undefined ? UNKNOWN_VALUE : String(media.year)
}

/**
 * `Movie · 1977`. `search.mjs` pairs the kind with a per-kind fact — a year for
 * a film and a season count for a series — but `Media` carries no season
 * count, so the year does both jobs. See the task report.
 */
export function resultKindAndYear(media: Media): string {
  return `${RESULT_KIND_LABELS[media.type]} · ${resultYear(media)}`
}

/** `Comedy, Drama`, or an em dash. */
export function resultGenres(media: Media): string {
  return media.genres && media.genres.length > 0
    ? media.genres.join(', ')
    : UNKNOWN_VALUE
}

/**
 * `2h 01m`. `MediaBase.runtime` is **seconds** for movies and shows alike —
 * the mappers already multiplied Radarr's and Sonarr's minutes — and
 * `formatRuntime` returns the em dash for absent, zero or negative, because
 * "0m" would read as a fact.
 */
export function resultRuntime(media: Media): string {
  return formatRuntime(media.runtime, 'hours')
}
