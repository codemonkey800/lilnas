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
