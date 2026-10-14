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

/**
 * What the bot just requested, held for one follow-up so the user can say it
 * picked the wrong title. Enough to undo the request (cancel its jobs, and
 * take the title out of the library if the request is what put it there) and
 * to offer the other matches for the same search.
 */
export interface RecentRequestContext {
  type: 'recentRequest'
  mediaType: 'movie' | 'tv'
  title: string
  /** The download app's media key - `tvdb:<id>` or `tmdb:<id>` */
  mediaId: string
  /** The tvdb (show) or tmdb (movie) id, to leave out of the re-offered list */
  externalId: number
  jobIds: string[]
  /**
   * Whether the title was in Sonarr/Radarr before this request. Only a title
   * the request added is removed on undo; anything else keeps its library
   * entry and files, and only the request's own jobs are cancelled.
   */
  wasInLibrary: boolean
  /** The search the title was picked from */
  query: string
  /** The seasons/episodes asked for, re-applied to the right show */
  tvSelection?: TvShowSelection
  qualityTier?: QualityTier
  timestamp: number
}
