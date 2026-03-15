import type {
  CommandResource,
  CommandResourceWritable,
  EpisodeResource as SdkEpisodeResource,
  QualityProfileResource,
  QueueResource,
  QueueResourcePagingResource,
  RootFolderResource,
  SeriesResource,
  SeriesResourceWritable,
} from '@lilnas/media/sonarr'
import {
  deleteApiV3EpisodefileById,
  deleteApiV3QueueById,
  deleteApiV3SeriesById,
  getApiV3Episode,
  getApiV3EpisodeById,
  getApiV3Qualityprofile,
  getApiV3Queue,
  getApiV3Rootfolder,
  getApiV3Series,
  getApiV3SeriesById,
  getApiV3SeriesLookup,
  postApiV3Command,
  postApiV3Series,
  putApiV3EpisodeMonitor,
  putApiV3SeriesById,
} from '@lilnas/media/sonarr'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'
import { performance } from 'perf_hooks'

/**
 * Sonarr's SeriesSearch command accepts seriesId but the generated SDK type
 * omits command-specific body parameters. We extend it locally so TypeScript
 * validates the extra field rather than silently ignoring it via a raw `as`.
 */
type SeriesSearchCommand = CommandResourceWritable & { seriesId?: number }

/**
 * Polling config for checkIfSeriesShouldBeDeleted.
 * After unmonitoring episodes Sonarr's state is eventually consistent, so we
 * poll with exponential backoff until the expected state is observed.
 */
const CONSISTENCY_POLL_MAX_ATTEMPTS = 3
const CONSISTENCY_POLL_BASE_DELAY_MS = 1000

import { RetryConfigService } from 'src/config/retry.config'
import type { SonarrMediaClient } from 'src/media/clients'
import { SONARR_CLIENT } from 'src/media/clients'
import { MediaApiError } from 'src/media/errors/media-api.error'
import {
  MonitorSeriesOptionsInput,
  SonarrInputSchemas,
  SonarrOutputSchemas,
  UnmonitorSeriesOptionsInput,
} from 'src/media/schemas/sonarr.schemas'
import { BaseMediaService } from 'src/media/services/base-media.service'
import {
  AddSeriesRequest,
  DownloadingSeries,
  EpisodeResource,
  LibrarySearchResult,
  MonitorAndDownloadSeriesResult,
  MonitoringChange,
  MonitorSeriesOptions,
  SeriesSearchResult,
  SonarrSeries,
  SonarrSeriesType,
  UnmonitorAndDeleteSeriesResult,
  UnmonitoringChange,
  UnmonitorSeriesOptions,
} from 'src/media/types/sonarr.types'
import { errorMessage, numericIdAsString } from 'src/media/utils/media.utils'
import {
  determineMonitoringStrategy,
  toDownloadingSeries,
  toEpisodeResource,
  toEpisodeResourceArray,
  toSonarrSeries,
  toSonarrSeriesArray,
  toSonarrSeriesResourceArray,
  transformToSearchResults,
} from 'src/media/utils/sonarr.utils'
import { RetryConfig, RetryService } from 'src/utils/retry.service'

@Injectable()
export class SonarrService extends BaseMediaService {
  protected readonly logger = new Logger(SonarrService.name)
  protected readonly serviceName = 'SonarrService'
  protected readonly circuitBreakerKey = 'sonarr-api'
  protected readonly retryConfig: RetryConfig

  constructor(
    @Inject(SONARR_CLIENT) private readonly client: SonarrMediaClient,
    protected readonly retryService: RetryService,
    retryConfigService: RetryConfigService,
  ) {
    super()
    this.retryConfig = retryConfigService.getSonarrConfig()
  }

  /**
   * Search for TV series by title - Main public API method
   */
  async searchShows(query: string): Promise<SeriesSearchResult[]> {
    const id = nanoid()

    const validatedInput = this.validateSearchQuery(
      { query },
      SonarrInputSchemas.searchQuery,
    )
    const normalizedQuery = validatedInput.query

    this.logger.log({ id, query: normalizedQuery }, 'Starting series search')

    return await this.fetchSeriesSearch(normalizedQuery, id)
  }

