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
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'

import { cached } from 'src/media/cache'
import { RADARR_CLIENT, type RadarrMediaClient } from 'src/media/clients'

import { DownloadStateService } from './download-state.service'
import {
  computeDownloadState,
  computeProgress,
  createTrackedMovie,
  DownloadEvents,
  type DownloadMovieRequest,
  type MovieDownloadItem,
  type MovieDownloadStatusResponse,
  type TrackedMovieDownload,
} from './downloads.types'

function getPosterUrl(images?: Array<MediaCover> | null): string | null {
  const poster = images?.find(img => img.coverType === 'poster')
  return poster?.remoteUrl ?? poster?.url ?? null
}

/**
 * Handles all movie-specific download, cancel, and status operations.
 */
@Injectable()
export class MovieDownloaderService {
  private readonly logger = new Logger(MovieDownloaderService.name)

  constructor(
    @Inject(RADARR_CLIENT) private readonly radarr: RadarrMediaClient,
    private readonly state: DownloadStateService,
  ) {}

  async requestDownload(req: DownloadMovieRequest): Promise<void> {
    const libraryResult = await getApiV3Movie({
      client: this.radarr,
      query: { tmdbId: req.tmdbId },
    })
    const movie = ((libraryResult.data ?? []) as MovieResource[])[0]

    if (!movie?.id) {
      throw new NotFoundException(
        `Movie with tmdbId ${req.tmdbId} not found in Radarr library`,
      )
    }

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

  async cancelMovieDownload(tmdbId: number): Promise<void> {
    const key = `movie:${tmdbId}`
    const entry = this.state.getTracked().get(key)

    let queueId = entry?.kind === 'movie' ? entry.queueId : null

    if (queueId == null) {
      const [libraryResult, queueResult] = await Promise.all([
        getApiV3Movie({ client: this.radarr, query: { tmdbId } }),
        radarrGetQueueDetails({ client: this.radarr }),
      ])
      const movie = ((libraryResult.data ?? []) as MovieResource[])[0]
      if (movie?.id) {
        const queue = (queueResult.data ?? []) as RadarrQueueItem[]
        const queueItem = queue.find(item => item.movieId === movie.id)
        queueId = queueItem?.id ?? null
      }
    }

    if (queueId != null) {
      await deleteApiV3QueueById({
        client: this.radarr,
        path: { id: queueId },
        query: { removeFromClient: true, blocklist: false },
      })
    }

    this.state.removeTracked(key)
    this.state.emitEvent({
      event: DownloadEvents.CANCELLED,
      mediaType: 'movie',
      tmdbId,
    })
    this.logger.log(`Movie download cancelled tmdbId=${tmdbId}`)
  }

  async getMovieStatus(
    tmdbId: number,
  ): Promise<MovieDownloadStatusResponse | null> {
    const entry = this.state.getTracked().get(`movie:${tmdbId}`)
    if (entry && entry.kind === 'movie') {
      return this.buildMovieStatus(entry)
    }
    return this.recoverMovieStatusFromQueue(tmdbId)
  }

  async buildMovieDownloadItems(
    entries: TrackedMovieDownload[],
  ): Promise<MovieDownloadItem[]> {
    if (entries.length === 0) return []

    let allMovies: MovieResource[] = []
    try {
      allMovies = await cached('radarr:movies', 60_000, () =>
        getApiV3Movie({ client: this.radarr }).then(
          r => (r.data ?? []) as MovieResource[],
        ),
      )
    } catch (err) {
      this.logger.warn(
        'Failed to fetch Radarr movies for download list',
        err instanceof Error ? err.message : String(err),
      )
    }

    const movieById = new Map<number, MovieResource>()
    for (const m of allMovies) {
      if (m.id != null) movieById.set(m.id, m)
    }

    return entries.map(entry => {
      const movie = movieById.get(entry.radarrMovieId)
      const title = movie?.title ?? entry.lastTitle ?? 'Unknown'
      const year = movie?.year ?? 0
      const posterUrl = movie ? getPosterUrl(movie.images) : null
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

  private async recoverMovieStatusFromQueue(
    tmdbId: number,
  ): Promise<MovieDownloadStatusResponse | null> {
    try {
      const [libraryResult, queueResult] = await Promise.all([
        getApiV3Movie({ client: this.radarr, query: { tmdbId } }),
        radarrGetQueueDetails({ client: this.radarr }),
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
      this.state.setTracked(`movie:${tmdbId}`, recovered)

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

  private async searchMovie(
    tmdbId: number,
    movieId: number,
    movie: MovieResource,
  ): Promise<void> {
    if (!movie.monitored) {
      await putApiV3MovieById({
        client: this.radarr,
        path: { id: String(movieId) },
        body: { ...movie, monitored: true },
      })
    }

    const commandResult = await radarrPostCommand({
      client: this.radarr,
      body: { name: 'MoviesSearch', movieIds: [movieId] } as Record<
        string,
        unknown
      >,
    })
    const commandId = (commandResult.data as RadarrCommandResource)?.id ?? null

    this.state.setTracked(
      `movie:${tmdbId}`,
      createTrackedMovie(tmdbId, movieId, commandId),
    )

    this.state.emitEvent({
      event: DownloadEvents.INITIATED,
      mediaType: 'movie',
      tmdbId,
    })
    this.logger.log(`Movie download search initiated tmdbId=${tmdbId}`)
  }

  private async grabMovieRelease(
    tmdbId: number,
    movieId: number,
    guid: string,
    indexerId: number,
    movie: MovieResource,
  ): Promise<void> {
    if (!movie.monitored) {
      await putApiV3MovieById({
        client: this.radarr,
        path: { id: String(movieId) },
        body: { ...movie, monitored: true },
      })
    }

    await postApiV3Release({
      client: this.radarr,
      body: { guid, indexerId } as RadarrReleaseResource,
    })

    this.state.setTracked(
      `movie:${tmdbId}`,
      createTrackedMovie(tmdbId, movieId),
    )

    this.state.emitEvent({
      event: DownloadEvents.INITIATED,
      mediaType: 'movie',
      tmdbId,
    })
    this.logger.log(`Movie release grabbed tmdbId=${tmdbId} guid=${guid}`)
  }
}
