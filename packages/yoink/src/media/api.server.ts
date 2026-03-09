import { cookies } from 'next/headers'

import type {
  MovieDownloadStatusResponse,
  ShowDownloadStatusResponse,
} from 'src/download/download.types'

import type { LibraryItem, SearchFilter } from './library'
import type { MovieDetail, MovieRelease } from './movies'
import type { ShowDetail, ShowRelease } from './shows'

const BACKEND_URL = `http://localhost:${process.env.BACKEND_PORT ?? 8081}`

async function backendFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const cookieStore = await cookies()
  const authToken = cookieStore.get('auth-token')?.value

  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken && { Cookie: `auth-token=${authToken}` }),
      ...init?.headers,
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Backend ${path} returned ${res.status}: ${text}`)
  }

  const contentType = res.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    return res.json() as Promise<T>
  }
  return undefined as T
}

export interface DeleteMovieFileParams {
  tmdbId: number
  movieFileId: number
}

export interface GrabMovieReleaseParams {
  tmdbId: number
  guid: string
  indexerId: number
}

export interface SetMovieMonitoredParams {
  movieId: number
  monitored: boolean
  tmdbId: number
}

export interface RemoveMovieFromLibraryParams {
  movieId: number
  tmdbId?: number | null
}

export interface CancelShowQueueItemParams {
  tvdbId: number
  queueId: number
}

export interface CancelAllShowDownloadsParams {
  tvdbId: number
  seriesId: number
}

export interface DeleteEpisodeFileParams {
  tvdbId: number
  episodeFileId: number
}

export interface DeleteSeasonFilesParams {
  tvdbId: number
  seriesId: number
  seasonNumber: number
}

export interface GrabEpisodeReleaseParams {
  tvdbId: number
  guid: string
  indexerId: number
}

export interface SetEpisodeMonitoredParams {
  episodeId: number
  monitored: boolean
  tvdbId: number
}

export interface RemoveShowFromLibraryParams {
  tvdbId: number
  seriesId: number
}

export interface SearchMediaParams {
  term: string
  filter?: SearchFilter
}

class ApiClient {
  private fetch<T>(path: string, init?: RequestInit): Promise<T> {
    return backendFetch<T>(path, init)
  }

  async getMovieById(tmdbId: string): Promise<MovieDetail> {
    return this.fetch(`/movies/${tmdbId}`)
  }

  async getShowById(tvdbId: string): Promise<ShowDetail> {
    return this.fetch(`/shows/${tvdbId}`)
  }

  async getMovieDownloadStatus(
    tmdbId: string | number,
  ): Promise<MovieDownloadStatusResponse | null> {
    try {
      return await this.fetch<MovieDownloadStatusResponse | null>(
        `/downloads/movie/${tmdbId}`,
      )
    } catch {
      return null
    }
  }

  async getShowDownloadStatus(
    tvdbId: string | number,
  ): Promise<ShowDownloadStatusResponse> {
    try {
      return await this.fetch<ShowDownloadStatusResponse>(
        `/downloads/show/${tvdbId}`,
      )
    } catch {
      return []
    }
  }

  async getLibrary(): Promise<LibraryItem[]> {
    return this.fetch<LibraryItem[]>('/library')
  }

  async searchMedia({
    term,
    filter = 'all',
  }: SearchMediaParams): Promise<LibraryItem[]> {
    const params = new URLSearchParams({ term, filter })
    return this.fetch<LibraryItem[]>(`/library/search?${params.toString()}`)
  }

  async cancelMovieDownload(tmdbId: number): Promise<void> {
    await this.fetch(`/downloads/movie/${tmdbId}`, { method: 'DELETE' })
  }

  async deleteMovieFile({
    tmdbId,
    movieFileId,
  }: DeleteMovieFileParams): Promise<void> {
    await this.fetch(`/movies/${tmdbId}/files/${movieFileId}`, {
      method: 'DELETE',
    })
  }

  async searchMovieReleases(movieId: number): Promise<MovieRelease[]> {
    return this.fetch<MovieRelease[]>(`/movies/${movieId}/releases`)
  }

  async grabMovieRelease({
    tmdbId,
    guid,
    indexerId,
  }: GrabMovieReleaseParams): Promise<void> {
    await this.fetch('/downloads', {
      method: 'POST',
      body: JSON.stringify({
        mediaType: 'movie',
        tmdbId,
        releaseGuid: guid,
        indexerId,
      }),
    })
  }

  async setMovieMonitored({
    movieId,
    monitored,
  }: SetMovieMonitoredParams): Promise<void> {
    await this.fetch(`/movies/${movieId}/monitored`, {
      method: 'PUT',
      body: JSON.stringify({ monitored }),
    })
  }

  async addMovieToLibrary(tmdbId: number): Promise<{ movieId: number }> {
    return this.fetch<{ movieId: number }>('/movies/library', {
      method: 'POST',
      body: JSON.stringify({ tmdbId }),
    })
  }

  async removeMovieFromLibrary({
    movieId,
    tmdbId,
  }: RemoveMovieFromLibraryParams): Promise<void> {
    const path =
      tmdbId != null
        ? `/movies/library/${movieId}?tmdbId=${tmdbId}`
        : `/movies/library/${movieId}`
    await this.fetch(path, { method: 'DELETE' })
  }

  async cancelShowQueueItem({
    tvdbId,
    queueId,
  }: CancelShowQueueItemParams): Promise<void> {
    await this.fetch(`/shows/${tvdbId}/queue/${queueId}`, { method: 'DELETE' })
  }

  async cancelAllShowDownloads({
    tvdbId,
    seriesId,
  }: CancelAllShowDownloadsParams): Promise<{ cancelledEpisodeIds: number[] }> {
    const result = await this.fetch<{ cancelledEpisodeIds: number[] }>(
      `/downloads/show/${tvdbId}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ seriesId }),
      },
    )
    return result ?? { cancelledEpisodeIds: [] }
  }

  async deleteEpisodeFile({
    tvdbId,
    episodeFileId,
  }: DeleteEpisodeFileParams): Promise<void> {
    await this.fetch(`/shows/${tvdbId}/episodes/files/${episodeFileId}`, {
      method: 'DELETE',
    })
  }

  async deleteSeasonFiles({
    tvdbId,
    seriesId,
    seasonNumber,
  }: DeleteSeasonFilesParams): Promise<void> {
    await this.fetch(`/shows/${tvdbId}/seasons/${seasonNumber}/files`, {
      method: 'DELETE',
      body: JSON.stringify({ seriesId }),
    })
  }

  async searchEpisodeReleases(episodeId: number): Promise<ShowRelease[]> {
    const result = await this.fetch<ShowRelease[]>(
      `/shows/episodes/${episodeId}/releases`,
    )
    return result ?? []
  }

  async grabEpisodeRelease({
    tvdbId,
    guid,
    indexerId,
  }: GrabEpisodeReleaseParams): Promise<void> {
    await this.fetch(`/shows/${tvdbId}/releases/grab`, {
      method: 'POST',
      body: JSON.stringify({ guid, indexerId }),
    })
  }

  async setEpisodeMonitored({
    episodeId,
    monitored,
  }: SetEpisodeMonitoredParams): Promise<void> {
    await this.fetch(`/shows/episodes/${episodeId}/monitored`, {
      method: 'PUT',
      body: JSON.stringify({ monitored }),
    })
  }

  async addShowToLibrary(tvdbId: number): Promise<{ seriesId: number }> {
    const result = await this.fetch<{ seriesId: number }>(`/shows/library`, {
      method: 'POST',
      body: JSON.stringify({ tvdbId }),
    })
    if (!result?.seriesId)
      throw new Error(`No seriesId returned for tvdbId ${tvdbId}`)
    return result
  }

  async removeShowFromLibrary({
    tvdbId,
    seriesId,
  }: RemoveShowFromLibraryParams): Promise<void> {
    await this.fetch(`/shows/library/${seriesId}?tvdbId=${tvdbId}`, {
      method: 'DELETE',
    })
  }
}

export const api = new ApiClient()
