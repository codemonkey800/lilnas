import {
  type CommandResource as RadarrCommandResource,
  deleteApiV3QueueById,
  getApiV3Movie,
  getApiV3QueueDetails as radarrGetQueueDetails,
  type MediaCover,
  type MovieResource,
  postApiV3Command as radarrPostCommand,
  postApiV3Release,
  putApiV3MovieById,
  type QueueResource as RadarrQueueItem,
  type ReleaseResource as RadarrReleaseResource,
} from '@lilnas/media/radarr-next'
import {
  deleteApiV3QueueBulk,
  deleteApiV3QueueById as sonarrDeleteQueueById,
  type EpisodeResource,
  getApiV3Episode,
  getApiV3EpisodeById,
  getApiV3QueueDetails,
  getApiV3SeriesById,
  getApiV3SeriesLookup,
  postApiV3Command as sonarrPostCommand,
  putApiV3EpisodeById,
  putApiV3EpisodeMonitor,
  putApiV3SeriesById,
  type QueueResource as SonarrQueueResource,
  type SeriesResource,
} from '@lilnas/media/sonarr'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'

import { getRadarrClient, getSonarrClient } from 'src/media/clients'
import { getPosterUrl } from 'src/media/library'

import {
  type AllDownloadsResponse,
  computeDownloadState,
  computeProgress,
  createTrackedEpisode,
  createTrackedMovie,
  type DownloadEventPayload,
  DownloadEvents,
  type DownloadMovieRequest,
  type DownloadRequest,
  type DownloadShowRequest,
  type EpisodeDownloadItem,
  type EpisodeDownloadStatusItem,
  INTERNAL_DOWNLOAD_EVENT,
  type MovieDownloadItem,
  type MovieDownloadStatusResponse,
  type SeasonDownloadGroup,
  type ShowDownloadItem,
  type ShowDownloadStatusResponse,
  type TrackedDownload,
  type TrackedEpisodeDownload,
  type TrackedMovieDownload,
} from './download.types'

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name)

  /** Keys: "movie:{tmdbId}" | "episode:{sonarrEpisodeId}" */
  private readonly tracked = new Map<string, TrackedDownload>()

  /**
   * Episodes whose cancel was issued while Sonarr was still searching.
   * The poller watches for queue items matching these and removes them.
   */
  private readonly pendingCancelEpisodes = new Map<
    number,
    { tvdbId: number; seriesId: number; cancelledAt: number }
  >()

  constructor(private readonly events: EventEmitter2) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Routes a download request to the movie or show handler. */
  async requestDownload(req: DownloadRequest): Promise<void> {
    if (req.mediaType === 'movie') {
      await this.downloadMovie(req)
    } else {
      await this.downloadShow(req)
    }
  }

  /** Returns a read-only view of all currently tracked downloads. */
  getTracked(): ReadonlyMap<string, TrackedDownload> {
    return this.tracked
  }

  /** Returns the set of episode IDs pending cancellation (Sonarr search was in-flight). */
  getPendingCancelEpisodes(): ReadonlyMap<
    number,
    { tvdbId: number; seriesId: number; cancelledAt: number }
  > {
    return this.pendingCancelEpisodes
  }

  /** Removes an episode from the pending cancel set after the poller handles it. */
  removePendingCancel(episodeId: number): void {
    this.pendingCancelEpisodes.delete(episodeId)
  }

  /** Merges a partial update into an existing tracked download entry. */
  updateTracked(key: string, patch: Partial<TrackedDownload>): void {
    const existing = this.tracked.get(key)
    if (existing) {
      this.tracked.set(key, { ...existing, ...patch } as TrackedDownload)
    }
  }

  /** Removes a download from the tracked map (e.g. on completion or failure). */
  removeTracked(key: string): void {
    this.tracked.delete(key)
  }

  /** Emits a download lifecycle event via EventEmitter2 for the WebSocket gateway to broadcast. */
  emitEvent(payload: DownloadEventPayload): void {
    this.events.emit(INTERNAL_DOWNLOAD_EVENT, {
      eventName: payload.event,
      payload,
    })
  }

  /**
   * Cancels a movie download by tmdbId. Resolves the queueId from the
   * tracked map or Radarr queue, removes the queue item, cleans up
   * tracking state, and notifies connected clients.
   */
  async cancelMovieDownload(tmdbId: number): Promise<void> {
    const key = `movie:${tmdbId}`
    const entry = this.tracked.get(key)

    let queueId = entry?.kind === 'movie' ? entry.queueId : null

    if (queueId == null) {
      const client = getRadarrClient()
      const [libraryResult, queueResult] = await Promise.all([
        getApiV3Movie({ client, query: { tmdbId } }),
        radarrGetQueueDetails({ client }),
      ])
      const movie = ((libraryResult.data ?? []) as MovieResource[])[0]
      if (movie?.id) {
        const queue = (queueResult.data ?? []) as RadarrQueueItem[]
        const queueItem = queue.find(item => item.movieId === movie.id)
        queueId = queueItem?.id ?? null
      }
    }

    if (queueId != null) {
      const client = getRadarrClient()
      await deleteApiV3QueueById({
        client,
        path: { id: queueId },
        query: { removeFromClient: true, blocklist: false },
      })
    }

    this.removeTracked(key)
    this.emitEvent({
      event: DownloadEvents.CANCELLED,
      mediaType: 'movie',
      tmdbId,
    })
    this.logger.log(`Movie download cancelled tmdbId=${tmdbId}`)
  }

  /**
   * Returns a status snapshot for a movie download.
   * Checks the in-memory tracked map first; if empty, falls back to
   * querying the Radarr queue directly and recovers tracking state.
   */
  async getMovieStatus(
    tmdbId: number,
  ): Promise<MovieDownloadStatusResponse | null> {
    const entry = this.tracked.get(`movie:${tmdbId}`)
    if (entry && entry.kind === 'movie') {
      return this.buildMovieStatus(entry)
    }

    return this.recoverMovieStatusFromQueue(tmdbId)
  }

  private buildMovieStatus(
    entry: TrackedMovieDownload,
  ): MovieDownloadStatusResponse {
    return {
      state: computeDownloadState(entry),
      title: entry.lastTitle,
      size: entry.lastSize ?? 0,
      sizeleft: entry.lastSizeleft ?? 0,
      progress: entry.lastProgress ?? 0,
      eta: entry.lastEta,
      status: entry.lastStatus,
    }
  }

  /**
   * Queries the Radarr queue for an active download matching this tmdbId.
   * If found, recovers tracking state so the poller picks it up for
   * future WebSocket events.
   */
  private async recoverMovieStatusFromQueue(
    tmdbId: number,
  ): Promise<MovieDownloadStatusResponse | null> {
    try {
      const client = getRadarrClient()

      const [libraryResult, queueResult] = await Promise.all([
        getApiV3Movie({ client, query: { tmdbId } }),
        radarrGetQueueDetails({ client }),
      ])

      const movie = ((libraryResult.data ?? []) as MovieResource[])[0]
      if (!movie?.id) return null

      const queue = (queueResult.data ?? []) as RadarrQueueItem[]
      const queueItem = queue.find(item => item.movieId === movie.id)
      if (!queueItem) return null

      const progress = computeProgress(queueItem.size, queueItem.sizeleft)

      const recovered: TrackedMovieDownload = {
        ...createTrackedMovie(tmdbId, movie.id),
        queueId: queueItem.id ?? null,
        lastProgress: progress,
        lastStatus: queueItem.status ?? null,
        lastSizeleft: queueItem.sizeleft ?? null,
        lastTitle: queueItem.title ?? null,
        lastSize: queueItem.size ?? null,
        lastEta: queueItem.estimatedCompletionTime ?? null,
      }
      this.tracked.set(`movie:${tmdbId}`, recovered)

      return {
        state: computeDownloadState(recovered),
        title: queueItem.title ?? null,
        size: queueItem.size ?? 0,
        sizeleft: queueItem.sizeleft ?? 0,
        progress: progress ?? 0,
        eta: queueItem.estimatedCompletionTime ?? null,
        status: queueItem.status ?? null,
      }
    } catch (err) {
      this.logger.warn(
        `Radarr queue check failed for tmdbId=${tmdbId}`,
        err instanceof Error ? err.stack : String(err),
      )
      return null
    }
  }

  /**
   * Cancels all tracked episode downloads for a show. Removes any active
   * Sonarr queue items, unmonitors the episodes, cleans up the tracked map,
   * and emits cancel events so connected clients update immediately.
   */
  async cancelShowDownloads(
    tvdbId: number,
    seriesId: number,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    const episodeKeys = this.collectTrackedEpisodes(
      entry => entry.tvdbId === tvdbId,
    )
    return this.cancelTrackedEpisodes(tvdbId, seriesId, episodeKeys, {
      filterQueueByTracked: false,
    })
  }

  /**
   * Returns status snapshots for all episodes of a show currently being tracked.
   * Used to seed the frontend with initial state on page load.
   */
  getShowStatus(tvdbId: number): ShowDownloadStatusResponse {
    const items: EpisodeDownloadStatusItem[] = []
    for (const entry of this.tracked.values()) {
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

  // ---------------------------------------------------------------------------
  // Movie download
  // ---------------------------------------------------------------------------

  /**
   * Handles a movie download request. If a specific release GUID is
   * provided, grabs that release directly; otherwise triggers a search.
   */
  private async downloadMovie(req: DownloadMovieRequest): Promise<void> {
    const client = getRadarrClient()

    const libraryResult = await getApiV3Movie({
      client,
      query: { tmdbId: req.tmdbId },
    })
    const movie = ((libraryResult.data ?? []) as MovieResource[])[0]

    if (!movie?.id) {
      throw new NotFoundException(
        `Movie with tmdbId ${req.tmdbId} not found in Radarr library`,
      )
    }

    // Grab a specific release if the caller provided one, otherwise search
    if (req.releaseGuid && req.indexerId != null) {
      await this.grabMovieRelease(
        req.tmdbId,
        movie.id,
        req.releaseGuid,
        req.indexerId,
        movie,
      )
    } else {
      await this.searchMovie(req.tmdbId, movie.id, movie)
    }
  }

  /** Ensures the movie is monitored, tells Radarr to search, and begins tracking. */
  private async searchMovie(
    tmdbId: number,
    movieId: number,
    movie: MovieResource,
  ): Promise<void> {
    const client = getRadarrClient()

    // Radarr won't search unmonitored movies, so enable monitoring first
    if (!movie.monitored) {
      await putApiV3MovieById({
        client,
        path: { id: String(movieId) },
        body: { ...movie, monitored: true },
      })
    }

    const commandResult = await radarrPostCommand({
      client,
      body: { name: 'MoviesSearch', movieIds: [movieId] } as Record<
        string,
        unknown
      >,
    })
    const commandId = (commandResult.data as RadarrCommandResource)?.id ?? null

    this.tracked.set(
      `movie:${tmdbId}`,
      createTrackedMovie(tmdbId, movieId, commandId),
    )

    this.emitEvent({
      event: DownloadEvents.INITIATED,
      mediaType: 'movie',
      tmdbId,
    })
    this.logger.log(`Movie download search initiated tmdbId=${tmdbId}`)
  }

  /** Grabs a specific release by GUID and begins tracking the download. */
  private async grabMovieRelease(
    tmdbId: number,
    movieId: number,
    guid: string,
    indexerId: number,
    movie: MovieResource,
  ): Promise<void> {
    const client = getRadarrClient()

    if (!movie.monitored) {
      await putApiV3MovieById({
        client,
        path: { id: String(movieId) },
        body: { ...movie, monitored: true },
      })
    }

    await postApiV3Release({
      client,
      body: { guid, indexerId } as RadarrReleaseResource,
    })

    this.tracked.set(`movie:${tmdbId}`, createTrackedMovie(tmdbId, movieId))

    this.emitEvent({
      event: DownloadEvents.INITIATED,
      mediaType: 'movie',
      tmdbId,
    })
    this.logger.log(`Movie release grabbed tmdbId=${tmdbId} guid=${guid}`)
  }

  // ---------------------------------------------------------------------------
  // Show download
  // ---------------------------------------------------------------------------

  /**
   * Routes a show download request to the appropriate handler based on scope.
   * Resolves the TVDB ID to a Sonarr series ID first.
   */
  private async downloadShow(req: DownloadShowRequest): Promise<void> {
    const client = getSonarrClient()

    const lookupResult = await getApiV3SeriesLookup({
      client,
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

  /** Monitors a single episode, triggers a Sonarr search, and starts tracking it. */
  private async downloadEpisode(
    tvdbId: number,
    seriesId: number,
    episodeId: number,
  ): Promise<void> {
    const client = getSonarrClient()

    const epResult = await getApiV3EpisodeById({
      client,
      path: { id: episodeId },
    })
    const episode = epResult.data as EpisodeResource

    await putApiV3EpisodeById({
      client,
      path: { id: episodeId },
      body: { ...episode, monitored: true },
    })

    const commandResult = await sonarrPostCommand({
      client,
      body: { name: 'EpisodeSearch', episodeIds: [episodeId] } as Record<
        string,
        unknown
      >,
    })
    const commandId = (commandResult.data as { id?: number } | null)?.id ?? null

    this.tracked.set(
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

    this.emitEvent({
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

  /**
   * Monitors and searches eligible episodes for a season or full series.
   * When `scope` is `'season'`, fetches only that season's episodes and does
   * an `EpisodeSearch`; when `'series'`, fetches all episodes, marks every
   * season monitored, and issues a `SeriesSearch`.
   */
  private async downloadEpisodes(
    tvdbId: number,
    seriesId: number,
    scope: 'season' | 'series',
    seasonNumber?: number,
  ): Promise<void> {
    const client = getSonarrClient()
    const isSeason = scope === 'season' && seasonNumber != null

    const [episodesResult, queueResult, seriesResult] = await Promise.all([
      getApiV3Episode({
        client,
        query: { seriesId, ...(isSeason && { seasonNumber }) },
      }),
      getApiV3QueueDetails({ client, query: { seriesId } }),
      getApiV3SeriesById({ client, path: { id: seriesId } }),
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
          client,
          body: { episodeIds, monitored: true },
        }),
        seasonNeedsMonitoring
          ? putApiV3SeriesById({
              client,
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
        client,
        body: { name: 'EpisodeSearch', episodeIds } as Record<string, unknown>,
      })
      commandId = (commandResult.data as { id?: number } | null)?.id ?? null
    } else {
      await Promise.all([
        episodeIds.length > 0
          ? putApiV3EpisodeMonitor({
              client,
              body: { episodeIds, monitored: true },
            })
          : Promise.resolve(),
        putApiV3SeriesById({
          client,
          path: { id: String(seriesId) },
          body: {
            ...series,
            monitored: true,
            seasons: series.seasons?.map(s => ({ ...s, monitored: true })),
          },
        }),
      ])
      const commandResult = await sonarrPostCommand({
        client,
        body: { name: 'SeriesSearch', seriesId } as Record<string, unknown>,
      })
      commandId = (commandResult.data as { id?: number } | null)?.id ?? null
    }

    for (const ep of eligible) {
      this.tracked.set(
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
      this.emitEvent({
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

  /**
   * Returns a snapshot of ALL currently tracked downloads with rich metadata
   * (title, year, poster) fetched from Radarr/Sonarr. Episodes are grouped
   * by show, then by season, for display on the Downloads page.
   */
  async getAllDownloads(): Promise<AllDownloadsResponse> {
    const movieEntries: TrackedMovieDownload[] = []
    const episodeEntries: TrackedEpisodeDownload[] = []

    for (const entry of this.tracked.values()) {
      if (entry.kind === 'movie') {
        movieEntries.push(entry)
      } else {
        episodeEntries.push(entry)
      }
    }

    const [movies, shows] = await Promise.all([
      this.buildMovieDownloadItems(movieEntries),
      this.buildShowDownloadItems(episodeEntries),
    ])

    return { movies, shows }
  }

  private async buildMovieDownloadItems(
    entries: TrackedMovieDownload[],
  ): Promise<MovieDownloadItem[]> {
    if (entries.length === 0) return []

    const radarrClient = getRadarrClient()

    // Single batch fetch instead of N parallel per-movie requests
    let allMovies: MovieResource[] = []
    try {
      const result = await getApiV3Movie({ client: radarrClient })
      allMovies = (result.data ?? []) as MovieResource[]
    } catch {
      // Fall through to defaults; per-entry fallback below will use tracked titles
    }

    const movieById = new Map<number, MovieResource>()
    for (const m of allMovies) {
      if (m.id != null) movieById.set(m.id, m)
    }

    return entries.map(entry => {
      const movie = movieById.get(entry.radarrMovieId)
      const title = movie?.title ?? entry.lastTitle ?? 'Unknown'
      const year = movie?.year ?? 0
      const posterUrl = movie ? (getPosterUrl(movie.images) ?? null) : null
      const progress = entry.lastProgress ?? 0

      return {
        tmdbId: entry.tmdbId,
        title,
        year,
        posterUrl,
        state: computeDownloadState(entry),
        releaseTitle: entry.lastTitle,
        size: entry.lastSize ?? 0,
        sizeleft: entry.lastSizeleft ?? 0,
        progress,
        eta: entry.lastEta,
        status: entry.lastStatus,
      } satisfies MovieDownloadItem
    })
  }

  private async buildShowDownloadItems(
    entries: TrackedEpisodeDownload[],
  ): Promise<ShowDownloadItem[]> {
    if (entries.length === 0) return []

    // Group by tvdbId
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

    const sonarrClient = getSonarrClient()

    const showItems = await Promise.all(
      Array.from(byShow.entries()).map(
        async ([tvdbId, { seriesId, episodes }]) => {
          let title = 'Unknown'
          let year = 0
          let posterUrl: string | null = null

          try {
            const result = await getApiV3SeriesById({
              client: sonarrClient,
              path: { id: seriesId },
            })
            const series = result.data as SeriesResource
            title = series.title ?? 'Unknown'
            year = series.year ?? 0
            posterUrl =
              getPosterUrl(
                series.images as Array<MediaCover> | null | undefined,
              ) ?? null
          } catch {
            // Leave defaults
          }

          // Group episodes by season
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

  /**
   * Cancels a single episode download. Finds the Sonarr queue item, removes it,
   * unmonitors the episode, cleans up tracking state, and emits a cancel event.
   */
  async cancelEpisodeDownload(episodeId: number): Promise<void> {
    const key = `episode:${episodeId}`
    const entry = this.tracked.get(key)
    const tvdbId = entry?.kind === 'episode' ? entry.tvdbId : undefined

    let queueId = entry?.kind === 'episode' ? entry.queueId : null

    const client = getSonarrClient()

    if (queueId == null) {
      // Try to find in Sonarr queue
      try {
        const queueResult = await getApiV3QueueDetails({ client })
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
          client,
          path: { id: queueId },
          query: { removeFromClient: true, blocklist: false },
        }),
        putApiV3EpisodeMonitor({
          client,
          body: { episodeIds: [episodeId], monitored: false },
        }),
      ]).catch(err =>
        this.logger.warn(
          `cancelEpisodeDownload cleanup failed episodeId=${episodeId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
    } else {
      // Still unmonitor even if not in queue
      await putApiV3EpisodeMonitor({
        client,
        body: { episodeIds: [episodeId], monitored: false },
      }).catch(err =>
        this.logger.warn(
          `cancelEpisodeDownload unmonitor failed episodeId=${episodeId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
    }

    this.removeTracked(key)
    this.emitEvent({
      event: DownloadEvents.CANCELLED,
      mediaType: 'episode',
      tvdbId,
      episodeId,
    })
    this.logger.log(`Episode download cancelled episodeId=${episodeId}`)
  }

  /**
   * Cancels all tracked episode downloads for a specific season of a show.
   * Mirrors cancelShowDownloads but scoped to a single season number.
   */
  async cancelSeasonDownloads(
    tvdbId: number,
    seriesId: number,
    seasonNumber: number,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    const episodeKeys = this.collectTrackedEpisodes(
      entry => entry.tvdbId === tvdbId && entry.seasonNumber === seasonNumber,
    )
    return this.cancelTrackedEpisodes(tvdbId, seriesId, episodeKeys, {
      filterQueueByTracked: true,
    })
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Collects tracked episode entries matching a predicate. */
  private collectTrackedEpisodes(
    predicate: (entry: TrackedEpisodeDownload) => boolean,
  ): { key: string; episodeId: number }[] {
    const result: { key: string; episodeId: number }[] = []
    for (const [key, entry] of this.tracked) {
      if (entry.kind === 'episode' && predicate(entry)) {
        result.push({ key, episodeId: entry.sonarrEpisodeId })
      }
    }
    return result
  }

  /**
   * Core cancel implementation shared by cancelShowDownloads and cancelSeasonDownloads.
   * Removes active Sonarr queue items for the given episode keys, unmonitors episodes,
   * cleans up tracking state, and emits cancel events.
   *
   * `filterQueueByTracked`: when true, only cancels queue items whose episodeId is
   * in the tracked set (used for season-scoped cancels). When false, cancels all
   * queue items for the series (used for full-show cancels).
   */
  private async cancelTrackedEpisodes(
    tvdbId: number,
    seriesId: number,
    episodeKeys: { key: string; episodeId: number }[],
    options: { filterQueueByTracked: boolean },
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    const client = getSonarrClient()
    const result = await getApiV3QueueDetails({
      client,
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
          client,
          body: { ids: queueIds },
          query: { removeFromClient: true, blocklist: false },
        }),
        putApiV3EpisodeMonitor({
          client,
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
        client,
        body: { episodeIds: trackedOnlyIds, monitored: false },
      }).catch(err =>
        this.logger.warn(
          `cancelTrackedEpisodes unmonitor failed tvdbId=${tvdbId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
    }

    for (const { key, episodeId } of episodeKeys) {
      this.removeTracked(key)
      this.emitEvent({
        event: DownloadEvents.CANCELLED,
        mediaType: 'episode',
        tvdbId,
        episodeId,
      })
      if (!cancelledInQueue.has(episodeId)) {
        this.pendingCancelEpisodes.set(episodeId, {
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

  /**
   * Filters episodes to those eligible for download: missing a file, already
   * aired, not currently queued, and not already tracked by this service.
   */
  private filterEligibleEpisodes(
    episodes: EpisodeResource[],
    queuedIds: Set<number>,
  ): EpisodeResource[] {
    const now = new Date()
    return episodes.filter(ep => {
      if (ep.hasFile) return false
      if (!ep.airDate || new Date(ep.airDate) > now) return false
      const id = ep.id ?? 0
      return id > 0 && !queuedIds.has(id) && !this.tracked.has(`episode:${id}`)
    })
  }
}
