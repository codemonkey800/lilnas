import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'
import { performance } from 'perf_hooks'

import { SonarrClient } from 'src/media/clients/sonarr.client'
import {
  MonitorSeriesOptionsInput,
  OptionalSearchQueryInput,
  SearchQueryInput,
  SonarrInputSchemas,
  SonarrOutputSchemas,
  UnmonitorSeriesOptionsInput,
} from 'src/media/schemas/sonarr.schemas'
import {
  AddSeriesRequest,
  DownloadingSeries,
  EpisodeDetails,
  EpisodeResource,
  LibrarySearchResult,
  MonitorAndDownloadSeriesResult,
  MonitoringChange,
  MonitorSeriesOptions,
  SeasonDetails,
  SeriesDetails,
  SeriesSearchResult,
  SonarrSeries,
  SonarrSeriesType,
  SonarrSystemStatus,
  UnmonitorAndDeleteSeriesResult,
  UnmonitoringChange,
  UnmonitorSeriesOptions,
} from 'src/media/types/sonarr.types'
import {
  determineMonitoringStrategy,
  transformToSearchResults,
} from 'src/media/utils/sonarr.utils'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

@Injectable()
export class SonarrService {
  private readonly logger = new Logger(SonarrService.name)

  constructor(
    private readonly sonarrClient: SonarrClient,
    private readonly retryService: RetryService,
    private readonly errorClassifier: ErrorClassificationService,
  ) {}

  /**
   * Search for TV series by title - Main public API method
   * @param query - Search query (min 2 characters)
   * @returns Array of series search results
   */
  async searchShows(query: string): Promise<SeriesSearchResult[]> {
    const id = nanoid()

    // Input validation
    const validatedInput = this.validateSearchQuery({ query })
    const normalizedQuery = validatedInput.query

    this.logger.log({ id, query: normalizedQuery }, 'Starting series search')

    return await this.fetchSeriesSearch(normalizedQuery, id)
  }

  /**
   * Get series in Sonarr library with optional search query
   * @param query - Optional search query to filter library series (min 2 characters)
   * @returns Array of library series (all if no query, filtered if query provided)
   */
  async getLibrarySeries(query?: string): Promise<LibrarySearchResult[]> {
    const id = nanoid()

    // Validate input if query is provided
    const validatedInput = this.validateOptionalSearchQuery({ query })
    const normalizedQuery = validatedInput.query

    this.logger.log(
      { id, query: normalizedQuery, hasQuery: !!normalizedQuery },
      'Getting library series from Sonarr',
    )

    return await this.fetchLibrarySeries(normalizedQuery, id)
  }

