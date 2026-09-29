import type {
  EpisodeResource as SdkEpisodeResource,
  QueueResource as SdkQueueResource,
  SeriesResource,
} from '@lilnas/media/sonarr'
import type { LoggerService } from '@nestjs/common'

import {
  DownloadingSeriesSchema,
  EpisodeResourceSchema,
  SonarrSeriesResourceSchema,
  SonarrSeriesSchema,
} from 'src/media/schemas/sonarr.schemas'
import {
  DownloadingSeries,
  EpisodeResource,
  KeptPackDownload,
  SeriesSearchResult,
  SonarrImageType,
  SonarrSeries,
  SonarrSeriesResource,
  SonarrSeriesUpdate,
} from 'src/media/types/sonarr.types'
import {
  generateTitleSlug,
  parseEachSkippingInvalid,
  stripNulls,
} from 'src/media/utils/media.utils'

/**
 * A lookup term Sonarr v5's `/series/lookup` rejects with a 400
 * (`InvalidSearchTermException`): anything that reads as a path on either OS
 * - a leading `/` or `\`, or a drive letter like `C:\`. Mirrors Sonarr's
 * `IsPathValid(PathValidationType.AnyOs)` check in `SkyHookProxy`.
 */
const PATH_LIKE_LOOKUP_TERM = /^([\\/]|[A-Za-z]:\\)/

/**
 * Whether `term` reads as a file path rather than a title - Sonarr v5 answers
 * a lookup for one with a 400, and no series could match it anyway. The term
 * is trimmed first, as `SonarrService.searchShows()` trims before looking up.
 */
export function isPathLikeLookupTerm(term: string): boolean {
  return PATH_LIKE_LOOKUP_TERM.test(term.trim())
}

/**
 * Validates an SDK SeriesResource as a SonarrSeriesResource (lookup/search
 * result) using the full Zod schema. Null values from the SDK are stripped to
 * undefined before parsing so all required fields are properly validated.
 *
 * Throws a ZodError if any required field is missing or invalid.
 */
export function toSonarrSeriesResource(
  r: SeriesResource,
): SonarrSeriesResource {
  return SonarrSeriesResourceSchema.parse(stripNulls(r)) as SonarrSeriesResource
}

/**
 * Validates an array of SDK SeriesResource objects as SonarrSeriesResources,
 * skipping (and logging) any that fail validation.
 */
export function toSonarrSeriesResourceArray(
  rs: SeriesResource[],
  logger: Pick<LoggerService, 'warn'>,
): SonarrSeriesResource[] {
  return parseEachSkippingInvalid(
    rs,
    toSonarrSeriesResource,
    logger,
    'series resource',
  )
}

/**
 * Validates an SDK SeriesResource as a full SonarrSeries (library series)
 * using the full Zod schema. Null values from the SDK are stripped to undefined
 * before parsing so all required fields (id, path, monitored, etc.) are
 * properly validated.
 *
 * Throws a ZodError if any required field is missing or invalid.
 */
export function toSonarrSeries(r: SeriesResource): SonarrSeries {
  return SonarrSeriesSchema.parse(stripNulls(r)) as SonarrSeries
}

/**
 * Validates an array of SDK SeriesResource objects as SonarrSeries, skipping
 * (and logging) any that fail validation.
 */
export function toSonarrSeriesArray(
  rs: SeriesResource[],
  logger: Pick<LoggerService, 'warn'>,
): SonarrSeries[] {
  return parseEachSkippingInvalid(rs, toSonarrSeries, logger, 'series')
}

/**
 * Applies a bot-side update to the raw series Sonarr returned, producing the
 * body for `PUT /series/{id}`.
 *
 * Sonarr's PUT replaces the whole series, so the body must carry every field
 * the GET returned — including ones the bot's schema doesn't model (e.g.
 * `monitorNewItems`); dropping them resets them to Sonarr's defaults. Only the
 * requested fields change: the series `monitored` flag and each matching
 * season's `monitored` flag. Seasons are matched by `seasonNumber` (season 0
 * included); an update for a season Sonarr didn't return is ignored.
 */
export function applySeriesUpdate(
  raw: SeriesResource,
  updates: SonarrSeriesUpdate,
): SeriesResource {
  const patched: SeriesResource = { ...raw }

  if (updates.monitored != null) {
    patched.monitored = updates.monitored
  }

  if (updates.seasons != null && raw.seasons != null) {
    const monitoredBySeason = new Map(
      updates.seasons.map(season => [season.seasonNumber, season.monitored]),
    )
    patched.seasons = raw.seasons.map(season => {
      const monitored =
        season.seasonNumber != null
          ? monitoredBySeason.get(season.seasonNumber)
          : undefined
      return monitored != null ? { ...season, monitored } : season
    })
  }

  return patched
}

