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
  filter?: import('./library').SearchFilter
}
