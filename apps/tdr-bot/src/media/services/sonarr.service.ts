import type {
  EpisodeResource as SdkEpisodeResource,
  QueueResource,
  QueueResourcePagingResource,
  SeriesResource,
  SeriesResourceWritable,
} from '@lilnas/media/sonarr'
import {
  deleteApiV3EpisodefileById,
  deleteApiV3QueueBulk,
  deleteApiV3SeriesById,
  getApiV3Episode,
  getApiV3Queue,
  getApiV3Series,
  getApiV3SeriesById,
  getApiV3SeriesLookup,
  putApiV3EpisodeMonitor,
  putApiV3SeriesById,
} from '@lilnas/media/sonarr'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'
import { performance } from 'perf_hooks'

import { RetryConfigService } from 'src/config/retry.config'
import type { SonarrMediaClient } from 'src/media/clients'
import { SONARR_CLIENT } from 'src/media/clients'
import { MediaApiError } from 'src/media/errors/media-api.error'
import {
  SonarrInputSchemas,
  SonarrOutputSchemas,
  UnmonitorSeriesOptionsInput,
} from 'src/media/schemas/sonarr.schemas'
import { BaseMediaService } from 'src/media/services/base-media.service'
import {
  DownloadingSeries,
  EpisodeResource,
  KeptPackDownload,
  LibrarySearchResult,
  SeriesSearchResult,
  SonarrSeries,
  SonarrSeriesUpdate,
  UnmonitorAndDeleteSeriesResult,
  UnmonitoringChange,
  UnmonitorSeriesOptions,
} from 'src/media/types/sonarr.types'
import { errorMessage, numericIdAsString } from 'src/media/utils/media.utils'
import {
  applySeriesUpdate,
  describeKeptPack,
  groupQueueByDownload,
  isPathLikeLookupTerm,
  toDownloadingSeries,
  toEpisodeResourceArray,
  toKeptPackDownload,
  toSonarrSeries,
  toSonarrSeriesArray,
  toSonarrSeriesResourceArray,
  transformToSearchResults,
} from 'src/media/utils/sonarr.utils'
import { RetryConfig, RetryService } from 'src/utils/retry.service'

/**
 * Outcome of canceling the queue downloads that cover a set of episodes.
 * `commandIds` are the queue ids sent to Sonarr's bulk delete (one per
 * download).
 */
interface CancelDownloadsResult {
  canceled: number
  commandIds: number[]
  keptPacks: KeptPackDownload[]
}