/**
 * Validates an SDK EpisodeResource as the internal EpisodeResource type using
 * the full Zod schema. Null values from the SDK are stripped to undefined
 * before parsing so all required fields are properly validated.
 *
 * Throws a ZodError if any required field is missing or invalid.
 */
export function toEpisodeResource(r: SdkEpisodeResource): EpisodeResource {
  return EpisodeResourceSchema.parse(stripNulls(r)) as EpisodeResource
}

/**
 * Validates an array of SDK EpisodeResource objects as internal
 * EpisodeResources, skipping (and logging) any that fail validation.
 */
export function toEpisodeResourceArray(
  rs: SdkEpisodeResource[],
  logger: Pick<LoggerService, 'warn'>,
): EpisodeResource[] {
  return parseEachSkippingInvalid(rs, toEpisodeResource, logger, 'episode')
}

/**
 * Queue rows that belong to one download. Sonarr's `/queue` emits one row per
 * episode, so a season pack shows up as N rows sharing a `downloadId` (each
 * carrying the whole pack's size). Rows without a `downloadId` are pending
 * releases (`delay`, `downloadClientUnavailable`, `fallback`) and form a group
 * of their own.
 */
export interface QueueDownloadGroup {
  downloadId?: string
  rows: [SdkQueueResource, ...SdkQueueResource[]]
}

/**
 * Groups queue rows by `downloadId`, preserving first-appearance order. Rows
 * with no `downloadId` each become a single-row group.
 */
export function groupQueueByDownload(
  items: readonly SdkQueueResource[],
): QueueDownloadGroup[] {
  const groups: QueueDownloadGroup[] = []
  const byDownloadId = new Map<string, QueueDownloadGroup>()

  for (const item of items) {
    const downloadId = item.downloadId ?? undefined
    if (downloadId == null || downloadId === '') {
      groups.push({ rows: [item] })
      continue
    }

    const existing = byDownloadId.get(downloadId)
    if (existing) {
      existing.rows.push(item)
    } else {
      const group: QueueDownloadGroup = { downloadId, rows: [item] }
      byDownloadId.set(downloadId, group)
      groups.push(group)
    }
  }

  return groups
}

interface EpisodeRef {
  seasonNumber: number
  episodeNumber: number
}

