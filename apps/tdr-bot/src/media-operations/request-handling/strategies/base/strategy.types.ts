import type { QualityTier } from '@lilnas/utils/download/types'

import type {
  MovieLibrarySearchResult,
  MovieSearchResult,
} from 'src/media/types/radarr.types'
import type {
  LibrarySearchResult,
  SeriesSearchResult,
} from 'src/media/types/sonarr.types'
import type { SearchSelection } from 'src/schemas/search-selection'
import type { TvShowSelection } from 'src/schemas/tv-show'

/**
 * Movie-specific selection context
 */
export interface MovieSelectionContext {
  type: 'movie'
  searchResults: MovieSearchResult[]
  query: string
  timestamp: number
  isActive: boolean
  /**
   * The tier asked for with the search ("the matrix in 4k"), kept so the
   * follow-up pick ("the first one") still requests it
   */
  qualityTier?: QualityTier
}

/**
 * Movie delete selection context
 */
export interface MovieDeleteContext {
  type: 'movieDelete'
  searchResults: MovieLibrarySearchResult[]
  query: string
  timestamp: number
  isActive: boolean
}

/**
 * TV show selection context
 */
export interface TvShowSelectionContext {
  type: 'tvShow'
  searchResults: SeriesSearchResult[]
  query: string
  timestamp: number
  isActive: boolean
  originalSearchSelection?: SearchSelection
  originalTvSelection?: TvShowSelection
  /**
   * The tier asked for with the search or show pick ("breaking bad in 4k"),
   * kept so the follow-up pick ("season 2") still requests it
   */
  qualityTier?: QualityTier
}

/**
 * TV show delete selection context
 */
export interface TvShowDeleteContext {
  type: 'tvShowDelete'
  searchResults: LibrarySearchResult[]
  query: string
  timestamp: number
  isActive: boolean
  originalSearchSelection?: SearchSelection
  originalTvSelection?: TvShowSelection
}
