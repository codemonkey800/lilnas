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

/**
 * Movie operation state interface
 */
export interface MovieOperationState {
  setUserMovieContext: (userId: string, context: MovieSelectionContext) => void
  clearUserMovieContext: (userId: string) => void
}

/**
 * Movie delete operation state interface
 */
export interface MovieDeleteOperationState {
  setUserMovieDeleteContext: (
    userId: string,
    context: MovieDeleteContext,
  ) => void
  clearUserMovieDeleteContext: (userId: string) => void
}

/**
 * TV show operation state interface
 */
export interface TvShowOperationState {
  setUserTvShowContext: (
    userId: string,
    context: TvShowSelectionContext,
  ) => void
  clearUserTvShowContext: (userId: string) => void
}

/**
 * TV show delete operation state interface
 */
export interface TvShowDeleteOperationState {
  setUserTvShowDeleteContext: (
    userId: string,
    context: TvShowDeleteContext,
  ) => void
  clearUserTvShowDeleteContext: (userId: string) => void
}
