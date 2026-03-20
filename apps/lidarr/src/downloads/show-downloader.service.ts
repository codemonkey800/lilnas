import { type MediaCover } from '@lilnas/media/radarr-next'
import {
  deleteApiV3QueueBulk,
  deleteApiV3QueueById as sonarrDeleteQueueById,
  type EpisodeResource,
  getApiV3Episode,
  getApiV3EpisodeById,
  getApiV3QueueDetails,
  getApiV3Series,
  getApiV3SeriesById,
  getApiV3SeriesLookup,
  postApiV3Command as sonarrPostCommand,
  putApiV3EpisodeById,
  putApiV3EpisodeMonitor,
  putApiV3SeriesById,
  type QueueResource as SonarrQueueResource,
  type SeriesResource,
} from '@lilnas/media/sonarr'
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'

import { cached } from 'src/media/cache'
import { SONARR_CLIENT, type SonarrMediaClient } from 'src/media/clients'

import { DownloadStateService } from './download-state.service'
import {
  computeDownloadState,
  createTrackedEpisode,
  DownloadEvents,
  type DownloadShowRequest,
  type EpisodeDownloadItem,
  type EpisodeDownloadStatusItem,
  type SeasonDownloadGroup,
  type ShowDownloadItem,
  type ShowDownloadStatusResponse,
  type TrackedEpisodeDownload,
} from './downloads.types'

function getPosterUrl(images?: Array<MediaCover> | null): string | null {
  const poster = images?.find(img => img.coverType === 'poster')
  return poster?.remoteUrl ?? poster?.url ?? null
}

/**
 * Handles all show-specific download, cancel, and status operations.
 */
@Injectable()
export class ShowDownloaderService {
  private readonly logger = new Logger(ShowDownloaderService.name)

  constructor(
    @Inject(SONARR_CLIENT) private readonly sonarr: SonarrMediaClient,
    private readonly state: DownloadStateService,
  ) {}

  async requestDownload(req: DownloadShowRequest): Promise<void> {
    const lookupResult = await getApiV3SeriesLookup({
      client: this.sonarr,
      query: { term: `tvdb:${req.tvdbId}` },
    })
    const series = ((lookupResult.data ?? []) as SeriesResource[])[0]

    if (!series?.id) {
      throw new NotFoundException(
        `Show with tvdbId ${req.tvdbId} not found in Sonarr library`,
      )
    }

    if (req.scope === 'episode') {
      await this.downloadEpisode(req.tvdbId, series.id, req.episodeId)
    } else {
      await this.downloadEpisodes(
        req.tvdbId,
        series.id,
        req.scope,
        req.scope === 'season' ? req.seasonNumber : undefined,
      )
    }
  }

  async cancelShowDownloads(
    tvdbId: number,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    const seriesId = await this.resolveSeriesId(tvdbId)
    const episodeKeys = this.collectTrackedEpisodes(
      entry => entry.tvdbId === tvdbId,
    )
    return this.cancelTrackedEpisodes(tvdbId, seriesId, episodeKeys, {
      filterQueueByTracked: false,
    })
  }

  async cancelSeasonDownloads(
    tvdbId: number,
    seasonNumber: number,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    const seriesId = await this.resolveSeriesId(tvdbId)
    const episodeKeys = this.collectTrackedEpisodes(
      entry => entry.tvdbId === tvdbId && entry.seasonNumber === seasonNumber,
    )
    return this.cancelTrackedEpisodes(tvdbId, seriesId, episodeKeys, {
      filterQueueByTracked: true,
    })
  }

