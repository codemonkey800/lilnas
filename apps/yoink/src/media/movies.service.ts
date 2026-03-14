import {
  deleteApiV3MovieById,
  deleteApiV3MoviefileById,
  deleteApiV3QueueById,
  getApiV3MovieById,
  getApiV3MovieLookupTmdb,
  getApiV3Qualityprofile,
  getApiV3Rootfolder,
  type MovieResource,
  postApiV3Movie,
  postApiV3Release,
  putApiV3MovieById,
  type ReleaseResource,
} from '@lilnas/media/radarr-next'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { getRadarrClient } from './clients'
import {
  type MovieDetail,
  type MovieRelease,
  searchMovieReleases,
} from './movies'
import { getMovie } from './movies.server'
import { clearMovieSearchResult, recordMovieNotFound } from './search-results'

@Injectable()
export class MoviesService {
  async getMovie(tmdbId: number): Promise<MovieDetail> {
    try {
      return await getMovie(tmdbId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new NotFoundException(`Movie not found: ${message}`)
    }
  }

  async cancelDownload(queueId: number): Promise<void> {
    try {
      const client = getRadarrClient()
      await deleteApiV3QueueById({
        client,
        path: { id: queueId },
        query: { removeFromClient: true, blocklist: false },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new NotFoundException(`Queue item not found: ${message}`)
    }
  }

  async deleteMovieFile(fileId: number): Promise<void> {
    try {
      const client = getRadarrClient()
      await deleteApiV3MoviefileById({ client, path: { id: fileId } })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new NotFoundException(`Movie file not found: ${message}`)
    }
  }

  async searchReleases(movieId: number): Promise<MovieRelease[]> {
    try {
      return await searchMovieReleases(movieId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new NotFoundException(`Releases not found: ${message}`)
    }
  }

  async grabRelease(guid: string, indexerId: number): Promise<void> {
    try {
      const client = getRadarrClient()
      await postApiV3Release({
        client,
        body: { guid, indexerId } as ReleaseResource,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BadRequestException(`Failed to grab release: ${message}`)
    }
  }

  async setMonitored(movieId: number, monitored: boolean): Promise<void> {
    try {
      const client = getRadarrClient()
      const result = await getApiV3MovieById({ client, path: { id: movieId } })
      const movie = result.data as MovieResource
      await putApiV3MovieById({
        client,
        path: { id: String(movieId) },
        body: { ...movie, monitored },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new NotFoundException(`Movie not found: ${message}`)
    }
  }

  async addToLibrary(tmdbId: number): Promise<{ movieId: number }> {
    try {
      const client = getRadarrClient()
      const [lookupResult, rootFolderResult, qualityProfileResult] =
        await Promise.all([
          getApiV3MovieLookupTmdb({ client, query: { tmdbId } }),
          getApiV3Rootfolder({ client }),
          getApiV3Qualityprofile({ client }),
        ])

      const movie = lookupResult.data as MovieResource
      const rootFolders = rootFolderResult.data as Array<{
        path?: string | null
      }>
      const qualityProfiles = qualityProfileResult.data as Array<{
        id?: number
      }>

      const rootFolderPath = rootFolders[0]?.path ?? '/movies'
      const qualityProfileId = qualityProfiles[0]?.id ?? 1

      const result = await postApiV3Movie({
        client,
        body: {
          ...movie,
          rootFolderPath,
          qualityProfileId,
          monitored: false,
          addOptions: { searchForMovie: false },
        } as MovieResource,
      })

      const created = result.data as MovieResource
      return { movieId: created.id ?? 0 }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BadRequestException(`Failed to add movie: ${message}`)
    }
  }

  async removeFromLibrary(movieId: number): Promise<void> {
    try {
      const client = getRadarrClient()
      await deleteApiV3MovieById({
        client,
        path: { id: movieId },
        query: { deleteFiles: true, addImportExclusion: false },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new NotFoundException(`Movie not found: ${message}`)
    }
  }

  async recordSearchNotFound(tmdbId: number): Promise<void> {
    await recordMovieNotFound(tmdbId)
  }

  async clearSearchNotFound(tmdbId: number): Promise<void> {
    await clearMovieSearchResult(tmdbId)
  }
}
