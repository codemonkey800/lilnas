import type {
  CommandResourceWritable,
  QueueResource,
  SeriesResource,
  SeriesResourceWritable,
} from '@lilnas/media/sonarr'
import {
  deleteApiV3QueueById,
  deleteApiV3SeriesById,
  getApiV3Qualityprofile,
  getApiV3Queue,
  getApiV3Rootfolder,
  getApiV3Series,
  getApiV3SeriesLookup,
  postApiV3Command,
  postApiV3Series,
} from '@lilnas/media/sonarr'
import {
  type DiscoveryShowResult,
  DownloadType,
  type ShowSearchResult,
} from '@lilnas/utils/download/types'
import { Inject, Injectable, Logger } from '@nestjs/common'

import type { SonarrMediaClient } from 'src/media/clients'
import { SONARR_CLIENT } from 'src/media/clients'
import { checkSdkError, unwrapSdkResult } from 'src/media/sdk-result.util'
import { generateTitleSlug } from 'src/media/title-slug.util'

/**
 * Sonarr's SeriesSearch command accepts seriesId but the generated SDK type
 * omits command-specific body parameters. We extend it locally so TypeScript
 * validates the extra field rather than silently ignoring it via a raw `as`.
 * (Mirrors apps/tdr-bot/src/media/services/sonarr.service.ts.)
 */
type SeriesSearchCommand = CommandResourceWritable & { seriesId?: number }

export interface RequestShowResult {
  overview?: string
  posterUrl?: string
  sonarrId: number
  title: string
}

function toShowSearchResult(series: SeriesResource): ShowSearchResult {
  const posterUrl = series.images?.find(img => img.coverType === 'poster')?.url

  return {
    overview: series.overview ?? undefined,
    posterUrl: posterUrl ?? undefined,
    title: series.title ?? 'Unknown title',
    tvdbId: series.tvdbId ?? 0,
    year: series.year,
  }
}

function releaseYearFromDate(dateStr: string | undefined): number | undefined {
  if (!dateStr) return undefined
  const year = new Date(dateStr).getUTCFullYear()
  return Number.isNaN(year) ? undefined : year
}

/**
 * Fuller mapping than `toShowSearchResult()` above, for the discovery
 * endpoint - kept as a separate function (not a widening of
 * `ShowSearchResult`) so the existing `/shows/search` response bytes, and
 * `apps/tdr-bot`'s existing calls against it, can never regress. Unlike
 * Radarr's movie mapper, Sonarr has exactly one release-date-shaped field
 * (`firstAired`) rather than a four-field lifecycle chain.
 */
function toDiscoveryShowResult(series: SeriesResource): DiscoveryShowResult {
  const posterUrl = series.images?.find(img => img.coverType === 'poster')?.url
  const releaseDate = series.firstAired ?? undefined

  return {
    certification: series.certification ?? undefined,
    genres: series.genres ?? [],
    overview: series.overview ?? undefined,
    posterUrl: posterUrl ?? undefined,
    // Unlike Radarr's per-provider Ratings breakdown, Sonarr's is already a
    // single flat { votes, value } pair.
    ratingValue: series.ratings?.value,
    releaseDate,
    releaseYear: releaseYearFromDate(releaseDate) ?? series.year,
    runtime: series.runtime,
    title: series.title ?? 'Unknown title',
    tvdbId: series.tvdbId ?? 0,
    type: DownloadType.Show,
    year: series.year,
  }
}

@Injectable()
export class SonarrService {
  private logger = new Logger(SonarrService.name)

  constructor(
    @Inject(SONARR_CLIENT) private readonly client: SonarrMediaClient,
  ) {}

  async search(query: string): Promise<ShowSearchResult[]> {
    const series = unwrapSdkResult(
      await getApiV3SeriesLookup({
        client: this.client,
        query: { term: query },
      }),
      'searchShows',
    )

    return series.map(toShowSearchResult)
  }

  /**
   * Same underlying Sonarr lookup call as `search()` above - only the
   * mapper differs, extracting the extra fields discovery's filter/sort
   * need (genres, ratings, firstAired, certification, runtime) that
   * `toShowSearchResult()` discards.
   */
  async searchDetailed(query: string): Promise<DiscoveryShowResult[]> {
    const series = unwrapSdkResult(
      await getApiV3SeriesLookup({
        client: this.client,
        query: { term: query },
      }),
      'searchShowsDetailed',
    )

    return series.map(toDiscoveryShowResult)
  }

