import { Injectable, NotFoundException } from '@nestjs/common'

import { type MovieDetail } from './movies'
import { getMovie } from './movies.server'

@Injectable()
export class MoviesService {
  /**
   * Fetches movie details by TMDB ID. Wraps the server-side data layer
   * and converts unknown errors into {@link NotFoundException}.
   */
  async getMovie(tmdbId: number): Promise<MovieDetail> {
    try {
      return await getMovie(tmdbId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new NotFoundException(`Movie not found: ${message}`)
    }
  }
}
