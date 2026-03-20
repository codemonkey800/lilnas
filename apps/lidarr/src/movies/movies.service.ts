import {
  deleteApiV3MoviefileById,
  getApiV3Movie,
  getApiV3Moviefile,
  type MovieFileResource,
  type MovieResource,
} from '@lilnas/media/radarr-next'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { RADARR_CLIENT, type RadarrMediaClient } from 'src/media/clients'

import { type MovieDetail, movieResourceToDetail } from './movies.types'

@Injectable()
export class MoviesService {
  constructor(
    @Inject(RADARR_CLIENT) private readonly radarr: RadarrMediaClient,
  ) {}

  async getMovie(tmdbId: number): Promise<MovieDetail> {
    const libraryResult = await getApiV3Movie({
      client: this.radarr,
      query: { tmdbId },
    })

    const movies = (libraryResult.data ?? []) as MovieResource[]
    const movie = movies[0]

    if (!movie) {
      throw new NotFoundException(
        `Movie with tmdbId ${tmdbId} not found in Radarr library`,
      )
    }

    let files: MovieFileResource[] = []
    if (movie.id != null) {
      const filesResult = await getApiV3Moviefile({
        client: this.radarr,
        query: { movieId: [movie.id] },
      })
      files = (filesResult.data ?? []) as MovieFileResource[]
    }

    return movieResourceToDetail(movie, files)
  }

  async deleteMovieFile(tmdbId: number, fileId: number): Promise<void> {
    const libraryResult = await getApiV3Movie({
      client: this.radarr,
      query: { tmdbId },
    })
    const movies = (libraryResult.data ?? []) as MovieResource[]
    if (!movies[0]) {
      throw new NotFoundException(
        `Movie with tmdbId ${tmdbId} not found in Radarr library`,
      )
    }

    try {
      await deleteApiV3MoviefileById({
        client: this.radarr,
        path: { id: fileId },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new NotFoundException(`Movie file not found: ${message}`)
    }
  }
}