  async cancelEpisodeDownload(episodeId: number): Promise<void> {
    const key = `episode:${episodeId}`
    const entry = this.state.getTracked().get(key)
    const tvdbId = entry?.kind === 'episode' ? entry.tvdbId : undefined

    let queueId = entry?.kind === 'episode' ? entry.queueId : null

    if (queueId == null) {
      try {
        const queueResult = await getApiV3QueueDetails({ client: this.sonarr })
        const items = (queueResult.data ?? []) as SonarrQueueResource[]
        const queueItem = items.find(q => q.episodeId === episodeId)
        queueId = queueItem?.id ?? null
      } catch {
        // Ignore lookup failure
      }
    }

    if (queueId != null) {
      await Promise.all([
        sonarrDeleteQueueById({
          client: this.sonarr,
          path: { id: queueId },
          query: { removeFromClient: true, blocklist: false },
        }),
        putApiV3EpisodeMonitor({
          client: this.sonarr,
          body: { episodeIds: [episodeId], monitored: false },
        }),
      ]).catch(err =>
        this.logger.warn(
          `cancelEpisodeDownload cleanup failed episodeId=${episodeId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
    } else {
      await putApiV3EpisodeMonitor({
        client: this.sonarr,
        body: { episodeIds: [episodeId], monitored: false },
      }).catch(err =>
        this.logger.warn(
          `cancelEpisodeDownload unmonitor failed episodeId=${episodeId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
    }

    this.state.removeTracked(key)
    this.state.emitEvent({
      event: DownloadEvents.CANCELLED,
      mediaType: 'episode',
      tvdbId,
      episodeId,
    })
    this.logger.log(`Episode download cancelled episodeId=${episodeId}`)
  }

  getShowStatus(tvdbId: number): ShowDownloadStatusResponse {
    const items: EpisodeDownloadStatusItem[] = []
    for (const entry of this.state.getTracked().values()) {
      if (entry.kind !== 'episode' || entry.tvdbId !== tvdbId) continue
      items.push({
        episodeId: entry.sonarrEpisodeId,
        state: computeDownloadState(entry),
        title: entry.lastTitle,
        size: entry.lastSize ?? 0,
        sizeleft: entry.lastSizeleft ?? 0,
        progress: entry.lastProgress ?? 0,
        eta: entry.lastEta,
        status: entry.lastStatus,
      })
    }
    return items
  }

  async buildShowDownloadItems(
    entries: TrackedEpisodeDownload[],
  ): Promise<ShowDownloadItem[]> {
    if (entries.length === 0) return []

    const byShow = new Map<
      number,
      { seriesId: number; episodes: TrackedEpisodeDownload[] }
    >()
    for (const entry of entries) {
      const existing = byShow.get(entry.tvdbId)
      if (existing) {
        existing.episodes.push(entry)
      } else {
        byShow.set(entry.tvdbId, {
          seriesId: entry.sonarrSeriesId,
          episodes: [entry],
        })
      }
    }

    let allSeries: SeriesResource[] = []
    try {
      allSeries = await cached('sonarr:series', 60_000, () =>
        getApiV3Series({ client: this.sonarr }).then(
          r => (r.data ?? []) as SeriesResource[],
        ),
      )
    } catch (err) {
      this.logger.warn(
        'Failed to fetch Sonarr series for download list',
        err instanceof Error ? err.message : String(err),
      )
    }
    const seriesById = new Map<number, SeriesResource>()
    for (const s of allSeries) {
      if (s.id != null) seriesById.set(s.id, s)
    }

    const showItems = await Promise.all(
      Array.from(byShow.entries()).map(
        async ([tvdbId, { seriesId, episodes }]) => {
          let title = 'Unknown'
          let year = 0
          let posterUrl: string | null = null

          const series = seriesById.get(seriesId)
          if (series) {
            title = series.title ?? 'Unknown'
            year = series.year ?? 0
            posterUrl =
              getPosterUrl(
                series.images as Array<MediaCover> | null | undefined,
              ) ?? null
          }

          const bySeason = new Map<number, EpisodeDownloadItem[]>()
          for (const ep of episodes) {
            const item: EpisodeDownloadItem = {
              episodeId: ep.sonarrEpisodeId,
              seasonNumber: ep.seasonNumber,
              episodeNumber: ep.episodeNumber,
              state: computeDownloadState(ep),
              releaseTitle: ep.lastTitle,
              size: ep.lastSize ?? 0,
              sizeleft: ep.lastSizeleft ?? 0,
              progress: ep.lastProgress ?? 0,
              eta: ep.lastEta,
              status: ep.lastStatus,
            }

            const existing = bySeason.get(ep.seasonNumber)
            if (existing) {
              existing.push(item)
            } else {
              bySeason.set(ep.seasonNumber, [item])
            }
          }

          const seasons: SeasonDownloadGroup[] = Array.from(bySeason.entries())
            .sort(([a], [b]) => a - b)
            .map(([sn, eps]) => ({
              seasonNumber: sn,
              episodes: eps.sort((a, b) => a.episodeNumber - b.episodeNumber),
            }))

          return {
            tvdbId,
            seriesId,
            title,
            year,
            posterUrl,
            seasons,
          } satisfies ShowDownloadItem
        },
      ),
    )

    return showItems
  }

  private async resolveSeriesId(tvdbId: number): Promise<number> {
    const lookupResult = await getApiV3SeriesLookup({
      client: this.sonarr,
      query: { term: `tvdb:${tvdbId}` },
    })
    const series = ((lookupResult.data ?? []) as SeriesResource[])[0]
    if (!series?.id) {
      throw new NotFoundException(
        `Show with tvdbId ${tvdbId} not found in Sonarr library`,
      )
    }
    return series.id
  }

  private async downloadEpisode(
    tvdbId: number,
    seriesId: number,
    episodeId: number,
  ): Promise<void> {
    const epResult = await getApiV3EpisodeById({
      client: this.sonarr,
      path: { id: episodeId },
    })
    const episode = epResult.data as EpisodeResource

    await putApiV3EpisodeById({
      client: this.sonarr,
      path: { id: episodeId },
      body: { ...episode, monitored: true },
    })

    const commandResult = await sonarrPostCommand({
      client: this.sonarr,
      body: { name: 'EpisodeSearch', episodeIds: [episodeId] } as Record<
        string,
        unknown
      >,
    })
    const commandId = (commandResult.data as { id?: number } | null)?.id ?? null

    this.state.setTracked(
      `episode:${episodeId}`,
      createTrackedEpisode(
        {
          tvdbId,
          sonarrSeriesId: seriesId,
          sonarrEpisodeId: episodeId,
          seasonNumber: episode.seasonNumber ?? 0,
          episodeNumber: episode.episodeNumber ?? 0,
        },
        commandId,
      ),
    )

    this.state.emitEvent({
      event: DownloadEvents.INITIATED,
      mediaType: 'episode',
      tvdbId,
      episodeId,
      scope: 'episode',
    })
    this.logger.log(
      `Episode download initiated tvdbId=${tvdbId} episodeId=${episodeId}`,
    )
  }

  private async downloadEpisodes(
    tvdbId: number,
    seriesId: number,
    scope: 'season' | 'series',
    seasonNumber?: number,
  ): Promise<void> {
    const isSeason = scope === 'season' && seasonNumber != null

    const [episodesResult, queueResult, seriesResult] = await Promise.all([
      getApiV3Episode({
        client: this.sonarr,
        query: { seriesId, ...(isSeason && { seasonNumber }) },
      }),
      getApiV3QueueDetails({ client: this.sonarr, query: { seriesId } }),
      getApiV3SeriesById({ client: this.sonarr, path: { id: seriesId } }),
    ])

    const allEpisodes = (episodesResult.data ?? []) as EpisodeResource[]
    const queuedIds = new Set(
      ((queueResult.data ?? []) as SonarrQueueResource[])
        .map(q => q.episodeId)
        .filter((id): id is number => id != null),
    )

    const eligible = this.filterEligibleEpisodes(allEpisodes, queuedIds)
    if (eligible.length === 0 && isSeason) return

    const episodeIds = eligible.map(ep => ep.id!)
    const series = seriesResult.data as SeriesResource

    let commandId: number | null = null

    if (isSeason) {
      const seasonNeedsMonitoring = series.seasons?.some(
        s => s.seasonNumber === seasonNumber && !s.monitored,
      )
      await Promise.all([
        putApiV3EpisodeMonitor({
          client: this.sonarr,
          body: { episodeIds, monitored: true },
        }),
        seasonNeedsMonitoring
          ? putApiV3SeriesById({
              client: this.sonarr,
              path: { id: String(seriesId) },
              body: {
                ...series,
                seasons: series.seasons?.map(s =>
                  s.seasonNumber === seasonNumber
                    ? { ...s, monitored: true }
                    : s,
                ),
              },
            })
          : Promise.resolve(),
      ])
      const commandResult = await sonarrPostCommand({
        client: this.sonarr,
        body: { name: 'EpisodeSearch', episodeIds } as Record<string, unknown>,
      })
      commandId = (commandResult.data as { id?: number } | null)?.id ?? null
    } else {
      await Promise.all([
        episodeIds.length > 0
          ? putApiV3EpisodeMonitor({
              client: this.sonarr,
              body: { episodeIds, monitored: true },
            })
          : Promise.resolve(),
        putApiV3SeriesById({
          client: this.sonarr,
          path: { id: String(seriesId) },
          body: {
            ...series,
            monitored: true,
            seasons: series.seasons?.map(s => ({ ...s, monitored: true })),
          },
        }),
      ])
      const commandResult = await sonarrPostCommand({
        client: this.sonarr,
        body: { name: 'SeriesSearch', seriesId } as Record<string, unknown>,
      })
      commandId = (commandResult.data as { id?: number } | null)?.id ?? null
    }

    for (const ep of eligible) {
      this.state.setTracked(
        `episode:${ep.id!}`,
        createTrackedEpisode(
          {
            tvdbId,
            sonarrSeriesId: seriesId,
            sonarrEpisodeId: ep.id!,
            seasonNumber: ep.seasonNumber ?? 0,
            episodeNumber: ep.episodeNumber ?? 0,
          },
          commandId,
        ),
      )
      this.state.emitEvent({
        event: DownloadEvents.INITIATED,
        mediaType: 'episode',
        tvdbId,
        episodeId: ep.id!,
        scope,
      })
    }

    if (isSeason) {
      this.logger.log(
        `Season download initiated tvdbId=${tvdbId} season=${seasonNumber} episodes=${episodeIds.length}`,
      )
    } else {
      this.logger.log(
        `Series download initiated tvdbId=${tvdbId} episodes=${episodeIds.length}`,
      )
    }
  }

  private collectTrackedEpisodes(
    predicate: (entry: TrackedEpisodeDownload) => boolean,
  ): { key: string; episodeId: number }[] {
    const result: { key: string; episodeId: number }[] = []
    for (const [key, entry] of this.state.getTracked()) {
      if (entry.kind === 'episode' && predicate(entry)) {
        result.push({ key, episodeId: entry.sonarrEpisodeId })
      }
    }
    return result
  }

  private async cancelTrackedEpisodes(
    tvdbId: number,
    seriesId: number,
    episodeKeys: { key: string; episodeId: number }[],
    options: { filterQueueByTracked: boolean },
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    const result = await getApiV3QueueDetails({
      client: this.sonarr,
      query: { seriesId, includeEpisode: false },
      cache: 'no-store',
    })
    const items = (result.data ?? []) as SonarrQueueResource[]

    const trackedEpisodeIds = new Set(episodeKeys.map(e => e.episodeId))
    const activeItems = items.filter(q => {
      if (q.id == null || q.episodeId == null) return false
      return options.filterQueueByTracked
        ? trackedEpisodeIds.has(q.episodeId)
        : true
    })

    if (activeItems.length > 0) {
      const queueIds = activeItems.map(q => q.id!)
      const queueEpisodeIds = activeItems.map(q => q.episodeId!)
      await Promise.all([
        deleteApiV3QueueBulk({
          client: this.sonarr,
          body: { ids: queueIds },
          query: { removeFromClient: true, blocklist: false },
        }),
        putApiV3EpisodeMonitor({
          client: this.sonarr,
          body: { episodeIds: queueEpisodeIds, monitored: false },
        }),
      ])
    }

    const allEpisodeIds = [
      ...new Set([
        ...episodeKeys.map(e => e.episodeId),
        ...activeItems.map(q => q.episodeId!),
      ]),
    ]

    const cancelledInQueue = new Set(activeItems.map(q => q.episodeId!))
    const trackedOnlyIds = episodeKeys
      .filter(e => !cancelledInQueue.has(e.episodeId))
      .map(e => e.episodeId)

    if (trackedOnlyIds.length > 0) {
      await putApiV3EpisodeMonitor({
        client: this.sonarr,
        body: { episodeIds: trackedOnlyIds, monitored: false },
      }).catch(err =>
        this.logger.warn(
          `cancelTrackedEpisodes unmonitor failed tvdbId=${tvdbId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
    }

    for (const { key, episodeId } of episodeKeys) {
      this.state.removeTracked(key)
      this.state.emitEvent({
        event: DownloadEvents.CANCELLED,
        mediaType: 'episode',
        tvdbId,
        episodeId,
      })
      if (!cancelledInQueue.has(episodeId)) {
        this.state.setPendingCancel(episodeId, {
          tvdbId,
          seriesId,
          cancelledAt: Date.now(),
        })
      }
    }

    this.logger.log(
      `Downloads cancelled tvdbId=${tvdbId} episodes=${allEpisodeIds.length}`,
    )
    return { cancelledEpisodeIds: allEpisodeIds }
  }

  private filterEligibleEpisodes(
    episodes: EpisodeResource[],
    queuedIds: Set<number>,
  ): EpisodeResource[] {
    const now = new Date()
    return episodes.filter(ep => {
      if (ep.hasFile) return false
      if (!ep.airDate || new Date(ep.airDate) > now) return false
      const id = ep.id ?? 0
      return (
        id > 0 &&
        !queuedIds.has(id) &&
        !this.state.getTracked().has(`episode:${id}`)
      )
    })
  }
}