const noDownloadsCanceled = (
  keptPacks: KeptPackDownload[] = [],
): CancelDownloadsResult => ({ canceled: 0, commandIds: [], keptPacks })

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
   *
   * Sonarr v5 answers a path-like term (see `isPathLikeLookupTerm`) with a 400
   * instead of an empty list. No series can match such a term, so it comes
   * back as no results without the round trip - and without logging the term,
   * which is user input.
   */
  async searchShows(query: string): Promise<SeriesSearchResult[]> {
    const id = nanoid()

    const validatedInput = this.validateSearchQuery(
      { query },
      SonarrInputSchemas.searchQuery,
    )
    const normalizedQuery = validatedInput.query

    if (isPathLikeLookupTerm(normalizedQuery)) {
      this.logger.log(
        { id },
        'Search term reads as a path - returning no results',
      )
      return []
    }

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

      // One entry per download: a season pack is N queue rows (one per
      // episode) that each carry the whole pack's size.
      const downloadingEpisodes = groupQueueByDownload(downloadingItems).map(
        group => toDownloadingSeries(group),
      )

      const duration = performance.now() - start

      const validatedDownloads =
        SonarrOutputSchemas.downloadingSeriesArray.parse(downloadingEpisodes)

      this.logger.log(
        {
          id,
          totalQueueItems: allQueueItems.length,
          downloadingRows: downloadingItems.length,
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
        toSonarrSeriesResourceArray(rawSeries, this.logger),
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

      // A lookup 400 is a term Sonarr rejected (v5's
      // `InvalidSearchTermException`) that the path guard in `searchShows()`
      // doesn't know about - no series matches it either. The term stays out
      // of this log line
      if (error instanceof MediaApiError && error.response.status === 400) {
        this.logger.warn(
          { id: operationId, status: error.response.status, duration },
          'Sonarr rejected the lookup term - returning no results',
        )
        return []
      }

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
        this.logger,
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
      this.logger,
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

  /**
   * Round-trips the raw SDK series: GET it, change only the requested fields,
   * PUT it back. Sonarr's PUT replaces the whole series, so sending the bot's
   * parsed `SonarrSeries` would drop every field its schema doesn't model
   * (e.g. `monitorNewItems`) and silently reset them to Sonarr's defaults.
   */
  private async updateSeries(
    seriesId: number,
    updates: SonarrSeriesUpdate,
    operationId: string,
  ): Promise<SonarrSeries> {
    const raw = await this.executeWithRetry<SeriesResource | undefined>(
      () =>
        getApiV3SeriesById({
          client: this.client,
          path: { id: seriesId },
        }),
      `${this.serviceName}-getSeriesForUpdate-${operationId}`,
    )
    if (raw == null) {
      throw new Error(`Sonarr returned no series ${seriesId} to update`)
    }

    const body: SeriesResourceWritable = {
      ...applySeriesUpdate(raw, updates),
      id: seriesId,
    }

    return toSonarrSeries(
      await this.executeWithRetry<SeriesResource>(
        () =>
          putApiV3SeriesById({
            client: this.client,
            path: { id: numericIdAsString(seriesId) },
            body,
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
      this.logger,
    )
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

  private async getQueue(operationId: string): Promise<QueueResource[]> {
    const response = await this.executeWithRetry<QueueResourcePagingResource>(
      () =>
        getApiV3Queue({
          client: this.client,
          // Episode numbers label kept packs ("S01E01–E10")
          query: { pageSize: 1000, includeEpisode: true },
        }),
      `${this.serviceName}-getQueue-${operationId}`,
    )

    return response.records ?? []
  }

  /**
   * Removes queue items in one bulk call. Pass one queue id per download:
   * Sonarr removes the whole tracked download for any of its rows.
   */
  private async removeQueueItems(
    queueIds: number[],
    operationId: string,
  ): Promise<void> {
    await this.executeWithRetry(
      () =>
        deleteApiV3QueueBulk({
          client: this.client,
          body: { ids: queueIds },
          query: { removeFromClient: true, blocklist: false },
        }),
      `${this.serviceName}-removeQueueItems-${operationId}`,
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

  private async cancelDownloadsForSeries(
    seriesId: number,
    operationId: string,
  ): Promise<CancelDownloadsResult> {
    return this.cancelQueueDownloads(
      row => row.seriesId === seriesId,
      operationId,
      { seriesId },
    )
  }

  private async cancelDownloadsForEpisodes(
    episodeIds: number[],
    operationId: string,
  ): Promise<CancelDownloadsResult> {
    const requested = new Set(episodeIds)
    return this.cancelQueueDownloads(
      row => row.episodeId != null && requested.has(row.episodeId),
      operationId,
      { episodeCount: episodeIds.length },
    )
  }

  /**
   * Cancels the downloads whose queue rows are all being removed.
   *
   * Sonarr lists one queue row per episode, and deleting any row removes the
   * whole tracked download from the client. So rows are grouped by
   * `downloadId`, a download is canceled only when every episode it covers is
   * requested, and a pack that also covers other episodes is kept and
   * reported. Rows without a `downloadId` (pending releases) stand alone.
   */
  private async cancelQueueDownloads(
    isRequested: (row: QueueResource) => boolean,
    operationId: string,
    logContext: Record<string, unknown>,
  ): Promise<CancelDownloadsResult> {
    this.logger.log({ id: operationId, ...logContext }, 'Canceling downloads')

    let queue: QueueResource[]
    try {
      queue = await this.getQueue(operationId)
    } catch (error) {
      this.logger.error(
        { id: operationId, ...logContext, error: errorMessage(error) },
        'Failed to get queue for download cancellation',
      )
      return noDownloadsCanceled()
    }

    const touched = groupQueueByDownload(queue).filter(group =>
      group.rows.some(isRequested),
    )

    if (touched.length === 0) {
      this.logger.log({ id: operationId, ...logContext }, 'No downloads found')
      return noDownloadsCanceled()
    }

    const queueIds: number[] = []
    const keptPacks: KeptPackDownload[] = []

    for (const group of touched) {
      if (group.rows.every(isRequested)) {
        const queueId = group.rows.find(row => row.id != null)?.id
        if (queueId != null) queueIds.push(queueId)
      } else if (group.downloadId != null) {
        keptPacks.push(
          toKeptPackDownload(
            { ...group, downloadId: group.downloadId },
            isRequested,
          ),
        )
      }
    }

    if (keptPacks.length > 0) {
      this.logger.log(
        { id: operationId, ...logContext, keptPacks },
        'Keeping pack downloads that also cover episodes not being removed',
      )
    }

    if (queueIds.length === 0) {
      return noDownloadsCanceled(keptPacks)
    }

    try {
      await this.removeQueueItems(queueIds, operationId)
    } catch (error) {
      this.logger.warn(
        {
          id: operationId,
          ...logContext,
          queueIds,
          error: errorMessage(error),
        },
        'Failed to cancel downloads',
      )
      return noDownloadsCanceled(keptPacks)
    }

    this.logger.log(
      {
        id: operationId,
        ...logContext,
        canceled: queueIds.length,
        queueIds,
        kept: keptPacks.length,
      },
      'Finished canceling downloads',
    )

    return { canceled: queueIds.length, commandIds: queueIds, keptPacks }
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
        ...keptPacksFields(downloadResult.keptPacks),
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
    let allKeptPacks: KeptPackDownload[] = []
    const allRequestedEpisodeIds: number[] = []
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
        allKeptPacks.push(...episodeChanges.keptPacks)
        allRequestedEpisodeIds.push(...episodeChanges.requestedEpisodeIds)

        if (episodeChanges.updatedSeries) {
          currentSeries = episodeChanges.updatedSeries
        }
      }

      // Each selection judged packs on its own episodes. A pack spanning
      // several selections (an S01–S02 pack for "seasons 1 and 2") is only
      // fully requested across all of them, so judge kept packs once more
      // against the whole request.
      if (allKeptPacks.length > 0 && options.selection!.length > 1) {
        const recheck = await this.cancelDownloadsForEpisodes(
          allRequestedEpisodeIds,
          operationId,
        )
        totalCanceledDownloads += recheck.canceled
        allCommandIds.push(...recheck.commandIds)
        allKeptPacks = recheck.keptPacks
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

        // The series is going away, so every episode is now being removed:
        // cancel what is left, including packs kept above.
        const remaining = await this.cancelDownloadsForSeries(
          series.id,
          operationId,
        )
        totalCanceledDownloads += remaining.canceled
        allCommandIds.push(...remaining.commandIds)
        allKeptPacks = remaining.keptPacks

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
        ...keptPacksFields(allKeptPacks),
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
    keptPacks: KeptPackDownload[]
    requestedEpisodeIds: number[]
    updatedSeries?: SonarrSeries
  }> {
    const changes: UnmonitoringChange[] = []
    let canceledDownloads = 0
    const commandIds: number[] = []
    const keptPacks: KeptPackDownload[] = []
    const requestedEpisodeIds: number[] = []
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
        return {
          changes,
          canceledDownloads,
          commandIds,
          keptPacks,
          requestedEpisodeIds,
        }
      }

      if (!selection.episodes || selection.episodes.length === 0) {
        this.logger.log(
          { id: operationId, season: selection.season },
          'Unmonitoring entire season',
        )

        const allEpisodeIds = episodes.map(ep => ep.id)
        requestedEpisodeIds.push(...allEpisodeIds)
        if (allEpisodeIds.length > 0) {
          const downloadResult = await this.cancelDownloadsForEpisodes(
            allEpisodeIds,
            operationId,
          )
          canceledDownloads += downloadResult.canceled
          commandIds.push(...downloadResult.commandIds)
          keptPacks.push(...downloadResult.keptPacks)

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

        requestedEpisodeIds.push(...selectedEpisodeIds)
        if (selectedEpisodeIds.length > 0) {
          const downloadResult = await this.cancelDownloadsForEpisodes(
            selectedEpisodeIds,
            operationId,
          )
          canceledDownloads += downloadResult.canceled
          commandIds.push(...downloadResult.commandIds)
          keptPacks.push(...downloadResult.keptPacks)

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
        keptPacks,
        requestedEpisodeIds,
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
   * Decides whether the series should be deleted after a bulk unmonitor: true
   * when no non-special episode is still monitored.
   *
   * No waiting is needed: `PUT /episode/monitor` updates the episodes before
   * it responds, so this read already sees the change. Errors are
   * conservative — any failure to read the state means "don't delete".
   */
  private async checkIfSeriesShouldBeDeleted(
    seriesId: number,
    operationId: string,
  ): Promise<boolean> {
    try {
      const series = await this.getSeriesById(seriesId, operationId)
      if (!series) {
        this.logger.warn(
          { id: operationId, seriesId },
          'Series not found during deletion check',
        )
        return false
      }

      let totalMonitoredEpisodes = 0

      for (const season of series.seasons) {
        if (season.seasonNumber === 0) continue

        try {
          const episodes = await this.getEpisodes(
            seriesId,
            season.seasonNumber,
            operationId,
          )
          totalMonitoredEpisodes += episodes.filter(ep => ep.monitored).length
        } catch (error) {
          this.logger.warn(
            {
              id: operationId,
              seriesId,
              season: season.seasonNumber,
              error: errorMessage(error),
            },
            'Failed to check episodes in season, assuming monitored (conservative approach)',
          )
          return false
        }
      }

      if (totalMonitoredEpisodes === 0) {
        this.logger.log(
          { id: operationId, seriesId },
          'No monitored episodes remain — series will be deleted',
        )
        return true
      }

      this.logger.log(
        { id: operationId, seriesId, totalMonitoredEpisodes },
        'Monitored episodes remain — series will not be deleted',
      )
      return false
    } catch (error) {
      this.logger.error(
        { id: operationId, seriesId, error: errorMessage(error) },
        'Failed to check if series should be deleted, assuming should not delete',
      )
      return false
    }
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
      rating: s.ratings.votes ? s.ratings.value : undefined,
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

/**
 * Result fields reporting packs kept during a partial cancel; empty when none
 * were kept so the result shape is unchanged for the common case.
 */
function keptPacksFields(
  keptPacks: KeptPackDownload[],
): Pick<UnmonitorAndDeleteSeriesResult, 'keptPacks' | 'warnings'> {
  if (keptPacks.length === 0) return {}
  return { keptPacks, warnings: keptPacks.map(describeKeptPack) }
}
