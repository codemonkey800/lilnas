import {
  getApiV3Movie,
  type MovieResource,
  postApiV3Command as radarrPostCommand,
  postApiV3Release,
  putApiV3MovieById,
  type ReleaseResource as RadarrReleaseResource,
} from '@lilnas/media/radarr-next'
import {
  type EpisodeResource,
  getApiV3Episode,
  getApiV3EpisodeById,
  getApiV3QueueDetails,
  getApiV3SeriesLookup,
  postApiV3Command as sonarrPostCommand,
  putApiV3EpisodeById,
  putApiV3EpisodeMonitor,
  type QueueResource as SonarrQueueResource,
  type SeriesResource,
} from '@lilnas/media/sonarr'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'

import { getRadarrClient, getSonarrClient } from 'src/media/clients'

import {
  type DownloadEventPayload,
  DownloadEvents,
  type DownloadMovieRequest,
  type DownloadRequest,
  type DownloadShowRequest,
  INTERNAL_DOWNLOAD_EVENT,
  type TrackedDownload,
} from './download.types'

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name)

  /** Keys: "movie:{tmdbId}" | "episode:{sonarrEpisodeId}" */
  private readonly tracked = new Map<string, TrackedDownload>()

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

    await radarrPostCommand({
      client,
      body: { name: 'MoviesSearch', movieIds: [movieId] } as Record<
        string,
        unknown
      >,
    })

    this.tracked.set(`movie:${tmdbId}`, {
      kind: 'movie',
      tmdbId,
      radarrMovieId: movieId,
      queueId: null,
      lastProgress: null,
      lastStatus: null,
      lastSizeleft: null,
    })

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
  ): Promise<void> {
    const client = getRadarrClient()

    await postApiV3Release({
      client,
      body: { guid, indexerId } as RadarrReleaseResource,
    })

    this.tracked.set(`movie:${tmdbId}`, {
      kind: 'movie',
      tmdbId,
      radarrMovieId: movieId,
      queueId: null,
      lastProgress: null,
      lastStatus: null,
      lastSizeleft: null,
    })

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
    } else if (req.scope === 'season') {
      await this.downloadSeason(req.tvdbId, series.id, req.seasonNumber)
    } else {
      await this.downloadSeries(req.tvdbId, series.id)
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

    await sonarrPostCommand({
      client,
      body: { name: 'EpisodeSearch', episodeIds: [episodeId] } as Record<
        string,
        unknown
      >,
    })

    this.tracked.set(`episode:${episodeId}`, {
      kind: 'episode',
      tvdbId,
      sonarrSeriesId: seriesId,
      sonarrEpisodeId: episodeId,
      queueId: null,
      lastProgress: null,
      lastStatus: null,
      lastSizeleft: null,
    })

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

  /** Monitors and searches all eligible episodes in a season, tracking each one. */
  private async downloadSeason(
    tvdbId: number,
    seriesId: number,
    seasonNumber: number,
  ): Promise<void> {
    const client = getSonarrClient()

    const [episodesResult, queueResult] = await Promise.all([
      getApiV3Episode({ client, query: { seriesId, seasonNumber } }),
      getApiV3QueueDetails({ client, query: { seriesId } }),
    ])

    const allEpisodes = (episodesResult.data ?? []) as EpisodeResource[]
    const queuedIds = new Set(
      ((queueResult.data ?? []) as SonarrQueueResource[])
        .map(q => q.episodeId)
        .filter((id): id is number => id != null),
    )

    const eligible = this.filterEligibleEpisodes(allEpisodes, queuedIds)
    if (eligible.length === 0) return

    const episodeIds = eligible.map(ep => ep.id!)

    await putApiV3EpisodeMonitor({
      client,
      body: { episodeIds, monitored: true },
    })
    await sonarrPostCommand({
      client,
      body: { name: 'EpisodeSearch', episodeIds } as Record<string, unknown>,
    })

    for (const ep of eligible) {
      this.tracked.set(`episode:${ep.id!}`, {
        kind: 'episode',
        tvdbId,
        sonarrSeriesId: seriesId,
        sonarrEpisodeId: ep.id!,
        queueId: null,
        lastProgress: null,
        lastStatus: null,
        lastSizeleft: null,
      })
      this.emitEvent({
        event: DownloadEvents.INITIATED,
        mediaType: 'episode',
        tvdbId,
        episodeId: ep.id!,
        scope: 'season',
      })
    }

    this.logger.log(
      `Season download initiated tvdbId=${tvdbId} season=${seasonNumber} episodes=${episodeIds.length}`,
    )
  }

  /** Monitors eligible episodes and issues a full SeriesSearch, letting Sonarr decide what to grab. */
  private async downloadSeries(
    tvdbId: number,
    seriesId: number,
  ): Promise<void> {
    const client = getSonarrClient()

    const [episodesResult, queueResult] = await Promise.all([
      getApiV3Episode({ client, query: { seriesId } }),
      getApiV3QueueDetails({ client, query: { seriesId } }),
    ])

    const allEpisodes = (episodesResult.data ?? []) as EpisodeResource[]
    const queuedIds = new Set(
      ((queueResult.data ?? []) as SonarrQueueResource[])
        .map(q => q.episodeId)
        .filter((id): id is number => id != null),
    )

    const eligible = this.filterEligibleEpisodes(allEpisodes, queuedIds)
    const episodeIds = eligible.map(ep => ep.id!)

    if (episodeIds.length > 0) {
      await putApiV3EpisodeMonitor({
        client,
        body: { episodeIds, monitored: true },
      })
    }

    await sonarrPostCommand({
      client,
      body: { name: 'SeriesSearch', seriesId } as Record<string, unknown>,
    })

    for (const ep of eligible) {
      this.tracked.set(`episode:${ep.id!}`, {
        kind: 'episode',
        tvdbId,
        sonarrSeriesId: seriesId,
        sonarrEpisodeId: ep.id!,
        queueId: null,
        lastProgress: null,
        lastStatus: null,
        lastSizeleft: null,
      })
      this.emitEvent({
        event: DownloadEvents.INITIATED,
        mediaType: 'episode',
        tvdbId,
        episodeId: ep.id!,
        scope: 'series',
      })
    }

    this.logger.log(
      `Series download initiated tvdbId=${tvdbId} episodes=${episodeIds.length}`,
    )
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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