  /**
   * Get series in Sonarr library with optional search query
   */
  async getLibrarySeries(query?: string): Promise<LibrarySearchResult[]> {
    const id = nanoid()

    const validatedInput = this.validateOptionalSearchQuery(
      { query },
      SonarrInputSchemas.optionalSearchQuery,
    )
    const normalizedQuery = validatedInput.query

    this.logger.log(
      { id, query: normalizedQuery, hasQuery: !!normalizedQuery },
      'Getting library series from Sonarr',
    )

    return await this.fetchLibrarySeries(normalizedQuery, id)
  }

  /**
   * Get all currently downloading episodes from Sonarr
   */
  async getDownloadingEpisodes(): Promise<DownloadingSeries[]> {
    const id = nanoid()

    this.logger.log({ id }, 'Getting all downloading episodes from Sonarr')

    try {
      const start = performance.now()

      const queueResponse =
        await this.executeWithRetry<QueueResourcePagingResource>(
          () =>
            getApiV3Queue({
              client: this.client,
              query: {
                includeEpisode: true,
                includeSeries: true,
                pageSize: 1000,
              },
            }),
          `${this.serviceName}-getQueue-${id}`,
        )

      const allQueueItems: QueueResource[] = queueResponse.records ?? []

      const downloadingItems = allQueueItems.filter(item => {
        const status = (item.status ?? '').toLowerCase()
        return (
          status === 'downloading' ||
          status === 'queued' ||
          status === 'paused' ||
          status === 'warning'
        )
      })

      const downloadingEpisodes = downloadingItems.map(item =>
        toDownloadingSeries(item),
      )

      const duration = performance.now() - start

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
        { id, error: errorMessage(error) },
        'Failed to get downloading episodes from Sonarr',
      )
      throw error
    }
  }

  /**
   * Monitor and download a series with granular control over seasons/episodes
   */
  async monitorAndDownloadSeries(
    tvdbId: number,
    options: MonitorSeriesOptions = {},
  ): Promise<MonitorAndDownloadSeriesResult> {
    const id = nanoid()

    try {
      const validatedOptions = this.validateMonitorSeriesOptions(options)

      this.logger.log(
        { id, tvdbId, options: validatedOptions },
        'Starting monitor and download series operation',
      )

      const start = performance.now()

      const existingSeries = await this.getSeriesByTvdbId(tvdbId, id)

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
        let series: SeriesSearchResult
        try {
          const searchResults = await this.searchShows(tvdbId.toString())
          const exactMatch = searchResults.find(r => r.tvdbId === tvdbId)

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
        { id, tvdbId, error: errorMessage(error) },
        'Failed to monitor and download series',
      )

      return {
        success: false,
        seriesAdded: false,
        seriesUpdated: false,
        searchTriggered: false,
        changes: [],
        error: errorMessage(error),
      }
    }
  }

  /**
   * Unmonitor and delete series with granular control over seasons/episodes
   */
  async unmonitorAndDeleteSeries(
    tvdbId: number,
    options: UnmonitorSeriesOptions = {},
  ): Promise<UnmonitorAndDeleteSeriesResult> {
    const id = nanoid()

    try {
      const validatedOptions = this.validateUnmonitorSeriesOptions(options)

      this.logger.log(
        { id, tvdbId, options: validatedOptions },
        'Starting unmonitor and delete series operation',
      )

      const start = performance.now()

      const existingSeries = await this.getSeriesByTvdbId(tvdbId, id)

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

      if (!validatedOptions.selection) {
        this.logger.log(
          { id, seriesId: existingSeries.id },
          'Deleting entire series (no selection provided)',
        )

        return await this.deleteEntireSeries(existingSeries, id)
      }

      this.logger.log(
        { id, seriesId: existingSeries.id },
        'Applying granular unmonitoring (selection provided)',
      )

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
        { id, tvdbId, error: errorMessage(error) },
        'Failed to unmonitor and delete series',
      )

      return {
        success: false,
        seriesDeleted: false,
        episodesUnmonitored: false,
        downloadsCancel: false,
        canceledDownloads: 0,
        changes: [],
        error: errorMessage(error),
      }
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

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
      const rawSeries = await this.executeWithRetry<SeriesResource[]>(
        () =>
          getApiV3SeriesLookup({
            client: this.client,
            query: { term: query },
          }),
        `${this.serviceName}-searchSeries-${operationId}`,
      )

      const duration = performance.now() - start

      const results = transformToSearchResults(
        toSonarrSeriesResourceArray(rawSeries),
      )
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
        { id: operationId, query, duration, error: errorMessage(error) },
        'Failed to fetch series search',
      )

      throw error
    }
  }

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
      const allSeries = toSonarrSeriesArray(
        await this.executeWithRetry<SeriesResource[]>(
          () => getApiV3Series({ client: this.client }),
          `${this.serviceName}-getLibrarySeries-${operationId}`,
        ),
      )

      let filteredSeries = allSeries

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

      const results = this.transformToLibraryResults(filteredSeries)
      const duration = performance.now() - start

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
        { id: operationId, query, duration, error: errorMessage(error) },
        'Failed to fetch library series',
      )

      throw error
    }
  }

  private async getSeriesByTvdbId(
    tvdbId: number,
    operationId: string,
  ): Promise<SonarrSeries | null> {
    const allSeries = toSonarrSeriesArray(
      await this.executeWithRetry<SeriesResource[]>(
        () => getApiV3Series({ client: this.client }),
        `${this.serviceName}-getSeriesByTvdbId-${operationId}`,
      ),
    )

    return allSeries.find(s => s.tvdbId === tvdbId) ?? null
  }

  private async getSeriesById(
    seriesId: number,
    operationId: string,
  ): Promise<SonarrSeries | null> {
    try {
      const data = await this.executeWithRetry<SeriesResource | null>(
        () =>
          getApiV3SeriesById({
            client: this.client,
            path: { id: seriesId },
          }),
        `${this.serviceName}-getSeriesById-${operationId}`,
      )
      if (data == null) return null
      return toSonarrSeries(data)
    } catch (error) {
      if (error instanceof MediaApiError && error.response.status === 404) {
        return null
      }
      throw error
    }
  }

  private async updateSeries(
    seriesId: number,
    updates: Partial<SonarrSeries>,
    operationId: string,
  ): Promise<SonarrSeries> {
    const existing = toSonarrSeries(
      await this.executeWithRetry<SeriesResource>(
        () =>
          getApiV3SeriesById({
            client: this.client,
            path: { id: seriesId },
          }),
        `${this.serviceName}-getSeriesForUpdate-${operationId}`,
      ),
    )

    const merged = { ...existing, ...updates, id: seriesId }

    return toSonarrSeries(
      await this.executeWithRetry<SeriesResource>(
        () =>
          putApiV3SeriesById({
            client: this.client,
            path: { id: numericIdAsString(seriesId) },
            // Domain SonarrRatings uses a local type; SDK expects Ratings.
            // The shapes are compatible at runtime – only the type names differ.
            body: merged as unknown as SeriesResourceWritable,
          }),
        `${this.serviceName}-updateSeries-${operationId}`,
      ),
    )
  }

  private async getEpisodes(
    seriesId: number,
    seasonNumber: number | undefined,
    operationId: string,
  ): Promise<EpisodeResource[]> {
    return toEpisodeResourceArray(
      await this.executeWithRetry<SdkEpisodeResource[]>(
        () =>
          getApiV3Episode({
            client: this.client,
            query: {
              seriesId,
              ...(seasonNumber !== undefined ? { seasonNumber } : {}),
            },
          }),
        `${this.serviceName}-getEpisodes-${operationId}`,
      ),
    )
  }

  private async getEpisodeById(
    episodeId: number,
    operationId: string,
  ): Promise<EpisodeResource | null> {
    try {
      const data = await this.executeWithRetry<SdkEpisodeResource | null>(
        () =>
          getApiV3EpisodeById({
            client: this.client,
            path: { id: episodeId },
          }),
        `${this.serviceName}-getEpisodeById-${operationId}`,
      )
      if (data == null) return null
      return toEpisodeResource(data)
    } catch (error) {
      if (error instanceof MediaApiError && error.response.status === 404) {
        return null
      }
      throw error
    }
  }

  private async updateEpisodesMonitoring(
    request: { episodeIds: number[]; monitored: boolean },
    operationId: string,
  ): Promise<void> {
    await this.executeWithRetry(
      () =>
        putApiV3EpisodeMonitor({
          client: this.client,
          body: {
            episodeIds: request.episodeIds,
            monitored: request.monitored,
          },
        }),
      `${this.serviceName}-updateEpisodesMonitoring-${operationId}`,
    )
  }

  private async triggerSeriesSearch(
    seriesId: number,
    operationId: string,
  ): Promise<CommandResource> {
    const command: SeriesSearchCommand = { name: 'SeriesSearch', seriesId }
    return this.executeWithRetry<CommandResource>(
      () =>
        postApiV3Command({
          client: this.client,
          body: command,
        }),
      `${this.serviceName}-triggerSeriesSearch-${operationId}`,
    )
  }

  private async getQueue(operationId: string): Promise<QueueResource[]> {
    const response = await this.executeWithRetry<QueueResourcePagingResource>(
      () => getApiV3Queue({ client: this.client, query: { pageSize: 1000 } }),
      `${this.serviceName}-getQueue-${operationId}`,
    )

    return response.records ?? []
  }

  private async removeQueueItem(
    queueId: number,
    operationId: string,
  ): Promise<void> {
    await this.executeWithRetry(
      () =>
        deleteApiV3QueueById({
          client: this.client,
          path: { id: queueId },
          query: { removeFromClient: true },
        }),
      `${this.serviceName}-removeQueueItem-${queueId}-${operationId}`,
    )
  }

  private async deleteSeries(
    seriesId: number,
    options: { deleteFiles?: boolean; addImportListExclusion?: boolean },
    operationId: string,
  ): Promise<void> {
    await this.executeWithRetry(
      () =>
        deleteApiV3SeriesById({
          client: this.client,
          path: { id: seriesId },
          query: {
            deleteFiles: options.deleteFiles,
            addImportListExclusion: options.addImportListExclusion,
          },
        }),
      `${this.serviceName}-deleteSeries-${operationId}`,
    )
  }

  private async deleteEpisodeFile(
    episodeFileId: number,
    operationId: string,
  ): Promise<void> {
    await this.executeWithRetry(
      () =>
        deleteApiV3EpisodefileById({
          client: this.client,
          path: { id: episodeFileId },
        }),
      `${this.serviceName}-deleteEpisodeFile-${episodeFileId}-${operationId}`,
    )
  }

  private async getSeriesConfiguration(operationId: string): Promise<{
    qualityProfileId: number
    rootFolderPath: string
  }> {
    const [profiles, folders] = await Promise.all([
      this.executeWithRetry<QualityProfileResource[]>(
        () => getApiV3Qualityprofile({ client: this.client }),
        `${this.serviceName}-getQualityProfiles-${operationId}`,
      ),
      this.executeWithRetry<RootFolderResource[]>(
        () => getApiV3Rootfolder({ client: this.client }),
        `${this.serviceName}-getRootFolders-${operationId}`,
      ),
    ])

    if (profiles.length === 0) {
      throw new Error('No quality profiles found in Sonarr')
    }

    if (folders.length === 0) {
      throw new Error('No root folders found in Sonarr')
    }

    const folderPath = folders[0].path
    if (folderPath == null) {
      throw new Error('Root folder returned from Sonarr has no path')
    }

    const anyProfile = profiles.find(p =>
      (p.name ?? '').toLowerCase().includes('any'),
    )

    if (anyProfile) {
      if (anyProfile.id == null) {
        throw new Error('"Any" quality profile returned from Sonarr has no ID')
      }
      return { qualityProfileId: anyProfile.id, rootFolderPath: folderPath }
    }

    const firstProfile = profiles[0]
    if (firstProfile.id == null) {
      throw new Error('Quality profile returned from Sonarr has no ID')
    }

    this.logger.warn(
      { availableProfiles: profiles.map(p => p.name) },
      'No "Any" quality profile found, using first available profile',
    )

    return { qualityProfileId: firstProfile.id, rootFolderPath: folderPath }
  }

  private async addNewSeries(
    series: SeriesSearchResult,
    options: MonitorSeriesOptions,
    operationId: string,
  ): Promise<MonitorAndDownloadSeriesResult> {
    this.logger.log(
      { id: operationId, tvdbId: series.tvdbId },
      'Getting series configuration',
    )

    const config = await this.getSeriesConfiguration(operationId)

    this.logger.log(
      { id: operationId, config },
      'Determining monitoring strategy',
    )

    const { monitorType, seasons } = determineMonitoringStrategy(
      series.seasons,
      options,
    )

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

    const addedSeries = toSonarrSeries(
      await this.executeWithRetry<SeriesResource>(
        () =>
          postApiV3Series({
            client: this.client,
            // Domain AddSeriesRequest uses local enum types; SDK expects SDK types.
            // The shapes are compatible at runtime – only the enum types differ.
            body: addRequest as unknown as SeriesResourceWritable,
          }),
        `${this.serviceName}-addSeries-${operationId}`,
      ),
    )

    const changes: MonitoringChange[] = []
    if (options.selection) {
      const episodeChanges = await this.applyEpisodeMonitoring(
        addedSeries,
        options.selection,
        operationId,
      )
      changes.push(...episodeChanges)
    } else {
      const episodeChanges = await this.monitorAllEpisodesInMonitoredSeasons(
        addedSeries,
        operationId,
      )
      changes.push(...episodeChanges)
    }

    const command = await this.triggerSeriesSearch(addedSeries.id, operationId)

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

      const updatedSeasons = existingSeries.seasons.map(season => ({
        ...season,
        monitored: true,
      }))

      const updatedSeries = await this.updateSeries(
        existingSeries.id,
        { seasons: updatedSeasons, monitored: true },
        operationId,
      )

      for (const season of existingSeries.seasons) {
        if (!season.monitored && season.seasonNumber > 0) {
          changes.push({ season: season.seasonNumber, action: 'monitored' })
        }
      }

      const episodeChanges = await this.monitorAllEpisodesInMonitoredSeasons(
        updatedSeries,
        operationId,
      )
      changes.push(...episodeChanges)

      if (changes.length > 0) {
        const command = await this.triggerSeriesSearch(
          existingSeries.id,
          operationId,
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

    const episodeChanges = await this.applyEpisodeMonitoring(
      existingSeries,
      options.selection,
      operationId,
    )
    changes.push(...episodeChanges)

    if (changes.length > 0) {
      const command = await this.triggerSeriesSearch(
        existingSeries.id,
        operationId,
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

  private async applyEpisodeMonitoring(
    series: SonarrSeries,
    selection: Array<{ season: number; episodes?: number[] }>,
    operationId: string,
  ): Promise<MonitoringChange[]> {
    const changes: MonitoringChange[] = []

    for (const sel of selection) {
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
        this.logger.log(
          { id: operationId, season: sel.season },
          'Monitoring entire season',
        )

        const allEpisodeIds = episodes.map(ep => ep.id)
        if (allEpisodeIds.length > 0) {
          await this.updateEpisodesMonitoring(
            { episodeIds: allEpisodeIds, monitored: true },
            operationId,
          )
          changes.push({ season: sel.season, action: 'monitored' })
        }
      } else {
        this.logger.log(
          {
            id: operationId,
            season: sel.season,
            selectedEpisodes: sel.episodes,
          },
          'Monitoring specific episodes in season',
        )

        const selectedEpisodeIds = episodes
          .filter(ep => sel.episodes!.includes(ep.episodeNumber))
          .map(ep => ep.id)

        const unselectedEpisodeIds = episodes
          .filter(ep => !sel.episodes!.includes(ep.episodeNumber))
          .map(ep => ep.id)

        if (selectedEpisodeIds.length > 0) {
          await this.updateEpisodesMonitoring(
            { episodeIds: selectedEpisodeIds, monitored: true },
            operationId,
          )
          changes.push({
            season: sel.season,
            episodes: sel.episodes,
            action: 'monitored',
          })
        }

        if (unselectedEpisodeIds.length > 0) {
          await this.updateEpisodesMonitoring(
            { episodeIds: unselectedEpisodeIds, monitored: false },
            operationId,
          )

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

  private async getEpisodesWithRetry(
    seriesId: number,
    seasonNumber: number,
    operationId: string,
    maxRetries = 3,
  ): Promise<EpisodeResource[]> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const episodes = await this.getEpisodes(
        seriesId,
        seasonNumber,
        operationId,
      )

      if (episodes.length > 0) {
        return episodes
      }

      if (attempt < maxRetries) {
        const waitTime = attempt * 2
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
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
      }
    }

    this.logger.warn(
      { id: operationId, seriesId, seasonNumber, maxRetries },
      `No episodes found for season ${seasonNumber} after ${maxRetries} attempts`,
    )

    return []
  }

  private async monitorAllEpisodesInMonitoredSeasons(
    series: SonarrSeries,
    operationId: string,
  ): Promise<MonitoringChange[]> {
    const changes: MonitoringChange[] = []

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

    for (const season of monitoredSeasons) {
      try {
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

        const episodeIds = episodes.map(ep => ep.id)

        await this.updateEpisodesMonitoring(
          { episodeIds, monitored: true },
          operationId,
        )

        this.logger.log(
          {
            id: operationId,
            seriesId: series.id,
            seasonNumber: season.seasonNumber,
            episodeCount: episodeIds.length,
          },
          'Successfully monitored all episodes in season',
        )

        changes.push({ season: season.seasonNumber, action: 'monitored' })
      } catch (error) {
        this.logger.error(
          {
            id: operationId,
            seriesId: series.id,
            seasonNumber: season.seasonNumber,
            error: errorMessage(error),
          },
          'Failed to monitor episodes in season',
        )
      }
    }

    return changes
  }

  private async cancelDownloadsForSeries(
    seriesId: number,
    operationId: string,
  ): Promise<{ canceled: number; commandIds: number[] }> {
    this.logger.log(
      { id: operationId, seriesId },
      'Canceling downloads for series',
    )

    try {
      const queue = await this.getQueue(operationId)
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

      for (const download of seriesDownloads) {
        if (download.id == null) continue
        try {
          await this.removeQueueItem(download.id, operationId)
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
              error: errorMessage(error),
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
        { id: operationId, seriesId, error: errorMessage(error) },
        'Failed to get queue for series download cancellation',
      )
      return { canceled: 0, commandIds: [] }
    }
  }

  private async cancelDownloadsForEpisodes(
    episodeIds: number[],
    operationId: string,
  ): Promise<{ canceled: number; commandIds: number[] }> {
    this.logger.log(
      { id: operationId, episodeCount: episodeIds.length },
      'Canceling downloads for episodes',
    )

    try {
      const queue = await this.getQueue(operationId)
      const episodeDownloads = queue.filter(
        item => item.episodeId != null && episodeIds.includes(item.episodeId),
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

      for (const download of episodeDownloads) {
        if (download.id == null) continue
        try {
          await this.removeQueueItem(download.id, operationId)
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
              error: errorMessage(error),
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
          error: errorMessage(error),
        },
        'Failed to get queue for episode download cancellation',
      )
      return { canceled: 0, commandIds: [] }
    }
  }

  private async deleteEntireSeries(
    series: SonarrSeries,
    operationId: string,
  ): Promise<UnmonitorAndDeleteSeriesResult> {
    this.logger.log(
      { id: operationId, seriesId: series.id, title: series.title },
      'Deleting entire series',
    )

    try {
      const downloadResult = await this.cancelDownloadsForSeries(
        series.id,
        operationId,
      )

      await this.deleteSeries(
        series.id,
        { deleteFiles: true, addImportListExclusion: false },
        operationId,
      )

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
        { season: 0, action: 'deleted_series' },
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
          error: errorMessage(error),
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
        error: errorMessage(error),
      }
    }
  }

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
      for (const selection of options.selection!) {
        const episodeChanges = await this.applyEpisodeUnmonitoring(
          currentSeries,
          selection,
          operationId,
        )
        changes.push(...episodeChanges.changes)
        totalCanceledDownloads += episodeChanges.canceledDownloads
        allCommandIds.push(...episodeChanges.commandIds)

        if (episodeChanges.updatedSeries) {
          currentSeries = episodeChanges.updatedSeries
        }
      }

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

        await this.deleteSeries(
          series.id,
          {
            deleteFiles: options.deleteFiles ?? false,
            addImportListExclusion: false,
          },
          operationId,
        )

        seriesDeleted = true
        changes.push({ season: 0, action: 'deleted_series' })
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
        { id: operationId, seriesId: series.id, error: errorMessage(error) },
        'Failed to apply granular unmonitoring',
      )

      return {
        success: false,
        seriesDeleted: false,
        episodesUnmonitored: false,
        downloadsCancel: false,
        canceledDownloads: 0,
        changes,
        error: errorMessage(error),
      }
    }
  }

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
        this.logger.log(
          { id: operationId, season: selection.season },
          'Unmonitoring entire season',
        )

        const allEpisodeIds = episodes.map(ep => ep.id)
        if (allEpisodeIds.length > 0) {
          const downloadResult = await this.cancelDownloadsForEpisodes(
            allEpisodeIds,
            operationId,
          )
          canceledDownloads += downloadResult.canceled
          commandIds.push(...downloadResult.commandIds)

          const deletionResult = await this.deleteEpisodeFilesForEpisodes(
            episodes,
            operationId,
          )

          await this.updateEpisodesMonitoring(
            { episodeIds: allEpisodeIds, monitored: false },
            operationId,
          )

          const updatedSeasons = currentSeries.seasons.map(season => {
            if (season.seasonNumber === selection.season) {
              return { ...season, monitored: false }
            }
            return season
          })

          currentSeries = await this.updateSeries(
            currentSeries.id,
            { seasons: updatedSeasons },
            operationId,
          )

          changes.push({ season: selection.season, action: 'unmonitored' })
          changes.push({
            season: selection.season,
            action: 'unmonitored_season',
          })

          if (deletionResult.deletedFiles > 0) {
            changes.push({ season: selection.season, action: 'deleted_files' })
          }
        }
      } else {
        this.logger.log(
          {
            id: operationId,
            season: selection.season,
            selectedEpisodes: selection.episodes,
          },
          'Unmonitoring specific episodes in season',
        )

        const selectedEpisodeIds = episodes
          .filter(ep => selection.episodes!.includes(ep.episodeNumber))
          .map(ep => ep.id)

        if (selectedEpisodeIds.length > 0) {
          const downloadResult = await this.cancelDownloadsForEpisodes(
            selectedEpisodeIds,
            operationId,
          )
          canceledDownloads += downloadResult.canceled
          commandIds.push(...downloadResult.commandIds)

          const selectedEpisodes = episodes.filter(ep =>
            selection.episodes!.includes(ep.episodeNumber),
          )
          const deletionResult = await this.deleteEpisodeFilesForEpisodes(
            selectedEpisodes,
            operationId,
          )

          await this.updateEpisodesMonitoring(
            { episodeIds: selectedEpisodeIds, monitored: false },
            operationId,
          )

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
          error: errorMessage(error),
        },
        'Failed to apply episode unmonitoring',
      )

      throw error
    }
  }

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
      const episodes = await this.getEpisodesWithRetry(
        series.id,
        seasonNumber,
        operationId,
        2,
      )

      if (episodes.length === 0) {
        this.logger.warn(
          { id: operationId, seriesId: series.id, seasonNumber },
          'No episodes found for season, skipping unmonitoring check',
        )
        return { seasonUnmonitored: false }
      }

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

      this.logger.log(
        { id: operationId, seriesId: series.id, seasonNumber },
        'No monitored episodes remain in season, unmonitoring season',
      )

      const updatedSeasons = series.seasons.map(season => {
        if (season.seasonNumber === seasonNumber) {
          return { ...season, monitored: false }
        }
        return season
      })

      const updatedSeries = await this.updateSeries(
        series.id,
        { seasons: updatedSeasons },
        operationId,
      )

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
          error: errorMessage(error),
        },
        'Failed to check if season should be unmonitored, assuming should not unmonitor',
      )
      return { seasonUnmonitored: false }
    }
  }

  /**
   * Polls Sonarr until its episode-monitoring state has settled after a bulk
   * unmonitor operation, then decides whether the series should be deleted.
   *
   * Sonarr's state is eventually consistent: a `putApiV3EpisodeMonitor` call
   * may not be reflected immediately in subsequent `getApiV3Episode` responses.
   * Instead of a fixed 5s sleep, we retry with exponential backoff
   * (CONSISTENCY_POLL_BASE_DELAY_MS, 2×, 4×, …) up to
   * CONSISTENCY_POLL_MAX_ATTEMPTS times. As soon as all non-specials report
   * zero monitored episodes we return `true`; if monitored episodes persist
   * after all attempts we return `false` (conservative).
   */
  private async checkIfSeriesShouldBeDeleted(
    seriesId: number,
    operationId: string,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= CONSISTENCY_POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise(resolve =>
        setTimeout(
          resolve,
          CONSISTENCY_POLL_BASE_DELAY_MS * Math.pow(2, attempt - 1),
        ),
      )

      try {
        const series = await this.getSeriesById(seriesId, operationId)
        if (!series) {
          this.logger.warn(
            { id: operationId, seriesId, attempt },
            'Series not found during deletion check',
          )
          return false
        }

        let totalMonitoredEpisodes = 0

        for (const season of series.seasons) {
          if (season.seasonNumber === 0) continue

          try {
            const episodes = await this.getEpisodesWithRetry(
              seriesId,
              season.seasonNumber,
              operationId,
              2,
            )
            totalMonitoredEpisodes += episodes.filter(ep => ep.monitored).length
          } catch (error) {
            this.logger.warn(
              {
                id: operationId,
                seriesId,
                season: season.seasonNumber,
                attempt,
                error: errorMessage(error),
              },
              'Failed to check episodes in season, assuming monitored (conservative approach)',
            )
            return false
          }
        }

        if (totalMonitoredEpisodes === 0) {
          this.logger.log(
            { id: operationId, seriesId, attempt },
            'No monitored episodes remain — series will be deleted',
          )
          return true
        }

        if (attempt < CONSISTENCY_POLL_MAX_ATTEMPTS) {
          this.logger.log(
            {
              id: operationId,
              seriesId,
              totalMonitoredEpisodes,
              attempt,
              maxAttempts: CONSISTENCY_POLL_MAX_ATTEMPTS,
            },
            'Monitored episodes still present, retrying consistency check',
          )
        } else {
          this.logger.log(
            { id: operationId, seriesId, totalMonitoredEpisodes },
            'Monitored episodes remain after all attempts — series will not be deleted',
          )
        }
      } catch (error) {
        this.logger.error(
          { id: operationId, seriesId, attempt, error: errorMessage(error) },
          'Failed to check if series should be deleted, assuming should not delete',
        )
        return false
      }
    }

    return false
  }

  private async deleteEpisodeFilesForEpisodes(
    episodes: EpisodeResource[],
    operationId: string,
  ): Promise<{ deletedFiles: number; failedDeletions: number }> {
    this.logger.log(
      { id: operationId, episodeCount: episodes.length },
      'Deleting episode files for episodes',
    )

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

    for (const episode of episodesWithFiles) {
      if (!episode.episodeFileId) continue

      try {
        await this.deleteEpisodeFile(episode.episodeFileId, operationId)
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
            error: errorMessage(error),
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

  private filterSeriesByQuery(
    series: SonarrSeries[],
    query: string,
  ): SonarrSeries[] {
    const normalizedQuery = query.toLowerCase().trim()

    return series.filter(s => {
      if (s.title.toLowerCase().includes(normalizedQuery)) return true
      if (
        s.alternateTitles?.some(alt =>
          alt.title.toLowerCase().includes(normalizedQuery),
        )
      )
        return true
      if (s.year?.toString().includes(normalizedQuery)) return true
      if (s.network?.toLowerCase().includes(normalizedQuery)) return true
      if (s.genres.some(genre => genre.toLowerCase().includes(normalizedQuery)))
        return true
      if (s.overview?.toLowerCase().includes(normalizedQuery)) return true
      return false
    })
  }

  private transformToLibraryResults(
    series: SonarrSeries[],
  ): LibrarySearchResult[] {
    return series.map(s => ({
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
      id: s.id,
      monitored: s.monitored,
      path: s.path,
      statistics: s.statistics,
      added: s.added,
    }))
  }

  private validateMonitorSeriesOptions(
    options: MonitorSeriesOptions,
  ): MonitorSeriesOptionsInput {
    try {
      return SonarrInputSchemas.monitorSeriesOptions.parse(options)
    } catch (error) {
      this.logger.error(
        { options, error: errorMessage(error) },
        'Invalid monitor series options input',
      )
      throw new Error(
        `Invalid monitor series options: ${error instanceof Error ? error.message : 'Unknown validation error'}`,
      )
    }
  }

  private validateUnmonitorSeriesOptions(
    options: UnmonitorSeriesOptions,
  ): UnmonitorSeriesOptionsInput {
    try {
      return SonarrInputSchemas.unmonitorSeriesOptions.parse(options)
    } catch (error) {
      this.logger.error(
        { options, error: errorMessage(error) },
        'Invalid unmonitor series options input',
      )
      throw new Error(
        `Invalid unmonitor series options: ${error instanceof Error ? error.message : 'Unknown validation error'}`,
      )
    }
  }
}
