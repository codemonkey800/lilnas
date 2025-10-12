import { Injectable, Logger } from '@nestjs/common'

import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'
import { MediaRequestType } from 'src/schemas/graph'

import { formatMediaAsJson } from './formatting.utils'

/**
 * Data fetching utilities for library and external search
 *
 * Extracted from llm.service.ts for reuse across strategies
 */
@Injectable()
export class DataFetchingUtilities {
  private readonly logger = new Logger(DataFetchingUtilities.name)

  constructor(
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  /**
   * Fetch library data (movies and/or TV shows)
   * Extracted from llm.service.ts lines 2550-2613
   */
  async fetchLibraryData(
    mediaType: MediaRequestType,
    searchQuery?: string,
  ): Promise<{
    content: string
    count: number
  }> {
    let content = ''
    let count = 0

    if (
      mediaType === MediaRequestType.Movies ||
      mediaType === MediaRequestType.Both
    ) {
      try {
        this.logger.log({ searchQuery }, 'Fetching movie library data')
        const movies = await this.radarrService.getLibraryMovies()
        count += movies.length

        if (movies.length > 0) {
          content += '\n\n**MOVIES IN LIBRARY:**\n'
          content += formatMediaAsJson(movies)
          content += `\n\nTotal movies: ${movies.length}`
        } else {
          content += '\n\n**MOVIES:** No movies found in library'
        }
      } catch (error) {
        this.logger.error(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'Failed to fetch movie library',
        )
        content +=
          '\n\n**MOVIES:** Unable to fetch movie library (service may be unavailable)'
      }
    }

    if (
      mediaType === MediaRequestType.Shows ||
      mediaType === MediaRequestType.Both
    ) {
      try {
        this.logger.log({ searchQuery }, 'Fetching TV series library data')
        const series = await this.sonarrService.getLibrarySeries()
        count += series.length

        if (series.length > 0) {
          content += '\n\n**TV SHOWS IN LIBRARY:**\n'
          content += formatMediaAsJson(series)
          content += `\n\nTotal shows: ${series.length}`
        } else {
          content += '\n\n**TV SHOWS:** No TV shows found in library'
        }
      } catch (error) {
        this.logger.error(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'Failed to fetch TV series library',
        )
        content +=
          '\n\n**TV SHOWS:** Unable to fetch TV series library (service may be unavailable)'
      }
    }

    return { content, count }
  }

  /**
   * Fetch external search data (movies and/or TV shows)
   * Extracted from llm.service.ts lines 2615-2682
   */
  async fetchExternalSearchData(
    mediaType: MediaRequestType,
    searchQuery: string,
  ): Promise<{
    content: string
    count: number
  }> {
    let content = ''
    let count = 0

    if (
      mediaType === MediaRequestType.Movies ||
      mediaType === MediaRequestType.Both
    ) {
      try {
        this.logger.log({ searchQuery }, 'Searching for movies externally')
        const movies = await this.radarrService.searchMovies(searchQuery)
        count += movies.length

        if (movies.length > 0) {
          content += '\n\n**🔍 MOVIE SEARCH RESULTS:**\n'
          content += formatMediaAsJson(movies)
          content += `\n\nFound ${movies.length} movies matching "${searchQuery}"`
        } else {
          content += `\n\n**🔍 MOVIE SEARCH:** No movies found for "${searchQuery}"`
        }
      } catch (error) {
        this.logger.error(
          {
            error: error instanceof Error ? error.message : 'Unknown error',
            searchQuery,
          },
          'Failed to search movies externally',
        )
        content += `\n\n**🔍 MOVIES:** Unable to search for "${searchQuery}" (service may be unavailable)`
      }
    }

    if (
      mediaType === MediaRequestType.Shows ||
      mediaType === MediaRequestType.Both
    ) {
      try {
        this.logger.log({ searchQuery }, 'Searching for TV shows externally')
        const shows = await this.sonarrService.searchShows(searchQuery)
        count += shows.length

        if (shows.length > 0) {
          content += '\n\n**🔍 TV SHOW SEARCH RESULTS:**\n'
          content += formatMediaAsJson(shows)
          content += `\n\nFound ${shows.length} shows matching "${searchQuery}"`
        } else {
          content += `\n\n**🔍 TV SHOWS:** No shows found for "${searchQuery}"`
        }
      } catch (error) {
        this.logger.error(
          {
            error: error instanceof Error ? error.message : 'Unknown error',
            searchQuery,
          },
          'Failed to search TV shows externally',
        )
        content += `\n\n**🔍 TV SHOWS:** Unable to search for "${searchQuery}" (service may be unavailable)`
      }
    }

    return { content, count }
  }
}