  /**
   * Get Sonarr system status
   * @returns System status information
   */
  async getSystemStatus(): Promise<SonarrSystemStatus> {
    const id = nanoid()

    this.logger.log({ id }, 'Getting Sonarr system status')

    try {
      const start = performance.now()
      const status = await this.sonarrClient.getSystemStatus()
      const duration = performance.now() - start

      // Validate output
      const validatedStatus = SonarrOutputSchemas.systemStatus.parse(status)

      this.logger.log(
        { id, version: validatedStatus.version, duration },
        'Sonarr system status retrieved',
      )

      return validatedStatus
    } catch (error) {
      this.logger.error(
        {
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get system status',
      )
      throw error
    }
  }

  /**
   * Check if Sonarr service is healthy
   * @returns Boolean indicating health status
   */
  async checkHealth(): Promise<boolean> {
    const id = nanoid()

    this.logger.log({ id }, 'Checking Sonarr health')

    try {
      const isHealthy = await this.sonarrClient.checkHealth()

      this.logger.log(
        { id, isHealthy },
        `Sonarr health check ${isHealthy ? 'passed' : 'failed'}`,
      )

      return isHealthy
    } catch (error) {
      this.logger.error(
        {
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Sonarr health check failed with exception',
      )
      return false
    }
  }

  /**
   * Get all currently downloading episodes from Sonarr
   * @returns Array of episodes that are currently downloading
   */
  async getDownloadingEpisodes(): Promise<DownloadingSeries[]> {
    const id = nanoid()

    this.logger.log({ id }, 'Getting all downloading episodes from Sonarr')

    try {
      const start = performance.now()

      // Get all queue items from Sonarr
      const allQueueItems = await this.sonarrClient.getQueue()

      // Filter to only include actively downloading/queued items
      const downloadingItems = allQueueItems.filter(item => {
        const status = item.status.toLowerCase()
        return (
          status === 'downloading' ||
          status === 'queued' ||
          status === 'paused' ||
          status === 'warning'
        )
      })

      // Transform queue items to simplified downloading series format
      const downloadingEpisodes: DownloadingSeries[] = downloadingItems.map(
        item => {
          // Calculate progress safely
          const size = item.size || 0
          const sizeleft = item.sizeleft || 0
          const downloadedBytes = Math.max(0, size - sizeleft)
          const progressPercent =
            size > 0
              ? Math.min(100, Math.max(0, (downloadedBytes / size) * 100))
              : 0
          const isActive = ['downloading', 'queued'].includes(
            item.status.toLowerCase(),
          )

          return {
            id: item.id,
            seriesId: item.seriesId,
            episodeId: item.episodeId,
            seriesTitle: item.series?.title || 'Unknown Series',
            episodeTitle: item.episode?.title || item.title,
            seasonNumber: item.episode?.seasonNumber,
            episodeNumber: item.episode?.episodeNumber,
            size,
            sizeleft,
            status: item.status,
            trackedDownloadStatus: item.trackedDownloadStatus,
            trackedDownloadState: undefined, // Not available in SonarrQueueItem
            protocol: item.protocol,
            downloadClient: item.downloadClient,
            indexer: undefined, // Not available in SonarrQueueItem
            estimatedCompletionTime: item.estimatedCompletionTime,
            timeleft: item.timeleft,
            added: undefined, // Not available in SonarrQueueItem
            // Calculated fields
            progressPercent,
            downloadedBytes,
            isActive,
          }
        },
      )

      const duration = performance.now() - start

      // Validate output using downloading series array schema
      const validatedDownloads =
        SonarrOutputSchemas.downloadingSeriesArray.parse(downloadingEpisodes)

      this.logger.log(
        {
          id,
          totalQueueItems: allQueueItems.length,
          downloadingCount: validatedDownloads.length,
          duration,
        },
        'Downloading episodes retrieved from Sonarr',
      )

      return validatedDownloads
    } catch (error) {
      this.logger.error(
        {
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get downloading episodes from Sonarr',
      )
      throw error
    }
  }

  /**
   * Private method to fetch library series with optional search
   */
  private async fetchLibrarySeries(
    query: string | undefined,
    operationId: string,
  ): Promise<LibrarySearchResult[]> {
    this.logger.log(
      { id: operationId, query, hasQuery: !!query },
      'Fetching library series from Sonarr API',
    )
    const start = performance.now()

    try {
      // Get all series from library
      const allSeries = await this.sonarrClient.getLibrarySeries()
      let filteredSeries = allSeries

      // Filter if query is provided
      if (query) {
        filteredSeries = this.filterSeriesByQuery(allSeries, query)
        this.logger.log(
          {
            id: operationId,
            query,
            totalSeries: allSeries.length,
            filteredCount: filteredSeries.length,
          },
          'Filtered library series by query',
        )
      }

      // Transform to library search results
      const results = this.transformToLibraryResults(filteredSeries)
      const duration = performance.now() - start

      // Validate output
      const validatedResults =
        SonarrOutputSchemas.librarySearchResultArray.parse(results)

      this.logger.log(
        {
          id: operationId,
          query,
          resultCount: validatedResults.length,
          duration,
        },
        'Library series fetch completed',
      )

      return validatedResults
    } catch (error) {
      const duration = performance.now() - start

      this.logger.error(
        {
          id: operationId,
          query,
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to fetch library series',
      )

      throw error
    }
  }

  /**
   * Filter series array by search query
   */
  private filterSeriesByQuery(
    series: SonarrSeries[],
    query: string,
  ): SonarrSeries[] {
    const normalizedQuery = query.toLowerCase().trim()

    return series.filter(s => {
      // Search in title
      if (s.title.toLowerCase().includes(normalizedQuery)) {
        return true
      }

      // Search in alternate titles
      if (
        s.alternateTitles?.some(alt =>
          alt.title.toLowerCase().includes(normalizedQuery),
        )
      ) {
        return true
      }

      // Search in year
      if (s.year?.toString().includes(normalizedQuery)) {
        return true
      }

      // Search in network
      if (s.network?.toLowerCase().includes(normalizedQuery)) {
        return true
      }

      // Search in genres
      if (
        s.genres.some(genre => genre.toLowerCase().includes(normalizedQuery))
      ) {
        return true
      }

      // Search in overview
      if (s.overview?.toLowerCase().includes(normalizedQuery)) {
        return true
      }

      return false
    })
  }

  /**
   * Transform SonarrSeries to LibrarySearchResult
   */
  private transformToLibraryResults(
    series: SonarrSeries[],
  ): LibrarySearchResult[] {
    return series.map(s => ({
      // Base fields from SeriesSearchResult
      tvdbId: s.tvdbId,
      tmdbId: s.tmdbId,
      imdbId: s.imdbId,
      title: s.title,
      titleSlug: s.titleSlug,
      sortTitle: s.sortTitle,
      year: s.year,
      firstAired: s.firstAired,
      lastAired: s.lastAired,
      overview: s.overview,
      runtime: s.runtime,
      network: s.network,
      status: s.status,
      seriesType: s.seriesType,
      seasons: s.seasons,
      genres: s.genres,
      rating: s.ratings.imdb?.value,
      posterPath: s.images.find(img => img.coverType === 'poster')?.remoteUrl,
      backdropPath: s.images.find(img => img.coverType === 'fanart')?.remoteUrl,
      certification: s.certification,
      ended: s.ended,
      // Library-specific fields
      id: s.id,
      monitored: s.monitored,
      path: s.path,
      statistics: s.statistics,
      added: s.added,
    }))
  }

  /**
   * Private method to fetch series search results
   */
  private async fetchSeriesSearch(
    query: string,
    operationId: string,
  ): Promise<SeriesSearchResult[]> {
    this.logger.log(
      { id: operationId, query },
      'Fetching series search from Sonarr API',
    )
    const start = performance.now()

    try {
      // Get raw results from client
      const rawSeries = await this.sonarrClient.searchSeries(query)
      const duration = performance.now() - start

      // Transform to search results
      const results = transformToSearchResults(rawSeries)

      // Validate output
      const validatedResults =
        SonarrOutputSchemas.seriesSearchResultArray.parse(results)

      this.logger.log(
        {
          id: operationId,
          query,
          resultCount: validatedResults.length,
          duration,
        },
        'Series search fetch completed',
      )

      return validatedResults
    } catch (error) {
      const duration = performance.now() - start

      this.logger.error(
        {
          id: operationId,
          query,
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to fetch series search',
      )

      throw error
    }
  }

  /**
   * Monitor and download a series with granular control over seasons/episodes
   * @param tvdbId - TVDB ID of the series to monitor and download
   * @param options - Monitoring options (optional)
   * @returns Result of the monitoring operation
   */
  async monitorAndDownloadSeries(
    tvdbId: number,
    options: MonitorSeriesOptions = {},
  ): Promise<MonitorAndDownloadSeriesResult> {
    const id = nanoid()

    try {
      const validatedOptions = this.validateMonitorSeriesOptions(options)

      this.logger.log(
        {
          id,
          tvdbId,
          options: validatedOptions,
        },
        'Starting monitor and download series operation',
      )

      const start = performance.now()

      // Check if series already exists
      const existingSeries = await this.sonarrClient.getSeriesByTvdbId(tvdbId)

      let result: MonitorAndDownloadSeriesResult

      if (existingSeries) {
        this.logger.log(
          { id, seriesId: existingSeries.id },
          'Series already exists, updating monitoring',
        )
        result = await this.updateExistingSeriesMonitoring(
          existingSeries,
          validatedOptions,
          id,
        )
      } else {
        // Search for the series by TVDB ID since it's not in library
        let series: SeriesSearchResult
        try {
          const searchResults = await this.searchShows(tvdbId.toString())
          const exactMatch = searchResults.find(
            result => result.tvdbId === tvdbId,
          )

          if (!exactMatch) {
            this.logger.error(
              { id, tvdbId },
              'Series not found in search results',
            )
            return {
              success: false,
              seriesAdded: false,
              seriesUpdated: false,
              searchTriggered: false,
              changes: [],
              error: `Series with TVDB ID ${tvdbId} not found`,
            }
          }

          series = exactMatch
          this.logger.log(
            { id, tvdbId, title: series.title },
            'Found series in search results, adding to Sonarr',
          )
        } catch (searchError) {
          this.logger.error(
            { id, tvdbId, error: searchError },
            'Failed to search for series',
          )
          return {
            success: false,
            seriesAdded: false,
            seriesUpdated: false,
            searchTriggered: false,
            changes: [],
            error: `Failed to search for series: ${searchError instanceof Error ? searchError.message : 'Unknown error'}`,
          }
        }

        result = await this.addNewSeries(series, validatedOptions, id)
      }

      const duration = performance.now() - start
      this.logger.log(
        {
          id,
          tvdbId,
          seriesAdded: result.seriesAdded,
          seriesUpdated: result.seriesUpdated,
          searchTriggered: result.searchTriggered,
          changeCount: result.changes.length,
          duration,
        },
        'Monitor and download series operation completed',
      )

      return result
    } catch (error) {
      this.logger.error(
        {
          id,
          tvdbId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to monitor and download series',
      )

      return {
        success: false,
        seriesAdded: false,
        seriesUpdated: false,
        searchTriggered: false,
        changes: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Add a new series to Sonarr
   */
  private async addNewSeries(
    series: SeriesSearchResult,
    options: MonitorSeriesOptions,
    operationId: string,
  ): Promise<MonitorAndDownloadSeriesResult> {
    this.logger.log(
      { id: operationId, tvdbId: series.tvdbId },
      'Getting series configuration',
    )

    // Get configuration
    const config = await this.getSeriesConfiguration()

    this.logger.log(
      { id: operationId, config },
      'Determining monitoring strategy',
    )

    // Determine monitoring strategy
    const { monitorType, seasons } = determineMonitoringStrategy(
      series.seasons,
      options,
    )

    // Build add series request
    const addRequest: AddSeriesRequest = {
      tvdbId: series.tvdbId,
      title: series.title,
      titleSlug: series.titleSlug,
      qualityProfileId: config.qualityProfileId,
      rootFolderPath: config.rootFolderPath,
      monitored: true,
      monitor: monitorType,
      seasonFolder: true,
      useSceneNumbering: false,
      seriesType: series.seriesType || SonarrSeriesType.STANDARD,
      searchForMissingEpisodes: true,
      searchForCutoffUnmetEpisodes: true,
      seasons,
      year: series.year,
      firstAired: series.firstAired,
      overview: series.overview,
      network: series.network,
      certification: series.certification,
      genres: series.genres,
    }

    const addedSeries = await this.sonarrClient.addSeries(addRequest)

    // Apply monitoring based on options
    const changes: MonitoringChange[] = []
    if (options.selection) {
      // Apply custom episode-level monitoring
      const episodeChanges = await this.applyEpisodeMonitoring(
        addedSeries,
        options.selection,
        operationId,
      )
      changes.push(...episodeChanges)
    } else {
      // Monitor all episodes in monitored seasons (excluding specials)
      const episodeChanges = await this.monitorAllEpisodesInMonitoredSeasons(
        addedSeries,
        operationId,
      )
      changes.push(...episodeChanges)
    }

    // Trigger search
    const command = await this.sonarrClient.triggerSeriesSearch(addedSeries.id)

    return {
      success: true,
      seriesAdded: true,
      seriesUpdated: false,
      searchTriggered: true,
      changes,
      series: addedSeries,
      commandId: command.id,
    }
  }

  /**
   * Update monitoring for an existing series
   */
  private async updateExistingSeriesMonitoring(
    existingSeries: SonarrSeries,
    options: MonitorSeriesOptions,
    operationId: string,
  ): Promise<MonitorAndDownloadSeriesResult> {
    this.logger.log(
      { id: operationId, seriesId: existingSeries.id },
      'Updating existing series monitoring',
    )

    const changes: MonitoringChange[] = []
    let searchTriggered = false
    let commandId: number | undefined

    if (!options.selection) {
      this.logger.log(
        { id: operationId, seriesId: existingSeries.id },
        'Monitoring entire series',
      )

      // Monitor entire series - update all seasons to monitored
      const updatedSeasons = existingSeries.seasons.map(season => ({
        ...season,
        monitored: true,
      }))

      const updatedSeries = await this.sonarrClient.updateSeries(
        existingSeries.id,
        {
          seasons: updatedSeasons,
          monitored: true,
        },
      )

      // Track changes for seasons
      for (const season of existingSeries.seasons) {
        if (!season.monitored && season.seasonNumber > 0) {
          changes.push({
            season: season.seasonNumber,
            action: 'monitored',
          })
        }
      }

      // Monitor all episodes in the newly monitored seasons
      const episodeChanges = await this.monitorAllEpisodesInMonitoredSeasons(
        updatedSeries,
        operationId,
      )
      changes.push(...episodeChanges)

      // Trigger search if any changes were made
      if (changes.length > 0) {
        const command = await this.sonarrClient.triggerSeriesSearch(
          existingSeries.id,
        )
        searchTriggered = true
        commandId = command.id
      }

      return {
        success: true,
        seriesAdded: false,
        seriesUpdated: true,
        searchTriggered,
        changes,
        series: updatedSeries,
        commandId,
      }
    }

    // Custom selection - apply granular monitoring
    const episodeChanges = await this.applyEpisodeMonitoring(
      existingSeries,
      options.selection,
      operationId,
    )
    changes.push(...episodeChanges)

    // Trigger search if any changes were made
    if (changes.length > 0) {
      const command = await this.sonarrClient.triggerSeriesSearch(
        existingSeries.id,
      )
      searchTriggered = true
      commandId = command.id
    }

    return {
      success: true,
      seriesAdded: false,
      seriesUpdated: true,
      searchTriggered,
      changes,
      series: existingSeries,
      commandId,
    }
  }

  /**
   * Get series configuration (quality profile and root folder)
   */
  private async getSeriesConfiguration(): Promise<{
    qualityProfileId: number
    rootFolderPath: string
  }> {
    const [qualityProfiles, rootFolders] = await Promise.all([
      this.sonarrClient.getQualityProfiles(),
      this.sonarrClient.getRootFolders(),
    ])

    if (qualityProfiles.length === 0) {
      throw new Error('No quality profiles found in Sonarr')
    }

    if (rootFolders.length === 0) {
      throw new Error('No root folders found in Sonarr')
    }

    // Find the "Any" quality profile for more permissive downloading
    const anyProfile = qualityProfiles.find(profile =>
      profile.name.toLowerCase().includes('any'),
    )

    if (anyProfile) {
      return {
        qualityProfileId: anyProfile.id,
        rootFolderPath: rootFolders[0].path,
      }
    }

    // Fallback to first available profile if "Any" not found
    const firstProfile = qualityProfiles[0]
    this.logger.warn(
      { availableProfiles: qualityProfiles.map(p => p.name) },
      'No "Any" quality profile found, using first available profile',
    )

    return {
      qualityProfileId: firstProfile.id,
      rootFolderPath: rootFolders[0].path,
    }
  }

  /**
   * Apply episode-level monitoring based on selection
   */
  private async applyEpisodeMonitoring(
    series: SonarrSeries,
    selection: Array<{ season: number; episodes?: number[] }>,
    operationId: string,
  ): Promise<MonitoringChange[]> {
    const changes: MonitoringChange[] = []

    for (const sel of selection) {
      // Get all episodes for this season with retry for newly added series
      const episodes = await this.getEpisodesWithRetry(
        series.id,
        sel.season,
        operationId,
      )
      this.logger.log(
        { id: operationId, season: sel.season, episodeCount: episodes.length },
        'Processing episode monitoring for season',
      )

      if (!sel.episodes || sel.episodes.length === 0) {
        // Whole season selection - monitor all episodes
        this.logger.log(
          { id: operationId, season: sel.season },
          'Monitoring entire season',
        )

        const allEpisodeIds = episodes.map(ep => ep.id)
        if (allEpisodeIds.length > 0) {
          await this.sonarrClient.updateEpisodesMonitoring({
            episodeIds: allEpisodeIds,
            monitored: true,
          })

          changes.push({
            season: sel.season,
            action: 'monitored',
          })
        }
      } else {
        // Partial season selection - monitor specified episodes, unmonitor others
        this.logger.log(
          {
            id: operationId,
            season: sel.season,
            selectedEpisodes: sel.episodes,
          },
          'Monitoring specific episodes in season',
        )

        // Get episode IDs for selected episodes
        const selectedEpisodeIds = episodes
          .filter(ep => sel.episodes!.includes(ep.episodeNumber))
          .map(ep => ep.id)

        // Get episode IDs for unselected episodes
        const unselectedEpisodeIds = episodes
          .filter(ep => !sel.episodes!.includes(ep.episodeNumber))
          .map(ep => ep.id)

        // Bulk monitor selected episodes
        if (selectedEpisodeIds.length > 0) {
          await this.sonarrClient.updateEpisodesMonitoring({
            episodeIds: selectedEpisodeIds,
            monitored: true,
          })

          changes.push({
            season: sel.season,
            episodes: sel.episodes,
            action: 'monitored',
          })
        }

        // Bulk unmonitor unselected episodes
        if (unselectedEpisodeIds.length > 0) {
          await this.sonarrClient.updateEpisodesMonitoring({
            episodeIds: unselectedEpisodeIds,
            monitored: false,
          })

          const unmonitoredEpisodeNumbers = episodes
            .filter(ep => !sel.episodes!.includes(ep.episodeNumber))
            .map(ep => ep.episodeNumber)

          if (unmonitoredEpisodeNumbers.length > 0) {
            changes.push({
              season: sel.season,
              episodes: unmonitoredEpisodeNumbers,
              action: 'unmonitored',
            })
          }
        }
      }
    }

    return changes
  }

  /**
   * Get episodes for a season with retry mechanism for newly added series
   * Sonarr may take time to populate episodes after adding a series
   */
  private async getEpisodesWithRetry(
    seriesId: number,
    seasonNumber: number,
    operationId: string,
    maxRetries: number = 3,
  ): Promise<EpisodeResource[]> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const episodes = await this.sonarrClient.getEpisodes(
        seriesId,
        seasonNumber,
      )

      if (episodes.length > 0) {
        // Episodes found, return them
        return episodes
      }

      if (attempt < maxRetries) {
        const waitTime = attempt * 2 // 2s, 4s, 6s...
        this.logger.log(
          {
            id: operationId,
            seriesId,
            seasonNumber,
            attempt,
            maxRetries,
            waitTime,
          },
          `No episodes found for season ${seasonNumber}, retrying in ${waitTime}s (attempt ${attempt}/${maxRetries})`,
        )

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
      }
    }

    // No episodes found after all retries
    this.logger.warn(
      { id: operationId, seriesId, seasonNumber, maxRetries },
      `No episodes found for season ${seasonNumber} after ${maxRetries} attempts`,
    )

    return []
  }

  /**
   * Monitor all episodes in monitored seasons (excluding specials)
   */
  private async monitorAllEpisodesInMonitoredSeasons(
    series: SonarrSeries,
    operationId: string,
  ): Promise<MonitoringChange[]> {
    const changes: MonitoringChange[] = []

    // Get monitored seasons excluding specials (season 0)
    const monitoredSeasons = series.seasons.filter(
      season => season.monitored && season.seasonNumber > 0,
    )

    if (monitoredSeasons.length === 0) {
      this.logger.log(
        { id: operationId, seriesId: series.id },
        'No monitored seasons found, skipping episode monitoring',
      )
      return changes
    }

    this.logger.log(
      {
        id: operationId,
        seriesId: series.id,
        monitoredSeasons: monitoredSeasons.map(s => s.seasonNumber),
      },
      'Monitoring all episodes in monitored seasons',
    )

    // Process each monitored season
    for (const season of monitoredSeasons) {
      try {
        // Get all episodes for this season with retry
        const episodes = await this.getEpisodesWithRetry(
          series.id,
          season.seasonNumber,
          operationId,
        )

        if (episodes.length === 0) {
          this.logger.warn(
            {
              id: operationId,
              seriesId: series.id,
              seasonNumber: season.seasonNumber,
            },
            'No episodes found for season, skipping',
          )
          continue
        }

        // Get all episode IDs for this season
        const episodeIds = episodes.map(ep => ep.id)

        // Bulk monitor all episodes in this season
        await this.sonarrClient.updateEpisodesMonitoring({
          episodeIds,
          monitored: true,
        })

        this.logger.log(
          {
            id: operationId,
            seriesId: series.id,
            seasonNumber: season.seasonNumber,
            episodeCount: episodeIds.length,
          },
          'Successfully monitored all episodes in season',
        )

        // Track the change
        changes.push({
          season: season.seasonNumber,
          action: 'monitored',
        })
      } catch (error) {
        this.logger.error(
          {
            id: operationId,
            seriesId: series.id,
            seasonNumber: season.seasonNumber,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          'Failed to monitor episodes in season',
        )
        // Continue with other seasons even if one fails
      }
    }

    return changes
  }

  /**
   * Validate monitor series options input
   */
  private validateMonitorSeriesOptions(
    options: MonitorSeriesOptions,
  ): MonitorSeriesOptionsInput {
    try {
      return SonarrInputSchemas.monitorSeriesOptions.parse(options)
    } catch (error) {
      this.logger.error(
        {
          options,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Invalid monitor series options input',
      )
      throw new Error(
        `Invalid monitor series options: ${error instanceof Error ? error.message : 'Unknown validation error'}`,
      )
    }
  }

  /**
   * Validate search query input
   */
  private validateSearchQuery(input: { query: string }): SearchQueryInput {
    try {
      return SonarrInputSchemas.searchQuery.parse(input)
    } catch (error) {
      this.logger.error(
        {
          input,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Invalid search query input',
      )
      throw new Error(
        `Invalid search query: ${error instanceof Error ? error.message : 'Unknown validation error'}`,
      )
    }
  }

  /**
   * Validate optional search query input
   */
  private validateOptionalSearchQuery(input: {
    query?: string
  }): OptionalSearchQueryInput {
    try {
      return SonarrInputSchemas.optionalSearchQuery.parse(input)
    } catch (error) {
      this.logger.error(
        {
          input,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Invalid optional search query input',
      )
      throw new Error(
        `Invalid search query: ${error instanceof Error ? error.message : 'Unknown validation error'}`,
      )
    }
  }

  /**
   * Unmonitor and delete series with granular control over seasons/episodes
   * @param tvdbId - TVDB ID of the series to unmonitor and delete
   * @param options - Unmonitoring options (optional)
   * @returns Result of the unmonitoring operation
   */
  async unmonitorAndDeleteSeries(
    tvdbId: number,
    options: UnmonitorSeriesOptions = {},
  ): Promise<UnmonitorAndDeleteSeriesResult> {
    const id = nanoid()

    try {
      const validatedOptions = this.validateUnmonitorSeriesOptions(options)

      this.logger.log(
        {
          id,
          tvdbId,
          options: validatedOptions,
        },
        'Starting unmonitor and delete series operation',
      )

      const start = performance.now()

      // Get existing series from Sonarr by TVDB ID
      const existingSeries = await this.sonarrClient.getSeriesByTvdbId(tvdbId)

      if (!existingSeries) {
        this.logger.warn({ id, tvdbId }, 'Series not found in Sonarr library')

        return {
          success: false,
          seriesDeleted: false,
          episodesUnmonitored: false,
          downloadsCancel: false,
          canceledDownloads: 0,
          changes: [],
          error: 'Series not found in Sonarr library',
        }
      }

      // Check if we should delete entire series immediately
      if (!validatedOptions.selection) {
        this.logger.log(
          { id, seriesId: existingSeries.id },
          'Deleting entire series (no selection provided)',
        )

        return await this.deleteEntireSeries(existingSeries, id)
      }

      // When there is a selection, always use granular unmonitoring
      // This preserves files and handles deletion differently if needed
      this.logger.log(
        { id, seriesId: existingSeries.id },
        'Applying granular unmonitoring (selection provided)',
      )

      // Apply granular unmonitoring
      const result = await this.applyGranularUnmonitoring(
        existingSeries,
        validatedOptions,
        id,
      )

      const duration = performance.now() - start
      this.logger.log(
        {
          id,
          tvdbId,
          title: existingSeries.title,
          seriesDeleted: result.seriesDeleted,
          episodesUnmonitored: result.episodesUnmonitored,
          canceledDownloads: result.canceledDownloads,
          changeCount: result.changes.length,
          duration,
        },
        'Unmonitor and delete series operation completed',
      )

      return result
    } catch (error) {
      this.logger.error(
        {
          id,
          tvdbId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to unmonitor and delete series',
      )

      return {
        success: false,
        seriesDeleted: false,
        episodesUnmonitored: false,
        downloadsCancel: false,
        canceledDownloads: 0,
        changes: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Cancel all downloads for a series
   */
  private async cancelDownloadsForSeries(
    seriesId: number,
    operationId: string,
  ): Promise<{ canceled: number; commandIds: number[] }> {
    this.logger.log(
      { id: operationId, seriesId },
      'Canceling downloads for series',
    )

    try {
      const queue = await this.sonarrClient.getQueue()

      // Find downloads for this series
      const seriesDownloads = queue.filter(item => item.seriesId === seriesId)

      if (seriesDownloads.length === 0) {
        this.logger.log(
          { id: operationId, seriesId },
          'No downloads found for series',
        )
        return { canceled: 0, commandIds: [] }
      }

      this.logger.log(
        { id: operationId, seriesId, downloadCount: seriesDownloads.length },
        'Found downloads to cancel for series',
      )

      const commandIds: number[] = []
      let canceled = 0

      // Cancel each download
      for (const download of seriesDownloads) {
        try {
          await this.sonarrClient.removeQueueItem(download.id)
          commandIds.push(download.id)
          canceled++

          this.logger.log(
            {
              id: operationId,
              seriesId,
              downloadId: download.id,
              title: download.title,
            },
            'Download canceled successfully',
          )
        } catch (error) {
          this.logger.warn(
            {
              id: operationId,
              seriesId,
              downloadId: download.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            'Failed to cancel download, continuing with others',
          )
        }
      }

      this.logger.log(
        { id: operationId, seriesId, canceled, total: seriesDownloads.length },
        'Finished canceling downloads for series',
      )

      return { canceled, commandIds }
    } catch (error) {
      this.logger.error(
        {
          id: operationId,
          seriesId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get queue for series download cancellation',
      )
      return { canceled: 0, commandIds: [] }
    }
  }

  /**
   * Cancel downloads for specific episodes
   */
  private async cancelDownloadsForEpisodes(
    episodeIds: number[],
    operationId: string,
  ): Promise<{ canceled: number; commandIds: number[] }> {
    this.logger.log(
      { id: operationId, episodeCount: episodeIds.length },
      'Canceling downloads for episodes',
    )

    try {
      const queue = await this.sonarrClient.getQueue()

      // Find downloads for these episodes
      const episodeDownloads = queue.filter(
        item => item.episodeId && episodeIds.includes(item.episodeId),
      )

      if (episodeDownloads.length === 0) {
        this.logger.log(
          { id: operationId, episodeCount: episodeIds.length },
          'No downloads found for episodes',
        )
        return { canceled: 0, commandIds: [] }
      }

      this.logger.log(
        {
          id: operationId,
          episodeCount: episodeIds.length,
          downloadCount: episodeDownloads.length,
        },
        'Found downloads to cancel for episodes',
      )

      const commandIds: number[] = []
      let canceled = 0

      // Cancel each download
      for (const download of episodeDownloads) {
        try {
          await this.sonarrClient.removeQueueItem(download.id)
          commandIds.push(download.id)
          canceled++

          this.logger.log(
            {
              id: operationId,
              downloadId: download.id,
              episodeId: download.episodeId,
              title: download.title,
            },
            'Episode download canceled successfully',
          )
        } catch (error) {
          this.logger.warn(
            {
              id: operationId,
              downloadId: download.id,
              episodeId: download.episodeId,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            'Failed to cancel episode download, continuing with others',
          )
        }
      }

      this.logger.log(
        { id: operationId, canceled, total: episodeDownloads.length },
        'Finished canceling downloads for episodes',
      )

      return { canceled, commandIds }
    } catch (error) {
      this.logger.error(
        {
          id: operationId,
          episodeCount: episodeIds.length,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get queue for episode download cancellation',
      )
      return { canceled: 0, commandIds: [] }
    }
  }

  /**
   * Delete entire series with download cancellation
   */
  private async deleteEntireSeries(
    series: SonarrSeries,
    operationId: string,
  ): Promise<UnmonitorAndDeleteSeriesResult> {
    this.logger.log(
      { id: operationId, seriesId: series.id, title: series.title },
      'Deleting entire series',
    )

    try {
      // Cancel all downloads for the series first
      const downloadResult = await this.cancelDownloadsForSeries(
        series.id,
        operationId,
      )

      // Delete the series
      await this.sonarrClient.deleteSeries(series.id, {
        deleteFiles: true, // Always delete files when removing entire series
        addImportListExclusion: false, // Don't add to exclusion list
      })

      this.logger.log(
        {
          id: operationId,
          seriesId: series.id,
          title: series.title,
          canceledDownloads: downloadResult.canceled,
        },
        'Series deleted successfully',
      )

      const changes: UnmonitoringChange[] = [
        {
          season: 0, // Indicates entire series
          action: 'deleted_series',
        },
      ]

      return {
        success: true,
        seriesDeleted: true,
        episodesUnmonitored: false,
        downloadsCancel: downloadResult.canceled > 0,
        canceledDownloads: downloadResult.canceled,
        changes,
        commandIds: downloadResult.commandIds,
      }
    } catch (error) {
      this.logger.error(
        {
          id: operationId,
          seriesId: series.id,
          title: series.title,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to delete entire series',
      )

      return {
        success: false,
        seriesDeleted: false,
        episodesUnmonitored: false,
        downloadsCancel: false,
        canceledDownloads: 0,
        changes: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Apply granular unmonitoring for specific seasons/episodes
   */
  private async applyGranularUnmonitoring(
    series: SonarrSeries,
    options: UnmonitorSeriesOptionsInput,
    operationId: string,
  ): Promise<UnmonitorAndDeleteSeriesResult> {
    this.logger.log(
      { id: operationId, seriesId: series.id },
      'Applying granular unmonitoring',
    )

    const changes: UnmonitoringChange[] = []
    let totalCanceledDownloads = 0
    const allCommandIds: number[] = []
    let currentSeries = series

    try {
      // Apply episode-level unmonitoring for each selection
      for (const selection of options.selection!) {
        const episodeChanges = await this.applyEpisodeUnmonitoring(
          currentSeries,
          selection,
          operationId,
        )
        changes.push(...episodeChanges.changes)
        totalCanceledDownloads += episodeChanges.canceledDownloads
        allCommandIds.push(...episodeChanges.commandIds)

        // Update current series if it was modified
        if (episodeChanges.updatedSeries) {
          currentSeries = episodeChanges.updatedSeries
        }
      }

      // Note: We don't need explicit unmonitoring here since granular unmonitoring
      // already handled the specific episodes that were requested to be unmonitored.
      // Explicitly unmonitoring ALL episodes would incorrectly unmonitor episodes
      // that should remain monitored.

      // Check if any monitored episodes remain in the series
      const shouldDeleteSeries = await this.checkIfSeriesShouldBeDeleted(
        currentSeries.id,
        operationId,
      )

      let seriesDeleted = false
      if (shouldDeleteSeries) {
        this.logger.log(
          { id: operationId, seriesId: series.id },
          'No monitored episodes remain, deleting series',
        )

        // Delete the series - check if files should be deleted
        await this.sonarrClient.deleteSeries(series.id, {
          deleteFiles: options.deleteFiles ?? false, // Use option or default to false for granular unmonitoring
          addImportListExclusion: false,
        })

        seriesDeleted = true
        changes.push({
          season: 0, // Indicates entire series
          action: 'deleted_series',
        })
      }

      this.logger.log(
        {
          id: operationId,
          seriesId: series.id,
          changeCount: changes.length,
          seriesDeleted,
          canceledDownloads: totalCanceledDownloads,
        },
        'Granular unmonitoring completed',
      )

      return {
        success: true,
        seriesDeleted,
        episodesUnmonitored: changes.some(c => c.action === 'unmonitored'),
        downloadsCancel: totalCanceledDownloads > 0,
        canceledDownloads: totalCanceledDownloads,
        changes,
        series: seriesDeleted ? undefined : currentSeries,
        commandIds: allCommandIds,
      }
    } catch (error) {
      this.logger.error(
        {
          id: operationId,
          seriesId: series.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to apply granular unmonitoring',
      )

      return {
        success: false,
        seriesDeleted: false,
        episodesUnmonitored: false,
        downloadsCancel: false,
        canceledDownloads: 0,
        changes,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Apply episode-level unmonitoring based on selection
   */
  private async applyEpisodeUnmonitoring(
    series: SonarrSeries,
    selection: { season: number; episodes?: number[] },
    operationId: string,
  ): Promise<{
    changes: UnmonitoringChange[]
    canceledDownloads: number
    commandIds: number[]
    updatedSeries?: SonarrSeries
  }> {
    const changes: UnmonitoringChange[] = []
    let canceledDownloads = 0
    const commandIds: number[] = []
    let currentSeries = series

    this.logger.log(
      { id: operationId, seriesId: series.id, selection },
      'Applying episode unmonitoring for selection',
    )

    try {
      // Get all episodes for this season
      const episodes = await this.getEpisodesWithRetry(
        series.id,
        selection.season,
        operationId,
      )

      if (episodes.length === 0) {
        this.logger.warn(
          { id: operationId, seriesId: series.id, season: selection.season },
          'No episodes found for season, skipping unmonitoring',
        )
        return { changes, canceledDownloads, commandIds }
      }

      if (!selection.episodes || selection.episodes.length === 0) {
        // Entire season unmonitoring - unmonitor all episodes in season + season itself
        this.logger.log(
          { id: operationId, season: selection.season },
          'Unmonitoring entire season',
        )

        const allEpisodeIds = episodes.map(ep => ep.id)
        if (allEpisodeIds.length > 0) {
          // Cancel downloads for these episodes first
          const downloadResult = await this.cancelDownloadsForEpisodes(
            allEpisodeIds,
            operationId,
          )
          canceledDownloads += downloadResult.canceled
          commandIds.push(...downloadResult.commandIds)

          // Delete episode files for episodes that have files
          const deletionResult = await this.deleteEpisodeFilesForEpisodes(
            episodes,
            operationId,
          )

          // Unmonitor all episodes in the season
          await this.sonarrClient.updateEpisodesMonitoring({
            episodeIds: allEpisodeIds,
            monitored: false,
          })

          // Also unmonitor the season itself at the series level
          const updatedSeasons = currentSeries.seasons.map(season => {
            if (season.seasonNumber === selection.season) {
              return { ...season, monitored: false }
            }
            return season
          })

          currentSeries = await this.sonarrClient.updateSeries(
            currentSeries.id,
            {
              seasons: updatedSeasons,
            },
          )

          changes.push({
            season: selection.season,
            action: 'unmonitored',
          })

          changes.push({
            season: selection.season,
            action: 'unmonitored_season',
          })

          if (deletionResult.deletedFiles > 0) {
            changes.push({
              season: selection.season,
              action: 'deleted_files',
            })
          }
        }
      } else {
        // Specific episodes unmonitoring
        this.logger.log(
          {
            id: operationId,
            season: selection.season,
            selectedEpisodes: selection.episodes,
          },
          'Unmonitoring specific episodes in season',
        )

        // Get episode IDs for selected episodes
        const selectedEpisodeIds = episodes
          .filter(ep => selection.episodes!.includes(ep.episodeNumber))
          .map(ep => ep.id)

        if (selectedEpisodeIds.length > 0) {
          // Cancel downloads for these episodes first
          const downloadResult = await this.cancelDownloadsForEpisodes(
            selectedEpisodeIds,
            operationId,
          )
          canceledDownloads += downloadResult.canceled
          commandIds.push(...downloadResult.commandIds)

          // Delete episode files for selected episodes that have files
          const selectedEpisodes = episodes.filter(ep =>
            selection.episodes!.includes(ep.episodeNumber),
          )
          const deletionResult = await this.deleteEpisodeFilesForEpisodes(
            selectedEpisodes,
            operationId,
          )

          // Unmonitor selected episodes
          await this.sonarrClient.updateEpisodesMonitoring({
            episodeIds: selectedEpisodeIds,
            monitored: false,
          })

          changes.push({
            season: selection.season,
            episodes: selection.episodes,
            action: 'unmonitored',
          })

          if (deletionResult.deletedFiles > 0) {
            changes.push({
              season: selection.season,
              episodes: selection.episodes,
              action: 'deleted_files',
            })
          }

          // Check if this season should be automatically unmonitored (no monitored episodes remain)
          const seasonResult = await this.checkAndUnmonitorSeasonIfEmpty(
            currentSeries,
            selection.season,
            operationId,
          )

          if (seasonResult.seasonUnmonitored && seasonResult.updatedSeries) {
            currentSeries = seasonResult.updatedSeries
            changes.push({
              season: selection.season,
              action: 'unmonitored_season',
            })
          }
        }
      }

      return {
        changes,
        canceledDownloads,
        commandIds,
        updatedSeries: currentSeries,
      }
    } catch (error) {
      this.logger.error(
        {
          id: operationId,
          seriesId: series.id,
          season: selection.season,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to apply episode unmonitoring',
      )

      throw error
    }
  }

  /**
   * Check if a season should be unmonitored and update series if it has no monitored episodes
   */
  private async checkAndUnmonitorSeasonIfEmpty(
    series: SonarrSeries,
    seasonNumber: number,
    operationId: string,
  ): Promise<{ seasonUnmonitored: boolean; updatedSeries?: SonarrSeries }> {
    this.logger.log(
      { id: operationId, seriesId: series.id, seasonNumber },
      'Checking if season should be unmonitored',
    )

    try {
      // Get all episodes for this season
      const episodes = await this.getEpisodesWithRetry(
        series.id,
        seasonNumber,
        operationId,
        2, // Reduced retries for season check
      )

      if (episodes.length === 0) {
        this.logger.warn(
          { id: operationId, seriesId: series.id, seasonNumber },
          'No episodes found for season, skipping unmonitoring check',
        )
        return { seasonUnmonitored: false }
      }

      // Check if any episodes in this season are still monitored
      const monitoredEpisodes = episodes.filter(ep => ep.monitored)
      if (monitoredEpisodes.length > 0) {
        this.logger.log(
          {
            id: operationId,
            seriesId: series.id,
            seasonNumber,
            monitoredCount: monitoredEpisodes.length,
          },
          'Season still has monitored episodes, not unmonitoring season',
        )
        return { seasonUnmonitored: false }
      }

      // No monitored episodes remain, unmonitor the season
      this.logger.log(
        { id: operationId, seriesId: series.id, seasonNumber },
        'No monitored episodes remain in season, unmonitoring season',
      )

      // Update the season to be unmonitored
      const updatedSeasons = series.seasons.map(season => {
        if (season.seasonNumber === seasonNumber) {
          return { ...season, monitored: false }
        }
        return season
      })

      // Update the series in Sonarr
      const updatedSeries = await this.sonarrClient.updateSeries(series.id, {
        seasons: updatedSeasons,
      })

      this.logger.log(
        { id: operationId, seriesId: series.id, seasonNumber },
        'Season unmonitored successfully',
      )

      return { seasonUnmonitored: true, updatedSeries }
    } catch (error) {
      this.logger.error(
        {
          id: operationId,
          seriesId: series.id,
          seasonNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to check if season should be unmonitored, assuming should not unmonitor',
      )
      return { seasonUnmonitored: false }
    }
  }

  /**
   * Explicitly unmonitor ALL episodes in the entire series to ensure state consistency
   * This addresses potential inconsistencies between season-level and episode-level monitoring
   */
  private async explicitlyUnmonitorAllEpisodesInSeries(
    seriesId: number,
    operationId: string,
  ): Promise<void> {
    this.logger.log(
      { id: operationId, seriesId },
      'EXPLICIT UNMONITOR: Starting to unmonitor all episodes in entire series',
    )

    try {
      // Get the series to find all seasons
      const series = await this.sonarrClient.getSeriesById(seriesId)
      if (!series) {
        this.logger.warn(
          { id: operationId, seriesId },
          'EXPLICIT UNMONITOR: Series not found, skipping explicit unmonitoring',
        )
        return
      }

      const allEpisodeIds: number[] = []

      // Get all episodes from all seasons (excluding specials)
      for (const season of series.seasons) {
        if (season.seasonNumber === 0) continue // Skip specials

        try {
          const episodes = await this.getEpisodesWithRetry(
            seriesId,
            season.seasonNumber,
            operationId,
            2,
          )

          this.logger.log(
            {
              id: operationId,
              seriesId,
              season: season.seasonNumber,
              totalEpisodes: episodes.length,
              monitoredEpisodes: episodes.filter(ep => ep.monitored).length,
            },
            `EXPLICIT UNMONITOR: Found episodes in season ${season.seasonNumber}`,
          )

          // Collect all episode IDs
          const seasonEpisodeIds = episodes.map(ep => ep.id)
          allEpisodeIds.push(...seasonEpisodeIds)
        } catch (error) {
          this.logger.warn(
            {
              id: operationId,
              seriesId,
              season: season.seasonNumber,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            'EXPLICIT UNMONITOR: Failed to get episodes for season, continuing with others',
          )
        }
      }

      if (allEpisodeIds.length === 0) {
        this.logger.log(
          { id: operationId, seriesId },
          'EXPLICIT UNMONITOR: No episodes found in any season',
        )
        return
      }

      this.logger.log(
        {
          id: operationId,
          seriesId,
          totalEpisodeIds: allEpisodeIds.length,
        },
        'EXPLICIT UNMONITOR: Unmonitoring all episodes in series',
      )

      // Unmonitor ALL episodes in the series
      await this.sonarrClient.updateEpisodesMonitoring({
        episodeIds: allEpisodeIds,
        monitored: false,
      })

      this.logger.log(
        {
          id: operationId,
          seriesId,
          totalEpisodesUnmonitored: allEpisodeIds.length,
        },
        'EXPLICIT UNMONITOR: Successfully unmonitored all episodes in series',
      )

      // Wait a moment and then verify the unmonitoring took effect
      this.logger.log(
        { id: operationId, seriesId },
        'EXPLICIT UNMONITOR: Waiting 2 seconds and then verifying unmonitoring took effect',
      )
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Verify that episodes are actually unmonitored
      let totalStillMonitored = 0
      for (const season of series.seasons) {
        if (season.seasonNumber === 0) continue // Skip specials

        try {
          const episodes = await this.getEpisodesWithRetry(
            seriesId,
            season.seasonNumber,
            operationId,
            2,
          )

          const stillMonitored = episodes.filter(ep => ep.monitored)
          if (stillMonitored.length > 0) {
            totalStillMonitored += stillMonitored.length
            this.logger.warn(
              {
                id: operationId,
                seriesId,
                season: season.seasonNumber,
                stillMonitoredCount: stillMonitored.length,
                stillMonitoredEpisodes: stillMonitored.map(
                  ep => ep.episodeNumber,
                ),
              },
              'EXPLICIT UNMONITOR VERIFICATION: Found episodes still monitored after explicit unmonitoring',
            )
          } else {
            this.logger.log(
              {
                id: operationId,
                seriesId,
                season: season.seasonNumber,
                totalEpisodes: episodes.length,
              },
              'EXPLICIT UNMONITOR VERIFICATION: All episodes in season are properly unmonitored',
            )
          }
        } catch (error) {
          this.logger.warn(
            {
              id: operationId,
              seriesId,
              season: season.seasonNumber,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            'EXPLICIT UNMONITOR VERIFICATION: Failed to verify season, continuing',
          )
        }
      }

      this.logger.log(
        {
          id: operationId,
          seriesId,
          totalStillMonitored,
        },
        `EXPLICIT UNMONITOR VERIFICATION: Found ${totalStillMonitored} episodes still monitored after explicit unmonitoring`,
      )
    } catch (error) {
      this.logger.error(
        {
          id: operationId,
          seriesId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'EXPLICIT UNMONITOR: Failed to explicitly unmonitor all episodes in series',
      )
      // Don't throw - we want to continue with deletion check even if this fails
    }
  }

  /**
   * Check if a series should be deleted (no monitored episodes remain)
   * Enhanced with better retry logic and timing considerations
   */
  private async checkIfSeriesShouldBeDeleted(
    seriesId: number,
    operationId: string,
  ): Promise<boolean> {
    this.logger.log(
      { id: operationId, seriesId },
      'DELETION CHECK: Starting check if series should be deleted',
    )

    try {
      // Wait longer for changes to propagate in Sonarr
      this.logger.log(
        { id: operationId, seriesId },
        'DELETION CHECK: Waiting 5 seconds for Sonarr changes to propagate',
      )
      await new Promise(resolve => setTimeout(resolve, 5000))

      // Get the updated series information with retry
      let series = null
      this.logger.log(
        { id: operationId, seriesId },
        'DELETION CHECK: Retrieving updated series information',
      )
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          series = await this.sonarrClient.getSeriesById(seriesId)
          if (series) {
            this.logger.log(
              {
                id: operationId,
                seriesId,
                attempt,
                seriesTitle: series.title,
                totalSeasons: series.seasons.length,
              },
              'DELETION CHECK: Successfully retrieved series information',
            )
            break
          }
        } catch (error) {
          this.logger.warn(
            {
              id: operationId,
              seriesId,
              attempt,
              maxAttempts: 3,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            'DELETION CHECK: Failed to retrieve series information, retrying',
          )
          if (attempt === 3) throw error
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        }
      }

      if (!series) {
        this.logger.warn(
          { id: operationId, seriesId },
          'DELETION CHECK: Series not found during deletion check',
        )
        return false
      }

      this.logger.log(
        {
          id: operationId,
          seriesId,
          seasonCount: series.seasons.length,
          monitoredSeasonCount: series.seasons.filter(
            s => s.monitored && s.seasonNumber > 0,
          ).length,
          allSeasons: series.seasons.map(s => ({
            number: s.seasonNumber,
            monitored: s.monitored,
            episodeCount: s.statistics?.episodeCount,
          })),
        },
        'DELETION CHECK: Analyzing series for deletion eligibility',
      )

      // Check all seasons (excluding specials - season 0)
      let totalMonitoredEpisodes = 0
      const seasonResults: Array<{
        season: number
        monitoredEpisodes: number
        error?: string
      }> = []

      for (const season of series.seasons) {
        if (season.seasonNumber === 0) continue // Skip specials

        this.logger.log(
          {
            id: operationId,
            seriesId,
            season: season.seasonNumber,
            seasonMonitored: season.monitored,
            seasonEpisodeCount: season.statistics?.episodeCount,
          },
          'DELETION CHECK: Analyzing season for monitored episodes',
        )

        let seasonMonitoredCount = 0
        let seasonError: string | undefined

        try {
          const episodes = await this.getEpisodesWithRetry(
            seriesId,
            season.seasonNumber,
            operationId,
            4, // Increased retries for better reliability
          )

          // Check if any episodes in this season are still monitored
          const monitoredEpisodes = episodes.filter(ep => ep.monitored)
          const unmonitoredEpisodes = episodes.filter(ep => !ep.monitored)
          seasonMonitoredCount = monitoredEpisodes.length
          totalMonitoredEpisodes += seasonMonitoredCount

          this.logger.log(
            {
              id: operationId,
              seriesId,
              season: season.seasonNumber,
              totalEpisodes: episodes.length,
              monitoredEpisodes: seasonMonitoredCount,
              unmonitoredEpisodes: unmonitoredEpisodes.length,
              monitoredEpisodeNumbers: monitoredEpisodes.map(
                ep => ep.episodeNumber,
              ),
            },
            `DELETION CHECK: Season ${season.seasonNumber} episode analysis`,
          )

          if (seasonMonitoredCount > 0) {
            this.logger.log(
              {
                id: operationId,
                seriesId,
                season: season.seasonNumber,
                monitoredCount: seasonMonitoredCount,
                totalEpisodes: episodes.length,
                monitoredEpisodeNumbers: monitoredEpisodes.map(
                  ep => ep.episodeNumber,
                ),
              },
              'DELETION CHECK: Found monitored episodes in season - series should NOT be deleted',
            )
          } else {
            this.logger.log(
              {
                id: operationId,
                seriesId,
                season: season.seasonNumber,
                totalEpisodes: episodes.length,
              },
              'DELETION CHECK: No monitored episodes found in season',
            )
          }
        } catch (error) {
          seasonError = error instanceof Error ? error.message : 'Unknown error'
          this.logger.warn(
            {
              id: operationId,
              seriesId,
              season: season.seasonNumber,
              error: seasonError,
            },
            'Failed to check episodes in season, assuming monitored (conservative approach)',
          )
          // If we can't check a season, assume it has monitored episodes (safer approach)
          return false
        }

        seasonResults.push({
          season: season.seasonNumber,
          monitoredEpisodes: seasonMonitoredCount,
          error: seasonError,
        })
      }

      this.logger.log(
        {
          id: operationId,
          seriesId,
          totalMonitoredEpisodes,
          seasonResults,
        },
        'DELETION CHECK: Series deletion check completed - detailed results',
      )

      const shouldDelete = totalMonitoredEpisodes === 0
      if (shouldDelete) {
        this.logger.log(
          {
            id: operationId,
            seriesId,
            totalMonitoredEpisodes,
            seasonResults,
          },
          'DELETION CHECK RESULT: No monitored episodes found, series SHOULD be deleted',
        )
      } else {
        this.logger.log(
          {
            id: operationId,
            seriesId,
            totalMonitoredEpisodes,
            seasonResults,
          },
          'DELETION CHECK RESULT: Monitored episodes remain, series should NOT be deleted',
        )
      }

      return shouldDelete
    } catch (error) {
      this.logger.error(
        {
          id: operationId,
          seriesId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to check if series should be deleted, assuming should not delete',
      )
      return false
    }
  }

  /**
   * Delete episode files for episodes that have files
   */
  private async deleteEpisodeFilesForEpisodes(
    episodes: EpisodeResource[],
    operationId: string,
  ): Promise<{ deletedFiles: number; failedDeletions: number }> {
    this.logger.log(
      { id: operationId, episodeCount: episodes.length },
      'Deleting episode files for episodes',
    )

    // Filter episodes that have files
    const episodesWithFiles = episodes.filter(
      ep => ep.hasFile && ep.episodeFileId,
    )

    if (episodesWithFiles.length === 0) {
      this.logger.log(
        { id: operationId, episodeCount: episodes.length },
        'No episodes with files found, skipping file deletion',
      )
      return { deletedFiles: 0, failedDeletions: 0 }
    }

    this.logger.log(
      {
        id: operationId,
        totalEpisodes: episodes.length,
        episodesWithFiles: episodesWithFiles.length,
      },
      'Found episodes with files to delete',
    )

    let deletedFiles = 0
    let failedDeletions = 0

    // Delete each episode file
    for (const episode of episodesWithFiles) {
      if (!episode.episodeFileId) continue

      try {
        await this.sonarrClient.deleteEpisodeFile(episode.episodeFileId)
        deletedFiles++

        this.logger.log(
          {
            id: operationId,
            episodeId: episode.id,
            episodeFileId: episode.episodeFileId,
            seasonEpisode: `S${episode.seasonNumber.toString().padStart(2, '0')}E${episode.episodeNumber.toString().padStart(2, '0')}`,
            title: episode.title,
          },
          'Episode file deleted successfully',
        )
      } catch (error) {
        failedDeletions++
        this.logger.warn(
          {
            id: operationId,
            episodeId: episode.id,
            episodeFileId: episode.episodeFileId,
            seasonEpisode: `S${episode.seasonNumber.toString().padStart(2, '0')}E${episode.episodeNumber.toString().padStart(2, '0')}`,
            title: episode.title,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          'Failed to delete episode file, continuing with others',
        )
      }
    }

    this.logger.log(
      {
        id: operationId,
        totalEpisodes: episodes.length,
        episodesWithFiles: episodesWithFiles.length,
        deletedFiles,
        failedDeletions,
      },
      'Episode file deletion completed',
    )

    return { deletedFiles, failedDeletions }
  }

  /**
   * Check if the provided selection represents all currently monitored content in the series
   */
  private async doesSelectionRepresentAllMonitoredContent(
    series: SonarrSeries,
    selection: Array<{ season: number; episodes?: number[] }>,
    operationId: string,
  ): Promise<boolean> {
    this.logger.log(
      {
        id: operationId,
        seriesId: series.id,
        selection,
        allSeasons: series.seasons.map(s => ({
          number: s.seasonNumber,
          monitored: s.monitored,
          episodeCount: s.statistics?.episodeCount,
        })),
      },
      'Checking if selection represents all monitored content',
    )

    try {
      // Get all monitored seasons (excluding specials - season 0)
      const monitoredSeasons = series.seasons.filter(
        season => season.monitored && season.seasonNumber > 0,
      )

      this.logger.log(
        {
          id: operationId,
          seriesId: series.id,
          monitoredSeasonNumbers: monitoredSeasons.map(s => s.seasonNumber),
          totalSeasonCount: series.seasons.length,
        },
        'Found monitored seasons in series',
      )

      if (monitoredSeasons.length === 0) {
        this.logger.log(
          { id: operationId, seriesId: series.id },
          'No monitored seasons found in series - cannot determine if selection represents all content',
        )
        return false
      }

      // Create a map of seasons in the selection for quick lookup
      const selectionMap = new Map<number, number[] | undefined>()
      for (const sel of selection) {
        selectionMap.set(sel.season, sel.episodes)
      }

      // Check each monitored season
      for (const monitoredSeason of monitoredSeasons) {
        const seasonNumber = monitoredSeason.seasonNumber
        const seasonInSelection = selectionMap.has(seasonNumber)
        const episodeSelection = selectionMap.get(seasonNumber)

        this.logger.log(
          {
            id: operationId,
            seriesId: series.id,
            seasonNumber,
            seasonInSelection,
            episodeSelection,
            isEntireSeasonSelected:
              seasonInSelection && episodeSelection === undefined,
          },
          'Checking monitored season against selection',
        )

        if (!seasonInSelection) {
          // This monitored season is not in the selection at all
          this.logger.log(
            {
              id: operationId,
              seriesId: series.id,
              seasonNumber,
            },
            'SELECTION CHECK FAILED: Monitored season not found in selection',
          )
          return false
        }

        if (episodeSelection && episodeSelection.length > 0) {
          // Specific episodes are selected, need to verify all monitored episodes are included
          try {
            const episodes = await this.getEpisodesWithRetry(
              series.id,
              seasonNumber,
              operationId,
              2,
            )

            const monitoredEpisodes = episodes.filter(ep => ep.monitored)
            const monitoredEpisodeNumbers = monitoredEpisodes.map(
              ep => ep.episodeNumber,
            )

            this.logger.log(
              {
                id: operationId,
                seriesId: series.id,
                seasonNumber,
                totalEpisodes: episodes.length,
                monitoredEpisodeNumbers,
                selectionEpisodeNumbers: episodeSelection,
              },
              'Comparing monitored episodes with episode selection',
            )

            // Check if all monitored episodes are in the selection
            for (const monitoredEpisodeNum of monitoredEpisodeNumbers) {
              if (!episodeSelection.includes(monitoredEpisodeNum)) {
                this.logger.log(
                  {
                    id: operationId,
                    seriesId: series.id,
                    seasonNumber,
                    missingEpisode: monitoredEpisodeNum,
                    selectionEpisodeNumbers: episodeSelection,
                  },
                  'SELECTION CHECK FAILED: Monitored episode not found in selection',
                )
                return false
              }
            }
          } catch (error) {
            this.logger.warn(
              {
                id: operationId,
                seriesId: series.id,
                seasonNumber,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
              'Failed to check episodes for season, assuming not complete selection',
            )
            return false
          }
        }
        // If episodeSelection is empty array or undefined, it means entire season is selected, which is fine
      }

      this.logger.log(
        {
          id: operationId,
          seriesId: series.id,
          monitoredSeasonCount: monitoredSeasons.length,
          selectionSeasonCount: selection.length,
        },
        'SELECTION CHECK PASSED: Selection represents all monitored content in series',
      )
      return true
    } catch (error) {
      this.logger.error(
        {
          id: operationId,
          seriesId: series.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to check if selection represents all monitored content',
      )
      return false
    }
  }

  /**
   * Get comprehensive series details with enhanced statistics
   * @param seriesId - Internal Sonarr series ID
   * @returns Enhanced series information with calculated statistics
   */
  async getSeriesDetails(seriesId: number): Promise<SeriesDetails> {
    const id = nanoid()

    this.logger.log({ id, seriesId }, 'Getting series details')

    try {
      const start = performance.now()

      // Get the series data
      const series = await this.sonarrClient.getSeriesById(seriesId)
      if (!series) {
        throw new Error(`Series with ID ${seriesId} not found`)
      }

      // Get all episodes for the series to calculate statistics
      const allEpisodes = await this.sonarrClient.getEpisodes(seriesId)

      // Calculate enhanced statistics
      const totalSeasons = series.seasons.filter(s => s.seasonNumber > 0).length
      const monitoredSeasons = series.seasons.filter(
        s => s.monitored && s.seasonNumber > 0,
      ).length

      const totalEpisodes = allEpisodes.filter(ep => ep.seasonNumber > 0).length
      const availableEpisodes = allEpisodes.filter(
        ep => ep.hasFile && ep.seasonNumber > 0,
      ).length
      const monitoredEpisodes = allEpisodes.filter(
        ep => ep.monitored && ep.seasonNumber > 0,
      ).length
      const downloadedEpisodes = availableEpisodes
      const missingEpisodes = monitoredEpisodes - downloadedEpisodes

      // Calculate total size on disk
      let totalSizeOnDisk = 0
      if (series.statistics) {
        totalSizeOnDisk = series.statistics.sizeOnDisk
      }

      // Calculate completion percentage
      const completionPercentage =
        totalEpisodes > 0 ? (downloadedEpisodes / totalEpisodes) * 100 : 0

      // Determine completion status
      const isCompleted = series.ended && completionPercentage === 100
      const hasAllEpisodes = missingEpisodes === 0

      const seriesDetails: SeriesDetails = {
        id: series.id,
        title: series.title,
        titleSlug: series.titleSlug,
        sortTitle: series.sortTitle,
        overview: series.overview,
        status: series.status,
        ended: series.ended,
        network: series.network,
        airTime: series.airTime,
        certification: series.certification,
        genres: series.genres,
        year: series.year,
        firstAired: series.firstAired,
        lastAired: series.lastAired,
        runtime: series.runtime,
        tvdbId: series.tvdbId,
        tmdbId: series.tmdbId,
        imdbId: series.imdbId,
        seriesType: series.seriesType,
        path: series.path,
        monitored: series.monitored,
        qualityProfileId: series.qualityProfileId,
        seasonFolder: series.seasonFolder,
        added: series.added,
        images: series.images,
        ratings: series.ratings,
        // Enhanced statistics
        totalSeasons,
        monitoredSeasons,
        totalEpisodes,
        availableEpisodes,
        monitoredEpisodes,
        downloadedEpisodes,
        missingEpisodes,
        totalSizeOnDisk,
        completionPercentage: Math.round(completionPercentage * 100) / 100,
        seasons: series.seasons,
        // Additional metadata
        isCompleted,
        hasAllEpisodes,
      }

      const duration = performance.now() - start

      // Validate output
      const validatedDetails =
        SonarrOutputSchemas.seriesDetails.parse(seriesDetails)

      this.logger.log(
        {
          id,
          seriesId,
          title: series.title,
          totalEpisodes,
          downloadedEpisodes,
          completionPercentage: validatedDetails.completionPercentage,
          duration,
        },
        'Series details retrieved successfully',
      )

      return validatedDetails
    } catch (error) {
      this.logger.error(
        {
          id,
          seriesId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get series details',
      )
      throw error
    }
  }

  /**
   * Get comprehensive season details with episode information
   * @param seriesId - Internal Sonarr series ID
   * @param seasonNumber - Season number (0 for specials)
   * @returns Enhanced season information with episode breakdown
   */
  async getSeasonDetails(
    seriesId: number,
    seasonNumber: number,
  ): Promise<SeasonDetails> {
    const id = nanoid()

    this.logger.log({ id, seriesId, seasonNumber }, 'Getting season details')

    try {
      const start = performance.now()

      // Get the series data to get series title and season info
      const series = await this.sonarrClient.getSeriesById(seriesId)
      if (!series) {
        throw new Error(`Series with ID ${seriesId} not found`)
      }

      // Find the specific season
      const season = series.seasons.find(s => s.seasonNumber === seasonNumber)
      if (!season) {
        throw new Error(
          `Season ${seasonNumber} not found for series ${series.title}`,
        )
      }

      // Get all episodes for this season
      const episodes = await this.sonarrClient.getEpisodes(
        seriesId,
        seasonNumber,
      )

      // Get episode files for size calculation
      const episodeFiles = await this.sonarrClient.getEpisodeFiles({
        seriesId,
        seasonNumber,
      })

      // Create episode file map for quick lookup
      const episodeFileMap = new Map(episodeFiles.map(file => [file.id, file]))

      // Calculate season statistics
      const totalEpisodes = episodes.length
      const availableEpisodes = episodes.filter(ep => ep.hasFile).length
      const monitoredEpisodes = episodes.filter(ep => ep.monitored).length
      const downloadedEpisodes = availableEpisodes
      const missingEpisodes = monitoredEpisodes - downloadedEpisodes

      // Calculate size on disk
      const sizeOnDisk = episodeFiles.reduce(
        (total, file) => total + file.size,
        0,
      )

      // Calculate completion percentage
      const completionPercentage =
        totalEpisodes > 0 ? (downloadedEpisodes / totalEpisodes) * 100 : 0

      // Determine completion status
      const isCompleted = completionPercentage === 100
      const hasAllEpisodes = missingEpisodes === 0

      // Format episodes with additional details
      const formattedEpisodes = episodes.map(episode => {
        let fileSize: number | undefined
        let quality: string | undefined

        if (episode.episodeFileId) {
          const episodeFile = episodeFileMap.get(episode.episodeFileId)
          if (episodeFile) {
            fileSize = episodeFile.size
            quality = episodeFile.quality.quality.name
          }
        }

        return {
          id: episode.id,
          episodeNumber: episode.episodeNumber,
          title: episode.title,
          monitored: episode.monitored,
          hasFile: episode.hasFile,
          airDate: episode.airDate,
          overview: episode.overview,
          runtime: episode.runtime,
          episodeFileId: episode.episodeFileId,
          fileSize,
          quality,
        }
      })

      const seasonDetails: SeasonDetails = {
        seriesId,
        seriesTitle: series.title,
        seasonNumber,
        monitored: season.monitored,
        // Season statistics
        totalEpisodes,
        availableEpisodes,
        downloadedEpisodes,
        missingEpisodes,
        monitoredEpisodes,
        sizeOnDisk,
        completionPercentage: Math.round(completionPercentage * 100) / 100,
        // Episode breakdown
        episodes: formattedEpisodes,
        // Season metadata
        isCompleted,
        hasAllEpisodes,
      }

      const duration = performance.now() - start

      // Validate output
      const validatedDetails =
        SonarrOutputSchemas.seasonDetails.parse(seasonDetails)

      this.logger.log(
        {
          id,
          seriesId,
          seasonNumber,
          seriesTitle: series.title,
          totalEpisodes,
          downloadedEpisodes,
          completionPercentage: validatedDetails.completionPercentage,
          duration,
        },
        'Season details retrieved successfully',
      )

      return validatedDetails
    } catch (error) {
      this.logger.error(
        {
          id,
          seriesId,
          seasonNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get season details',
      )
      throw error
    }
  }

  /**
   * Get comprehensive episode details with file information
   * @param episodeId - Internal Sonarr episode ID
   * @returns Enhanced episode information with file details
   */
  async getEpisodeDetails(episodeId: number): Promise<EpisodeDetails> {
    const id = nanoid()

    this.logger.log({ id, episodeId }, 'Getting episode details')

    try {
      const start = performance.now()

      // Get the episode data
      const episode = await this.sonarrClient.getEpisodeById(episodeId)
      if (!episode) {
        throw new Error(`Episode with ID ${episodeId} not found`)
      }

      // Get the series data for series information
      const series = await this.sonarrClient.getSeriesById(episode.seriesId)
      if (!series) {
        throw new Error(
          `Series with ID ${episode.seriesId} not found for episode`,
        )
      }

      // Get episode file information if episode has a file
      let episodeFile: EpisodeDetails['episodeFile']
      if (episode.hasFile && episode.episodeFileId) {
        try {
          const episodeFiles = await this.sonarrClient.getEpisodeFiles({
            episodeFileIds: [episode.episodeFileId],
          })

          if (episodeFiles.length > 0) {
            const file = episodeFiles[0]

            // Format file size for display
            const formatBytes = (bytes: number): string => {
              if (bytes === 0) return '0 B'
              const k = 1024
              const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
              const i = Math.floor(Math.log(bytes) / Math.log(k))
              return (
                parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
              )
            }

            episodeFile = {
              id: file.id,
              relativePath: file.relativePath,
              path: file.path,
              size: file.size,
              sizeFormatted: formatBytes(file.size),
              dateAdded: file.dateAdded,
              releaseGroup: file.releaseGroup,
              quality: {
                name: file.quality.quality.name,
                source: file.quality.quality.source,
                resolution: file.quality.quality.resolution,
              },
              mediaInfo:
                file.mediaInfo &&
                typeof file.mediaInfo.height === 'number' &&
                typeof file.mediaInfo.width === 'number'
                  ? {
                      audioChannels: file.mediaInfo.audioChannels,
                      audioCodec: file.mediaInfo.audioCodec,
                      height: file.mediaInfo.height,
                      width: file.mediaInfo.width,
                      videoCodec: file.mediaInfo.videoCodec,
                      subtitles: file.mediaInfo.subtitles
                        ? Array.isArray(file.mediaInfo.subtitles)
                          ? file.mediaInfo.subtitles
                          : (file.mediaInfo.subtitles as unknown as string)
                              .split(',')
                              .map((s: string) => s.trim())
                              .filter((s: string) => s.length > 0)
                        : undefined,
                    }
                  : undefined,
            }
          }
        } catch (error) {
          this.logger.warn(
            {
              id,
              episodeId,
              episodeFileId: episode.episodeFileId,
              error: error instanceof Error ? error.message : 'Unknown error',
            },
            'Failed to get episode file details, continuing without file info',
          )
        }
      }

      // Determine episode status
      const isAvailable = episode.hasFile
      const isMonitored = episode.monitored
      const isDownloaded = episode.hasFile
      const isMissing = episode.monitored && !episode.hasFile

      const episodeDetails: EpisodeDetails = {
        id: episode.id,
        seriesId: episode.seriesId,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        monitored: episode.monitored,
        hasFile: episode.hasFile,
        airDate: episode.airDate,
        overview: episode.overview,
        runtime: episode.runtime,
        absoluteEpisodeNumber: episode.absoluteEpisodeNumber,
        // Series information
        seriesTitle: series.title,
        seriesYear: series.year || 0,
        seriesStatus: series.status,
        // File information
        episodeFile,
        // Episode status
        isAvailable,
        isMonitored,
        isDownloaded,
        isMissing,
      }

      const duration = performance.now() - start

      // Validate output
      const validatedDetails =
        SonarrOutputSchemas.episodeDetails.parse(episodeDetails)

      this.logger.log(
        {
          id,
          episodeId,
          seriesTitle: series.title,
          seasonEpisode: `S${episode.seasonNumber.toString().padStart(2, '0')}E${episode.episodeNumber.toString().padStart(2, '0')}`,
          title: episode.title,
          hasFile: episode.hasFile,
          monitored: episode.monitored,
          duration,
        },
        'Episode details retrieved successfully',
      )

      return validatedDetails as EpisodeDetails
    } catch (error) {
      this.logger.error(
        {
          id,
          episodeId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get episode details',
      )
      throw error
    }
  }

  /**
   * Validate unmonitor series options input
   */
  private validateUnmonitorSeriesOptions(
    options: UnmonitorSeriesOptions,
  ): UnmonitorSeriesOptionsInput {
    try {
      return SonarrInputSchemas.unmonitorSeriesOptions.parse(options)
    } catch (error) {
      this.logger.error(
        {
          options,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Invalid unmonitor series options input',
      )
      throw new Error(
        `Invalid unmonitor series options: ${error instanceof Error ? error.message : 'Unknown validation error'}`,
      )
    }
  }
}
