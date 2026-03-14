import type { AllDownloadsResponse } from 'src/download/download.types'

import type { CancelAllShowDownloadsParams } from './api.types'

interface DownloadMovieOpts {
  releaseGuid?: string
  indexerId?: number
}

class ApiClient {
  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`/api${path}`, init)
    if (!res.ok) throw new Error(`API ${path} returned ${res.status}`)
    return res.json() as Promise<T>
  }

  private async fetchVoid(path: string, init?: RequestInit): Promise<void> {
    const res = await fetch(`/api${path}`, init)
    if (!res.ok) throw new Error(`API ${path} returned ${res.status}`)
  }

  async getAllDownloads(): Promise<AllDownloadsResponse> {
    try {
      return await this.fetchJson<AllDownloadsResponse>('/downloads/all')
    } catch {
      return { movies: [], shows: [] }
    }
  }

  async requestMovieDownload(
    tmdbId: number,
    opts?: DownloadMovieOpts,
  ): Promise<void> {
    await this.fetchVoid('/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType: 'movie', tmdbId, ...opts }),
    })
  }

  async requestShowDownload(tvdbId: number, scope: 'series'): Promise<void>
  async requestShowDownload(
    tvdbId: number,
    scope: 'season',
    opts: { seasonNumber: number },
  ): Promise<void>
  async requestShowDownload(
    tvdbId: number,
    scope: 'episode',
    opts: { episodeId: number },
  ): Promise<void>
  async requestShowDownload(
    tvdbId: number,
    scope: 'series' | 'season' | 'episode',
    opts?: { seasonNumber?: number; episodeId?: number },
  ): Promise<void> {
    await this.fetchVoid('/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaType: 'show', tvdbId, scope, ...opts }),
    })
  }

  async cancelMovieDownload(tmdbId: number): Promise<void> {
    await this.fetchVoid(`/downloads/movie/${tmdbId}`, { method: 'DELETE' })
  }

  async cancelAllShowDownloads({
    tvdbId,
    seriesId,
  }: CancelAllShowDownloadsParams): Promise<{ cancelledEpisodeIds: number[] }> {
    const result = await this.fetchJson<{ cancelledEpisodeIds: number[] }>(
      `/downloads/show/${tvdbId}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId }),
      },
    )
    return result ?? { cancelledEpisodeIds: [] }
  }

  async cancelEpisodeDownload(episodeId: number): Promise<void> {
    await this.fetchVoid(`/downloads/episode/${episodeId}`, {
      method: 'DELETE',
    })
  }

  async cancelSeasonDownloads(
    tvdbId: number,
    seriesId: number,
    seasonNumber: number,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    const result = await this.fetchJson<{ cancelledEpisodeIds: number[] }>(
      `/downloads/show/${tvdbId}/season/${seasonNumber}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId }),
      },
    )
    return result ?? { cancelledEpisodeIds: [] }
  }
}

export const api = new ApiClient()