  /**
   * Adds (if needed) and triggers a search for a series by TVDB ID.
   * Simplified relative to tdr-bot's monitorAndDownloadSeries: no
   * retry/circuit-breaker wrapper and no granular per-season/episode
   * selection - the whole series is monitored and searched via addOptions.
   */
  async requestShow(tvdbId: number): Promise<RequestShowResult> {
    const existingSeries = unwrapSdkResult(
      await getApiV3Series({ client: this.client }),
      'getSeries',
    )

    let series = existingSeries.find(s => s.tvdbId === tvdbId)

    if (!series) {
      const searchResults = unwrapSdkResult(
        await getApiV3SeriesLookup({
          client: this.client,
          query: { term: `tvdb:${tvdbId}` },
        }),
        'lookupSeriesByTvdbId',
      )

      const lookup = searchResults.find(s => s.tvdbId === tvdbId)
      if (!lookup) {
        throw new Error(`Series with TVDB ID ${tvdbId} not found`)
      }

      const { qualityProfileId, rootFolderPath } =
        await this.getDefaultConfiguration()

      const title = lookup.title ?? `Show ${tvdbId}`

      series = unwrapSdkResult(
        await postApiV3Series({
          client: this.client,
          // Domain fields line up 1:1 with SeriesResourceWritable; addOptions
          // is the only nested writable-only shape, so a targeted cast
          // covers it.
          body: {
            tvdbId,
            title,
            titleSlug: lookup.titleSlug ?? generateTitleSlug(title),
            qualityProfileId,
            rootFolderPath,
            monitored: true,
            seasonFolder: true,
            useSceneNumbering: false,
            seriesType: 'standard',
            addOptions: {
              monitor: 'all',
              searchForMissingEpisodes: true,
              searchForCutoffUnmetEpisodes: true,
            },
          } as unknown as SeriesResourceWritable,
        }),
        'addSeries',
      )
    }

    if (series.id == null) {
      throw new Error(`Sonarr did not return an id for series tvdbId=${tvdbId}`)
    }

    const command: SeriesSearchCommand = {
      name: 'SeriesSearch',
      seriesId: series.id,
    }
    checkSdkError(
      await postApiV3Command({ client: this.client, body: command }),
      'triggerSeriesSearch',
    )

    const posterUrl = series.images?.find(
      img => img.coverType === 'poster',
    )?.remoteUrl

    return {
      overview: series.overview ?? undefined,
      posterUrl: posterUrl ?? undefined,
      sonarrId: series.id,
      title: series.title ?? `Show ${tvdbId}`,
    }
  }

  /**
   * Fetches the current Sonarr queue, optionally scoped to specific series
   * IDs. Used by MediaPollerService (no filter -> all tracked jobs matched
   * client-side) and by unmonitorAndDelete (filtered to one series).
   */
  async getQueue(seriesIds?: number[]): Promise<QueueResource[]> {
    const paging = unwrapSdkResult(
      await getApiV3Queue({
        client: this.client,
        query: {
          includeEpisode: false,
          includeSeries: false,
          pageSize: 1000,
          ...(seriesIds && seriesIds.length > 0 ? { seriesIds } : {}),
        },
      }),
      'getQueue',
    )

    return paging.records ?? []
  }

  /**
   * Cancels any in-progress downloads for the series, then unmonitors and
   * deletes it. Mirrors apps/tdr-bot/src/media/services/sonarr.service.ts's
   * series-equivalent delete operation order (cancel queue items, then
   * delete) without the retry/granular-unmonitoring apparatus.
   */
  async unmonitorAndDelete(
    sonarrId: number,
    deleteFiles = true,
  ): Promise<void> {
    const queueItems = await this.getQueue([sonarrId])

    const cancellations = await Promise.allSettled(
      queueItems
        .filter(item => item.id != null)
        .map(item =>
          deleteApiV3QueueById({
            client: this.client,
            path: { id: item.id as number },
            query: { removeFromClient: true },
          }),
        ),
    )

    for (const result of cancellations) {
      if (result.status === 'rejected') {
        this.logger.warn(
          { sonarrId, error: String(result.reason) },
          'Failed to cancel an in-progress queue item before deleting series',
        )
      }
    }

    checkSdkError(
      await deleteApiV3SeriesById({
        client: this.client,
        path: { id: sonarrId },
        query: { deleteFiles, addImportListExclusion: false },
      }),
      'deleteSeries',
    )
  }

  private async getDefaultConfiguration(): Promise<{
    qualityProfileId: number
    rootFolderPath: string
  }> {
    const [profiles, folders] = await Promise.all([
      unwrapSdkResult(
        await getApiV3Qualityprofile({ client: this.client }),
        'getQualityProfiles',
      ),
      unwrapSdkResult(
        await getApiV3Rootfolder({ client: this.client }),
        'getRootFolders',
      ),
    ])

    const profile =
      profiles.find(p => (p.name ?? '').toLowerCase().includes('any')) ??
      profiles[0]
    if (!profile || profile.id == null) {
      throw new Error('No quality profiles available in Sonarr')
    }

    const folder = folders.find(f => f.accessible) ?? folders[0]
    if (!folder || folder.path == null) {
      throw new Error('No accessible root folders available in Sonarr')
    }

    return { qualityProfileId: profile.id, rootFolderPath: folder.path }
  }
}
