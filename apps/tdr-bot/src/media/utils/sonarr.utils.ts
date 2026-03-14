import {
  MonitorSeriesOptions,
  SeriesSearchResult,
  SonarrImageType,
  SonarrMonitorType,
  SonarrSeries,
  SonarrSeriesResource,
  UnmonitorSeriesOptions,
} from 'src/media/types/sonarr.types'

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
 * Extract series information for logging and display
 */
export function extractSeriesInfo(
  series: SonarrSeriesResource | SeriesSearchResult,
) {
  return {
    title: series.title,
    year: series.year,
    tvdbId: series.tvdbId,
    status: series.status,
    network: series.network,
    seasonCount: series.seasons?.length || 0,
  }
}

/**
 * Validate series data for completeness
 */
export function validateSeriesData(series: SonarrSeriesResource): {
  isValid: boolean
  missingFields: string[]
} {
  const missingFields: string[] = []

  if (!series.title) missingFields.push('title')
  if (!series.tvdbId) missingFields.push('tvdbId')
  if (!series.status) missingFields.push('status')
  if (!series.genres || series.genres.length === 0) missingFields.push('genres')
  if (!series.seasons || series.seasons.length === 0)
    missingFields.push('seasons')

  return {
    isValid: missingFields.length === 0,
    missingFields,
  }
}

/**
 * Generate a title slug for the series
 */
export function generateTitleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
}

/**
 * Format series runtime for display
 */
export function formatRuntime(runtime?: number): string {
  if (!runtime) return 'Unknown'

  const hours = Math.floor(runtime / 60)
  const minutes = runtime % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

/**
 * Format series status for display
 */
export function formatSeriesStatus(status: string, ended: boolean): string {
  if (ended) return 'Ended'

  switch (status.toLowerCase()) {
    case 'continuing':
      return 'Continuing'
    case 'ended':
      return 'Ended'
    case 'upcoming':
      return 'Upcoming'
    case 'deleted':
      return 'Deleted'
    default:
      return status
  }
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

/**
 * Check if selection has episode-specific selections
 */
export function hasEpisodeSelections(
  selection: Array<{ season: number; episodes?: number[] }>,
): boolean {
  return selection.some(sel => sel.episodes && sel.episodes.length > 0)
}

/**
 * Determine unmonitoring strategy based on selection
 */
export function determineUnmonitoringStrategy(
  options: UnmonitorSeriesOptions,
): {
  isFullSeriesDeletion: boolean
  hasSeasonSelections: boolean
  hasEpisodeSelections: boolean
} {
  if (!options.selection) {
    // No selection means delete entire series
    return {
      isFullSeriesDeletion: true,
      hasSeasonSelections: false,
      hasEpisodeSelections: false,
    }
  }

  const hasEpisodes = options.selection.some(
    sel => sel.episodes && sel.episodes.length > 0,
  )

  return {
    isFullSeriesDeletion: false,
    hasSeasonSelections: !hasEpisodes,
    hasEpisodeSelections: hasEpisodes,
  }
}

/**
 * Check if a series has any monitored episodes remaining
 */
export function hasRemainingMonitoredContent(
  series: SonarrSeries,
  episodesBySeasonMap: Map<number, Array<{ id: number; monitored: boolean }>>,
): boolean {
  // Check all seasons (excluding specials - season 0)
  for (const season of series.seasons) {
    if (season.seasonNumber === 0) continue // Skip specials

    const episodes = episodesBySeasonMap.get(season.seasonNumber) || []
    const monitoredEpisodes = episodes.filter(ep => ep.monitored)

    if (monitoredEpisodes.length > 0) {
      return true
    }
  }

  return false
}

/**
 * Validate unmonitoring selection for consistency
 */
export function validateUnmonitoringSelection(
  selection: Array<{ season: number; episodes?: number[] }>,
): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check for duplicate seasons
  const seasonNumbers = selection.map(sel => sel.season)
  const duplicateSeasons = seasonNumbers.filter(
    (season, index) => seasonNumbers.indexOf(season) !== index,
  )

  if (duplicateSeasons.length > 0) {
    errors.push(`Duplicate seasons found: ${duplicateSeasons.join(', ')}`)
  }

  // Check for invalid season numbers
  const invalidSeasons = seasonNumbers.filter(season => season < 0)
  if (invalidSeasons.length > 0) {
    errors.push(
      `Invalid season numbers (must be >= 0): ${invalidSeasons.join(', ')}`,
    )
  }

  // Check for invalid episode numbers
  for (const sel of selection) {
    if (sel.episodes) {
      const invalidEpisodes = sel.episodes.filter(ep => ep <= 0)
      if (invalidEpisodes.length > 0) {
        errors.push(
          `Invalid episode numbers in season ${sel.season} (must be > 0): ${invalidEpisodes.join(', ')}`,
        )
      }

      // Check for duplicate episodes within a season
      const duplicateEpisodes = sel.episodes.filter(
        (ep, index) => sel.episodes!.indexOf(ep) !== index,
      )
      if (duplicateEpisodes.length > 0) {
        errors.push(
          `Duplicate episodes in season ${sel.season}: ${duplicateEpisodes.join(', ')}`,
        )
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * Extract unmonitoring operation summary for logging
 */
export function extractUnmonitoringOperationSummary(
  options: UnmonitorSeriesOptions,
): {
  operationType: 'full_series' | 'seasons' | 'episodes'
  seasonCount: number
  episodeCount: number
  summary: string
} {
  if (!options.selection) {
    return {
      operationType: 'full_series',
      seasonCount: 0,
      episodeCount: 0,
      summary: 'Delete entire series',
    }
  }

  const totalEpisodes = options.selection.reduce(
    (total, sel) => total + (sel.episodes?.length || 0),
    0,
  )

  if (totalEpisodes === 0) {
    // Season-level unmonitoring
    return {
      operationType: 'seasons',
      seasonCount: options.selection.length,
      episodeCount: 0,
      summary: `Unmonitor ${options.selection.length} season(s): ${options.selection.map(s => s.season).join(', ')}`,
    }
  }

  // Episode-level unmonitoring
  return {
    operationType: 'episodes',
    seasonCount: options.selection.length,
    episodeCount: totalEpisodes,
    summary: `Unmonitor ${totalEpisodes} episode(s) across ${options.selection.length} season(s)`,
  }
}
