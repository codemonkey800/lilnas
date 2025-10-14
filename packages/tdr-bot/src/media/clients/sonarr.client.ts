import { env } from '@lilnas/utils/env'
import { Injectable } from '@nestjs/common'

import { RetryConfigService } from 'src/config/retry.config'
import {
  AddSeriesRequest,
  BulkEpisodeUpdateRequest,
  DeleteSeriesRequest,
  EpisodeFileResource,
  EpisodeResource,
  GetEpisodeFilesRequest,
  SonarrCommandResponse,
  SonarrQualityProfile,
  SonarrQueueItem,
  SonarrRootFolder,
  SonarrSeries,
  SonarrSeriesResource,
  SonarrSystemStatus,
  UpdateEpisodeRequest,
} from 'src/media/types/sonarr.types'
import { EnvKey } from 'src/utils/env'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

import { BaseMediaApiClient } from './base-media-api.client'

@Injectable()
export class SonarrClient extends BaseMediaApiClient {
  protected readonly serviceName = 'Sonarr'
  protected readonly baseUrl: string
  protected readonly apiKey: string
  protected readonly circuitBreakerKey = 'sonarr-api'

  constructor(
    protected override readonly retryService: RetryService,
    protected override readonly errorClassifier: ErrorClassificationService,
    private readonly retryConfigService: RetryConfigService,
  ) {
    super(retryService, errorClassifier)

    this.baseUrl = env<EnvKey>('SONARR_URL')
    this.apiKey = env<EnvKey>('SONARR_API_KEY')

    // Ensure baseUrl ends with /api/v3
    if (!this.baseUrl.endsWith('/api/v3')) {
      this.baseUrl = this.baseUrl.replace(/\/$/, '') + '/api/v3'
    }
  }

  /**
   * Get retry configuration for Sonarr API calls
   */
  protected getRetryConfig() {
    return this.retryConfigService.getSonarrConfig()
  }

  /**
   * Search for TV series by title
   * This is the main public function as requested - simple search by query string
   * Returns raw series objects from Sonarr API
   */
  async searchSeries(query: string): Promise<SonarrSeriesResource[]> {
    if (!query || query.trim().length === 0) {
      throw new Error('Search query is required')
    }

    if (query.trim().length < 2) {
      throw new Error('Search query must be at least 2 characters')
    }

    const trimmedQuery = query.trim()
    const searchParams = new URLSearchParams({ term: trimmedQuery })

    this.logger.log({ query: trimmedQuery }, 'Searching series via Sonarr API')

    try {
      // Use the series lookup endpoint as documented
      const series = await this.get<SonarrSeriesResource[]>(
        `/series/lookup?${searchParams}`,
      )

      this.logger.log(
        { query: trimmedQuery, resultCount: series.length },
        'Series search completed successfully',
      )

      return series
    } catch (error) {
      this.logger.error(
        {
          query: trimmedQuery,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to search series',
      )
      throw error
    }
  }

  /**
   * Get system status for health check
   */
  async getSystemStatus(): Promise<SonarrSystemStatus> {
    this.logger.log('Getting Sonarr system status')

    try {
      const status = await this.get<SonarrSystemStatus>('/system/status')

      this.logger.log(
        { version: status.version, status: 'healthy' },
        'Sonarr system status retrieved successfully',
      )

      return status
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get system status',
      )
      throw error
    }
  }

