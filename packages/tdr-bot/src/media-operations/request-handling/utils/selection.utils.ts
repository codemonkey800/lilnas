import { Injectable, Logger } from '@nestjs/common'

import {
  MovieLibrarySearchResult,
  MovieSearchResult,
} from 'src/media/types/radarr.types'
import { SeriesSearchResult } from 'src/media/types/sonarr.types'
import { SearchSelection } from 'src/schemas/search-selection'

/**
 * Selection utilities for finding items from search results
 *
 * Extracted from llm.service.ts for reuse across strategies
 */
@Injectable()
export class SelectionUtilities {
  private readonly logger = new Logger(SelectionUtilities.name)

  /**
   * Find selected movie from search results based on parsed selection
   * Extracted from llm.service.ts lines 3054-3097
   */
  findSelectedMovie(
    selection: SearchSelection,
    movies: MovieSearchResult[],
  ): MovieSearchResult | null {
    const { selectionType, value } = selection

    this.logger.log(
      { selectionType, value, movieCount: movies.length },
      'Finding selected movie from parsed selection',
    )

    switch (selectionType) {
      case 'ordinal': {
        const index = parseInt(value) - 1
        if (index >= 0 && index < movies.length) {
          this.logger.log({ selectedIndex: index }, 'Selected movie by ordinal')
          return movies[index]
        }
        this.logger.warn(
          { index, movieCount: movies.length },
          'Ordinal index out of range, defaulting to first',
        )
        return movies[0] || null
      }

      case 'year': {
        const yearMatch = movies.find(movie => movie.year?.toString() === value)
        if (yearMatch) {
          this.logger.log({ selectedYear: value }, 'Selected movie by year')
          return yearMatch
        }
        this.logger.warn(
          { year: value },
          'No movie found for year, defaulting to first',
        )
        return movies[0] || null
      }

      default: {
        this.logger.log('Using default selection (first movie)')
        return movies[0] || null
      }
    }
  }

  /**
   * Find selected movie from library search results
   * Extracted from llm.service.ts lines 2120-2170
   */
  findSelectedMovieFromLibrary(
    selection: SearchSelection,
    movies: MovieLibrarySearchResult[],
  ): MovieLibrarySearchResult | null {
    const { selectionType, value } = selection

    this.logger.log(
      { selectionType, value, movieCount: movies.length },
      'Finding selected movie from library results',
    )

    switch (selectionType) {
      case 'ordinal': {
        const index = parseInt(value) - 1
        if (index >= 0 && index < movies.length) {
          this.logger.log(
            { selectedIndex: index },
            'Selected movie by ordinal from library',
          )
          return movies[index]
        }
        this.logger.warn(
          { index, movieCount: movies.length },
          'Ordinal index out of range, defaulting to first',
        )
        return movies[0] || null
      }

      case 'year': {
        const yearMatch = movies.find(movie => movie.year?.toString() === value)
        if (yearMatch) {
          this.logger.log(
            { selectedYear: value },
            'Selected movie by year from library',
          )
          return yearMatch
        }
        this.logger.warn(
          { year: value },
          'No movie found for year in library, defaulting to first',
        )
        return movies[0] || null
      }

      default: {
        this.logger.log('Using default selection (first movie from library)')
        return movies[0] || null
      }
    }
  }

  /**
   * Find selected TV show from search results
   * Extracted from llm.service.ts lines 4073-4119
   */
  findSelectedShow(
    selection: SearchSelection,
    shows: SeriesSearchResult[],
  ): SeriesSearchResult | null {
    const { selectionType, value } = selection

    this.logger.log(
      { selectionType, value, showCount: shows.length },
      'Finding selected TV show from parsed selection',
    )

    switch (selectionType) {
      case 'ordinal': {
        const index = parseInt(value) - 1
        if (index >= 0 && index < shows.length) {
          this.logger.log(
            { selectedIndex: index },
            'Selected TV show by ordinal',
          )
          return shows[index]
        }
        this.logger.warn(
          { index, showCount: shows.length },
          'Ordinal index out of range, defaulting to first',
        )
        return shows[0] || null
      }

      case 'year': {
        const yearMatch = shows.find(show => show.year?.toString() === value)
        if (yearMatch) {
          this.logger.log({ selectedYear: value }, 'Selected TV show by year')
          return yearMatch
        }
        this.logger.warn(
          { year: value },
          'No TV show found for year, defaulting to first',
        )
        return shows[0] || null
      }

      default: {
        this.logger.log('Using default selection (first TV show)')
        return shows[0] || null
      }
    }
  }

  /**
   * Find selected TV show from library search results
   * Extracted from llm.service.ts lines 1987-2050
   */
  findSelectedTvShowFromLibrary(
    selection: SearchSelection,
    shows: Array<{ id: number; title: string; year?: number }>,
  ): { id: number; tvdbId: number; title: string; year?: number } | null {
    const { selectionType, value } = selection

    this.logger.log(
      { selectionType, value, showCount: shows.length },
      'Finding selected TV show from library results',
    )

    switch (selectionType) {
      case 'ordinal': {
        const index = parseInt(value) - 1
        if (index >= 0 && index < shows.length) {
          return shows[index] as {
            id: number
            tvdbId: number
            title: string
            year?: number
          }
        }
        return (
          (shows[0] as {
            id: number
            tvdbId: number
            title: string
            year?: number
          }) || null
        )
      }

      case 'year': {
        const yearMatch = shows.find(show => show.year?.toString() === value)
        if (yearMatch) {
          return yearMatch as {
            id: number
            tvdbId: number
            title: string
            year?: number
          }
        }
        return (
          (shows[0] as {
            id: number
            tvdbId: number
            title: string
            year?: number
          }) || null
        )
      }

      default: {
        return (
          (shows[0] as {
            id: number
            tvdbId: number
            title: string
            year?: number
          }) || null
        )
      }
    }
  }
}
