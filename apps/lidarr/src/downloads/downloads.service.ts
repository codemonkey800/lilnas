import { Injectable } from '@nestjs/common'

import {
  DownloadStateService,
  type TrackedDownloadPatch,
} from './download-state.service'
import {
  type AllDownloadsResponse,
  type DownloadEventPayload,
  type DownloadRequest,
  type MovieDownloadStatusResponse,
  type ShowDownloadStatusResponse,
  type TrackedDownload,
  type TrackedEpisodeDownload,
  type TrackedMovieDownload,
} from './downloads.types'
import { MovieDownloaderService } from './movie-downloader.service'
import { ShowDownloaderService } from './show-downloader.service'

/**
 * Thin coordinator that delegates movie/show download logic to specialised
 * sub-services and proxies shared state for DownloadPollerService compatibility.
 */
@Injectable()
export class DownloadsService {
  constructor(
    private readonly state: DownloadStateService,
    private readonly movieDownloader: MovieDownloaderService,
    private readonly showDownloader: ShowDownloaderService,
  ) {}

  // ---------------------------------------------------------------------------
  // Business logic — delegated to sub-services
  // ---------------------------------------------------------------------------

  async requestDownload(req: DownloadRequest): Promise<void> {
    if (req.mediaType === 'movie') {
      await this.movieDownloader.requestDownload(req)
    } else {
      await this.showDownloader.requestDownload(req)
    }
  }

  async getAllDownloads(): Promise<AllDownloadsResponse> {
    const tracked = this.state.getTracked()
    const movieEntries: TrackedMovieDownload[] = []
    const episodeEntries: TrackedEpisodeDownload[] = []
    for (const entry of tracked.values()) {
      if (entry.kind === 'movie') movieEntries.push(entry)
      else if (entry.kind === 'episode') episodeEntries.push(entry)
    }
    const [movies, shows] = await Promise.all([
      this.movieDownloader.buildMovieDownloadItems(movieEntries),
      this.showDownloader.buildShowDownloadItems(episodeEntries),
    ])
    return { movies, shows }
  }

  async getMovieStatus(
    tmdbId: number,
  ): Promise<MovieDownloadStatusResponse | null> {
    return this.movieDownloader.getMovieStatus(tmdbId)
  }

  getShowStatus(tvdbId: number): ShowDownloadStatusResponse {
    return this.showDownloader.getShowStatus(tvdbId)
  }

  async cancelMovieDownload(tmdbId: number): Promise<void> {
    return this.movieDownloader.cancelMovieDownload(tmdbId)
  }

  async cancelShowDownloads(
    tvdbId: number,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    return this.showDownloader.cancelShowDownloads(tvdbId)
  }

  async cancelSeasonDownloads(
    tvdbId: number,
    seasonNumber: number,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    return this.showDownloader.cancelSeasonDownloads(tvdbId, seasonNumber)
  }

  async cancelEpisodeDownload(episodeId: number): Promise<void> {
    return this.showDownloader.cancelEpisodeDownload(episodeId)
  }

  // ---------------------------------------------------------------------------
  // State proxies — for DownloadPollerService compatibility
  // ---------------------------------------------------------------------------

  getTracked(): ReadonlyMap<string, TrackedDownload> {
    return this.state.getTracked()
  }

  getPendingCancelEpisodes(): ReadonlyMap<
    number,
    { tvdbId: number; seriesId: number; cancelledAt: number }
  > {
    return this.state.getPendingCancelEpisodes()
  }

  updateTracked(key: string, patch: TrackedDownloadPatch): void {
    this.state.updateTracked(key, patch)
  }

  removeTracked(key: string): void {
    this.state.removeTracked(key)
  }

  removePendingCancel(episodeId: number): void {
    this.state.removePendingCancel(episodeId)
  }

  emitEvent(payload: DownloadEventPayload): void {
    this.state.emitEvent(payload)
  }
}
