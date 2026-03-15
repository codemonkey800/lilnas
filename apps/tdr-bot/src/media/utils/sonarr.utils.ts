import type {
  EpisodeResource as SdkEpisodeResource,
  QueueResource as SdkQueueResource,
  SeriesResource,
} from '@lilnas/media/sonarr'

import {
  DownloadingSeriesSchema,
  EpisodeResourceSchema,
  SonarrSeriesResourceSchema,
  SonarrSeriesSchema,
} from 'src/media/schemas/sonarr.schemas'
import {
  DownloadingSeries,
  EpisodeResource,
  MonitorSeriesOptions,
  SeriesSearchResult,
  SonarrImageType,
  SonarrMonitorType,
  SonarrSeries,
  SonarrSeriesResource,
} from 'src/media/types/sonarr.types'
import { generateTitleSlug, stripNulls } from 'src/media/utils/media.utils'

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
 * Validates an array of SDK SeriesResource objects as SonarrSeriesResources.
 */
export function toSonarrSeriesResourceArray(
  rs: SeriesResource[],
): SonarrSeriesResource[] {
  return rs.map(toSonarrSeriesResource)
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
 * Validates an array of SDK SeriesResource objects as SonarrSeries.
 */
export function toSonarrSeriesArray(rs: SeriesResource[]): SonarrSeries[] {
  return rs.map(toSonarrSeries)
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
 * Validates an array of SDK EpisodeResource objects as internal EpisodeResources.
 */
export function toEpisodeResourceArray(
  rs: SdkEpisodeResource[],
): EpisodeResource[] {
  return rs.map(toEpisodeResource)
}

/**
 * Maps a Sonarr SDK QueueResource to a DownloadingSeries and validates via the
 * Zod schema. Replaces scattered inline `as` casts so type mismatches surface
 * at runtime through a ZodError rather than being silently ignored.
 */
export function toDownloadingSeries(item: SdkQueueResource): DownloadingSeries {
  const size = item.size ?? 0
  const sizeleft = item.sizeleft ?? 0
  const downloadedBytes = Math.max(0, size - sizeleft)
  const progressPercent =
    size > 0 ? Math.min(100, Math.max(0, (downloadedBytes / size) * 100)) : 0
  const status = item.status ?? ''
  const isActive = ['downloading', 'queued'].includes(status.toLowerCase())

  return DownloadingSeriesSchema.parse({
    id: item.id ?? 0,
    seriesId: item.seriesId ?? undefined,
    episodeId: item.episodeId ?? undefined,
    seriesTitle: item.series?.title || 'Unknown Series',
    episodeTitle: item.episode?.title || item.title || undefined,
    seasonNumber: item.episode?.seasonNumber,
    episodeNumber: item.episode?.episodeNumber,
    size,
    sizeleft,
    status,
    trackedDownloadStatus: item.trackedDownloadStatus ?? undefined,
    trackedDownloadState: undefined,
    protocol: item.protocol ?? '',
    downloadClient: item.downloadClient ?? undefined,
    indexer: undefined,
    estimatedCompletionTime: item.estimatedCompletionTime ?? undefined,
    timeleft: item.timeleft ?? undefined,
    added: undefined,
    progressPercent,
    downloadedBytes,
    isActive,
  }) as DownloadingSeries
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

    // Calculate average rating from available sources
    let averageRating: number | undefined
    if (series.ratings) {
      const ratings = [
        series.ratings.imdb?.value,
        series.ratings.theMovieDb?.value,
        series.ratings.tvdb?.value,
        series.ratings.rottenTomatoes
          ? series.ratings.rottenTomatoes.value / 10 // Convert from 0-100 to 0-10
          : undefined,
      ].filter((rating): rating is number => rating !== undefined)

      if (ratings.length > 0) {
        averageRating =
          ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
      }
    }

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
      rating: averageRating,
      posterPath: posterImage?.remoteUrl || posterImage?.url,
      backdropPath: backdropImage?.remoteUrl || backdropImage?.url,
      certification: series.certification,
      ended: series.ended,
    }

    return result
  })
}

/**
 * Determine monitoring strategy based on selection
 */
export function determineMonitoringStrategy(
  seasons: Array<{ seasonNumber: number; monitored: boolean }>,
  options: MonitorSeriesOptions,
): {
  monitorType: SonarrMonitorType
  seasons: Array<{ seasonNumber: number; monitored: boolean }>
} {
  if (!options.selection) {
    // Monitor all seasons except specials (season 0)
    return {
      monitorType: SonarrMonitorType.ALL,
      seasons: seasons.map(season => ({
        ...season,
        monitored: season.seasonNumber > 0,
      })),
    }
  }

  // Custom selection - enable seasons that have any episode selections
  // This ensures episode-level monitoring will work correctly
  return {
    monitorType: SonarrMonitorType.ALL,
    seasons: seasons.map(season => {
      // Enable season if it has any selections (either whole season or specific episodes)
      const hasSelection = options.selection!.some(
        sel => sel.season === season.seasonNumber,
      )
      return { ...season, monitored: hasSelection }
    }),
  }
}