  /**
   * Health check implementation
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.getSystemStatus()
      return true
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Sonarr health check failed',
      )
      return false
    }
  }

  /**
   * Get quality profiles from Sonarr
   */
  async getQualityProfiles(): Promise<SonarrQualityProfile[]> {
    this.logger.log('Getting Sonarr quality profiles')

    try {
      const profiles = await this.get<SonarrQualityProfile[]>('/qualityprofile')

      this.logger.log(
        { profileCount: profiles.length },
        'Quality profiles retrieved successfully',
      )

      return profiles
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get quality profiles',
      )
      throw error
    }
  }

  /**
   * Get root folders from Sonarr
   */
  async getRootFolders(): Promise<SonarrRootFolder[]> {
    this.logger.log('Getting Sonarr root folders')

    try {
      const folders = await this.get<SonarrRootFolder[]>('/rootfolder')

      this.logger.log(
        { folderCount: folders.length },
        'Root folders retrieved successfully',
      )

      return folders
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get root folders',
      )
      throw error
    }
  }

  /**
   * Add a series to Sonarr
   */
  async addSeries(request: AddSeriesRequest): Promise<SonarrSeries> {
    this.logger.log(
      { tvdbId: request.tvdbId, title: request.title },
      'Adding series to Sonarr',
    )

    try {
      const series = await this.post<SonarrSeries>('/series', request)

      this.logger.log(
        { seriesId: series.id, title: series.title },
        'Series added successfully',
      )

      return series
    } catch (error) {
      this.logger.error(
        {
          tvdbId: request.tvdbId,
          title: request.title,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to add series',
      )
      throw error
    }
  }

  /**
   * Update an existing series in Sonarr
   */
  async updateSeries(
    seriesId: number,
    updates: Partial<SonarrSeries>,
  ): Promise<SonarrSeries> {
    this.logger.log({ seriesId }, 'Updating series in Sonarr')

    try {
      // First fetch the complete existing series data
      const existingSeries = await this.getSeriesById(seriesId)
      if (!existingSeries) {
        throw new Error(`Series with ID ${seriesId} not found`)
      }

      // Merge updates with existing complete series data
      const completeSeriesData = {
        ...existingSeries,
        ...updates,
        id: seriesId, // Ensure ID is preserved
      }

      const series = await this.put<SonarrSeries>(
        `/series/${seriesId}`,
        completeSeriesData,
      )

      this.logger.log(
        { seriesId, title: series.title },
        'Series updated successfully',
      )

      return series
    } catch (error) {
      this.logger.error(
        {
          seriesId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to update series',
      )
      throw error
    }
  }

  /**
   * Get episodes for a series or specific season
   */
  async getEpisodes(
    seriesId: number,
    seasonNumber?: number,
  ): Promise<EpisodeResource[]> {
    const params = new URLSearchParams({ seriesId: seriesId.toString() })
    if (seasonNumber !== undefined) {
      params.append('seasonNumber', seasonNumber.toString())
    }

    this.logger.log({ seriesId, seasonNumber }, 'Getting episodes from Sonarr')

    try {
      const episodes = await this.get<EpisodeResource[]>(`/episode?${params}`)

      this.logger.log(
        { seriesId, seasonNumber, episodeCount: episodes.length },
        'Episodes retrieved successfully',
      )

      return episodes
    } catch (error) {
      this.logger.error(
        {
          seriesId,
          seasonNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get episodes',
      )
      throw error
    }
  }

  /**
   * Get a single episode by its ID
   */
  async getEpisodeById(episodeId: number): Promise<EpisodeResource | null> {
    this.logger.log({ episodeId }, 'Getting episode by ID from Sonarr')

    try {
      const episode = await this.get<EpisodeResource>(`/episode/${episodeId}`)

      this.logger.log(
        { episodeId, title: episode.title },
        'Episode retrieved successfully',
      )

      return episode
    } catch (error) {
      this.logger.error(
        {
          episodeId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get episode by ID',
      )
      return null
    }
  }

  /**
   * Update a single episode's monitoring status
   */
  async updateEpisode(
    episodeId: number,
    updates: UpdateEpisodeRequest,
  ): Promise<EpisodeResource> {
    this.logger.log(
      { episodeId, monitored: updates.monitored },
      'Updating episode',
    )

    try {
      const episode = await this.put<EpisodeResource>(`/episode/${episodeId}`, {
        id: episodeId,
        ...updates,
      })

      this.logger.log(
        { episodeId, monitored: episode.monitored },
        'Episode updated successfully',
      )

      return episode
    } catch (error) {
      this.logger.error(
        {
          episodeId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to update episode',
      )
      throw error
    }
  }

  /**
   * Update multiple episodes' monitoring status in bulk
   */
  async updateEpisodeBulk(request: BulkEpisodeUpdateRequest): Promise<void> {
    this.logger.log(
      { episodeCount: request.episodeIds.length, monitored: request.monitored },
      'Bulk updating episodes',
    )

    try {
      await this.put('/episode/bulk', request)

      this.logger.log(
        {
          episodeCount: request.episodeIds.length,
          monitored: request.monitored,
        },
        'Episodes bulk updated successfully',
      )
    } catch (error) {
      this.logger.error(
        {
          episodeCount: request.episodeIds.length,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to bulk update episodes',
      )
      throw error
    }
  }

  /**
   * Update multiple episodes' monitoring status using the monitor endpoint
   */
  async updateEpisodesMonitoring(
    request: BulkEpisodeUpdateRequest,
  ): Promise<void> {
    this.logger.log(
      { episodeCount: request.episodeIds.length, monitored: request.monitored },
      'Bulk updating episode monitoring',
    )

    try {
      await this.put('/episode/monitor', request)

      this.logger.log(
        {
          episodeCount: request.episodeIds.length,
          monitored: request.monitored,
        },
        'Episode monitoring bulk updated successfully',
      )
    } catch (error) {
      this.logger.error(
        {
          episodeCount: request.episodeIds.length,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to bulk update episode monitoring',
      )
      throw error
    }
  }

  /**
   * Trigger a search for a series
   */
  async triggerSeriesSearch(seriesId: number): Promise<SonarrCommandResponse> {
    this.logger.log({ seriesId }, 'Triggering series search')

    try {
      const command = await this.post<SonarrCommandResponse>('/command', {
        name: 'SeriesSearch',
        seriesId,
      })

      this.logger.log(
        { seriesId, commandId: command.id },
        'Series search triggered successfully',
      )

      return command
    } catch (error) {
      this.logger.error(
        {
          seriesId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to trigger series search',
      )
      throw error
    }
  }

  /**
   * Get all series in Sonarr library
   */
  async getLibrarySeries(): Promise<SonarrSeries[]> {
    this.logger.log('Getting all series from Sonarr library')

    try {
      const allSeries = await this.get<SonarrSeries[]>('/series')

      this.logger.log(
        { seriesCount: allSeries.length },
        'Successfully retrieved all library series',
      )

      return allSeries
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get library series',
      )
      throw error
    }
  }

  /**
   * Check if a series exists in Sonarr library by TVDB ID
   */
  async getSeriesByTvdbId(tvdbId: number): Promise<SonarrSeries | null> {
    this.logger.log({ tvdbId }, 'Checking if series exists in Sonarr')

    try {
      const allSeries = await this.getLibrarySeries()
      const existingSeries = allSeries.find(series => series.tvdbId === tvdbId)

      this.logger.log(
        { tvdbId, found: !!existingSeries },
        existingSeries
          ? 'Series found in library'
          : 'Series not found in library',
      )

      return existingSeries || null
    } catch (error) {
      this.logger.error(
        {
          tvdbId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to check if series exists',
      )
      throw error
    }
  }

  /**
   * Get a series by internal Sonarr ID
   */
  async getSeriesById(seriesId: number): Promise<SonarrSeries | null> {
    this.logger.log({ seriesId }, 'Getting series by ID from Sonarr')

    try {
      const series = await this.get<SonarrSeries>(`/series/${seriesId}`)

      this.logger.log(
        { seriesId, title: series.title },
        'Series retrieved successfully',
      )

      return series
    } catch (error) {
      this.logger.error(
        {
          seriesId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get series by ID',
      )
      return null
    }
  }

  /**
   * Get current download queue from Sonarr
   */
  async getQueue(): Promise<SonarrQueueItem[]> {
    this.logger.log('Getting Sonarr download queue')

    try {
      const queueResponse = await this.get<{ records: SonarrQueueItem[] }>(
        '/queue',
      )
      const queue = queueResponse.records || []

      this.logger.log(
        { queueCount: queue.length },
        'Queue retrieved successfully',
      )

      return queue
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get queue',
      )
      throw error
    }
  }

  /**
   * Remove a queue item by its ID (for canceling downloads)
   */
  async removeQueueItem(queueId: number): Promise<void> {
    this.logger.log({ queueId }, 'Removing queue item')

    try {
      await this.delete(`/queue/${queueId}`)

      this.logger.log({ queueId }, 'Queue item removed successfully')
    } catch (error) {
      this.logger.error(
        {
          queueId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to remove queue item',
      )
      throw error
    }
  }

  /**
   * Delete a series from Sonarr completely
   */
  async deleteSeries(
    seriesId: number,
    options: DeleteSeriesRequest = {},
  ): Promise<void> {
    this.logger.log(
      {
        seriesId,
        deleteFiles: options.deleteFiles,
        addImportListExclusion: options.addImportListExclusion,
      },
      'Deleting series from Sonarr',
    )

    try {
      const params = new URLSearchParams()
      if (options.deleteFiles !== undefined) {
        params.append('deleteFiles', options.deleteFiles.toString())
      }
      if (options.addImportListExclusion !== undefined) {
        params.append(
          'addImportListExclusion',
          options.addImportListExclusion.toString(),
        )
      }

      const url = params.toString()
        ? `/series/${seriesId}?${params.toString()}`
        : `/series/${seriesId}`

      await this.delete(url)

      this.logger.log({ seriesId }, 'Series deleted successfully')
    } catch (error) {
      this.logger.error(
        {
          seriesId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to delete series',
      )
      throw error
    }
  }

  /**
   * Get episode files for a series or specific episodes
   */
  async getEpisodeFiles(
    options: GetEpisodeFilesRequest = {},
  ): Promise<EpisodeFileResource[]> {
    const params = new URLSearchParams()

    if (options.seriesId !== undefined) {
      params.append('seriesId', options.seriesId.toString())
    }

    if (options.episodeFileIds && options.episodeFileIds.length > 0) {
      options.episodeFileIds.forEach(id => {
        params.append('episodeFileIds', id.toString())
      })
    }

    this.logger.log(
      {
        seriesId: options.seriesId,
        episodeFileIds: options.episodeFileIds,
        seasonNumber: options.seasonNumber,
      },
      'Getting episode files from Sonarr',
    )

    try {
      const url = params.toString() ? `/episodefile?${params}` : '/episodefile'
      const episodeFiles = await this.get<EpisodeFileResource[]>(url)

      // Filter by season if specified
      const filteredFiles =
        options.seasonNumber !== undefined
          ? episodeFiles.filter(
              file => file.seasonNumber === options.seasonNumber,
            )
          : episodeFiles

      this.logger.log(
        {
          seriesId: options.seriesId,
          seasonNumber: options.seasonNumber,
          episodeFileCount: filteredFiles.length,
        },
        'Episode files retrieved successfully',
      )

      return filteredFiles
    } catch (error) {
      this.logger.error(
        {
          seriesId: options.seriesId,
          seasonNumber: options.seasonNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get episode files',
      )
      throw error
    }
  }

  /**
   * Delete an episode file by ID
   */
  async deleteEpisodeFile(episodeFileId: number): Promise<void> {
    this.logger.log({ episodeFileId }, 'Deleting episode file from Sonarr')

    try {
      await this.delete(`/episodefile/${episodeFileId}`)

      this.logger.log({ episodeFileId }, 'Episode file deleted successfully')
    } catch (error) {
      this.logger.error(
        {
          episodeFileId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to delete episode file',
      )
      throw error
    }
  }
}