function episodeRefOf(row: SdkQueueResource): EpisodeRef | undefined {
  const seasonNumber = row.seasonNumber ?? row.episode?.seasonNumber
  const episodeNumber = row.episode?.episodeNumber
  if (seasonNumber == null || episodeNumber == null) return undefined
  return { seasonNumber, episodeNumber }
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * Formats the episodes covered by queue rows as a compact label: consecutive
 * runs collapse ("S01E01–E10"), gaps and seasons are comma-separated
 * ("S01E01–E03, S01E05, S02E01"). Returns an empty string when no row carries
 * season and episode numbers (the queue was fetched without `includeEpisode`).
 */
export function formatEpisodeRange(rows: readonly SdkQueueResource[]): string {
  const unique = new Map<string, EpisodeRef>()
  for (const row of rows) {
    const ref = episodeRefOf(row)
    if (ref) unique.set(`${ref.seasonNumber}:${ref.episodeNumber}`, ref)
  }

  const sorted = [...unique.values()].sort(
    (a, b) =>
      a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber,
  )

  const parts: string[] = []
  let runStart: EpisodeRef | undefined
  let runEnd: EpisodeRef | undefined

  const flush = () => {
    if (runStart == null || runEnd == null) return
    const head = `S${pad2(runStart.seasonNumber)}E${pad2(runStart.episodeNumber)}`
    parts.push(
      runEnd.episodeNumber === runStart.episodeNumber
        ? head
        : `${head}–E${pad2(runEnd.episodeNumber)}`,
    )
  }

  for (const ref of sorted) {
    if (
      runEnd != null &&
      ref.seasonNumber === runEnd.seasonNumber &&
      ref.episodeNumber === runEnd.episodeNumber + 1
    ) {
      runEnd = ref
      continue
    }
    flush()
    runStart = ref
    runEnd = ref
  }
  flush()

  return parts.join(', ')
}

function episodeCountOf(rows: readonly SdkQueueResource[]): number {
  const episodeIds = new Set<number>()
  let withoutId = 0
  for (const row of rows) {
    if (row.episodeId != null) episodeIds.add(row.episodeId)
    else withoutId++
  }
  return episodeIds.size + withoutId
}

/**
 * Maps one grouped download to a DownloadingSeries and validates via the Zod
 * schema. Every row of a pack carries the whole pack's size, so size and
 * progress come from a single row and are counted once. Episode-level fields
 * (episodeId, episodeNumber, episodeTitle) are only set for single-episode
 * downloads; packs are described by `episodeLabel` and `episodeCount`.
 */
export function toDownloadingSeries(
  group: QueueDownloadGroup,
): DownloadingSeries {
  const [first] = group.rows
  const size = first.size ?? 0
  const sizeleft = first.sizeleft ?? 0
  const downloadedBytes = Math.max(0, size - sizeleft)
  const progressPercent =
    size > 0 ? Math.min(100, Math.max(0, (downloadedBytes / size) * 100)) : 0
  const status = first.status ?? ''
  const isActive = ['downloading', 'queued'].includes(status.toLowerCase())

  const episodeCount = episodeCountOf(group.rows)
  const isSingleEpisode = episodeCount <= 1

  const seasonNumbers = new Set(
    group.rows
      .map(row => row.seasonNumber ?? row.episode?.seasonNumber)
      .filter((n): n is number => n != null),
  )
  const onlySeason =
    seasonNumbers.size === 1 ? [...seasonNumbers][0] : undefined

  const episodeLabel =
    formatEpisodeRange(group.rows) ||
    (onlySeason != null ? `S${pad2(onlySeason)}` : '') ||
    first.title ||
    'Unknown episode'

  return DownloadingSeriesSchema.parse({
    id: first.id ?? 0,
    downloadId: group.downloadId,
    seriesId: first.seriesId ?? undefined,
    episodeId: isSingleEpisode ? (first.episodeId ?? undefined) : undefined,
    seriesTitle: first.series?.title || 'Unknown Series',
    episodeTitle: isSingleEpisode
      ? first.episode?.title || first.title || undefined
      : undefined,
    seasonNumber: onlySeason,
    episodeNumber: isSingleEpisode ? first.episode?.episodeNumber : undefined,
    episodeCount,
    episodeLabel,
    size,
    sizeleft,
    status,
    trackedDownloadStatus: first.trackedDownloadStatus ?? undefined,
    trackedDownloadState: undefined,
    protocol: first.protocol ?? '',
    downloadClient: first.downloadClient ?? undefined,
    indexer: undefined,
    estimatedCompletionTime: first.estimatedCompletionTime ?? undefined,
    timeleft: first.timeleft ?? undefined,
    added: undefined,
    progressPercent,
    downloadedBytes,
    isActive,
  }) as DownloadingSeries
}

/**
 * Describes a pack that was kept because only part of it was requested.
 */
export function toKeptPackDownload(
  group: QueueDownloadGroup & { downloadId: string },
  isRequested: (row: SdkQueueResource) => boolean,
): KeptPackDownload {
  const requestedRows = group.rows.filter(isRequested)
  const coveredEpisodes =
    formatEpisodeRange(group.rows) || `${episodeCountOf(group.rows)} episodes`
  const unmonitoredEpisodes =
    formatEpisodeRange(requestedRows) ||
    `${episodeCountOf(requestedRows)} episodes`

  return {
    downloadId: group.downloadId,
    title: group.rows[0].title ?? undefined,
    coveredEpisodes,
    unmonitoredEpisodes,
  }
}

/**
 * Human-readable summary of a kept pack, e.g.
 * "S01E01–E10 pack still downloading; S01E03 unmonitored".
 */
export function describeKeptPack(pack: KeptPackDownload): string {
  return `${pack.coveredEpisodes} pack still downloading; ${pack.unmonitoredEpisodes} unmonitored`
}

/**
 * Sanitize year value for TV series data
 * @param year - Raw year value from API
 * @returns Valid year or undefined for invalid values
 */
function sanitizeYear(year?: number): number | undefined {
  if (year === null || year === undefined || year <= 1850 || year >= 2100) {
    return undefined
  }
  return year
}

/**
 * Transform raw Sonarr series resources to simplified search results
 */
export function transformToSearchResults(
  seriesResources: SonarrSeriesResource[],
): SeriesSearchResult[] {
  return seriesResources.map(series => {
    // Extract poster and backdrop images
    const posterImage = series.images.find(
      img => img.coverType === SonarrImageType.POSTER,
    )
    const backdropImage = series.images.find(
      img => img.coverType === SonarrImageType.FANART,
    )

    const result: SeriesSearchResult = {
      tvdbId: series.tvdbId,
      tmdbId: series.tmdbId,
      imdbId: series.imdbId,
      title: series.title,
      titleSlug:
        series.titleSlug || generateTitleSlug(series.title || 'unknown-series'),
      sortTitle: series.sortTitle,
      year: sanitizeYear(series.year),
      firstAired: series.firstAired,
      lastAired: series.lastAired,
      overview: series.overview,
      runtime: series.runtime,
      network: series.network,
      status: series.status,
      seriesType: series.seriesType || 'standard', // Default to standard if not provided
      seasons: series.seasons || [],
      genres: series.genres || [],
      // Sonarr reports { votes: 0, value: 0 } for unrated series
      rating: series.ratings?.votes ? series.ratings.value : undefined,
      posterPath: posterImage?.remoteUrl || posterImage?.url,
      backdropPath: backdropImage?.remoteUrl || backdropImage?.url,
      certification: series.certification,
      ended: series.ended,
    }

    return result
  })
}
