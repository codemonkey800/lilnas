import { BaseMediaItem, ImageInfo } from './media.types'

/**
 * Radarr movie resource from API
 */
export interface RadarrMovie extends BaseMediaItem {
  id: number
  title: string
  originalTitle?: string
  originalLanguage?: {
    id: number
    name: string
  }
  secondaryYear?: number
  secondaryYearSourceId?: number
  sortTitle?: string
  sizeOnDisk?: number
  status: RadarrMovieStatus
  overview?: string
  inCinemas?: string
  physicalRelease?: string
  digitalRelease?: string
  images: RadarrImage[]
  website?: string
  year: number
  hasFile: boolean
  youTubeTrailerId?: string
  studio?: string
  path: string
  pathState?: RadarrPathState
  monitored: boolean
  minimumAvailability: RadarrMinimumAvailability
  isAvailable: boolean
  folderName?: string
  runtime: number
  cleanTitle: string
  imdbId?: string
  tmdbId: number
  titleSlug: string
  certification?: string
  genres: string[]
  tags: number[]
  added: string
  ratings: RadarrRatings
  qualityProfileId: number
  movieFile?: RadarrMovieFile
  collection?: RadarrCollection
  popularity?: number
}

/**
 * Radarr movie status enum
 */
export enum RadarrMovieStatus {
  TBA = 'tba',
  ANNOUNCED = 'announced',
  IN_CINEMAS = 'inCinemas',
  RELEASED = 'released',
  DELETED = 'deleted',
}

/**
 * Radarr path state enum
 */
export enum RadarrPathState {
  STATIC = 'static',
  DYNAMIC = 'dynamic',
}

/**
 * Radarr minimum availability enum
 */
export enum RadarrMinimumAvailability {
  TBA = 'tba',
  ANNOUNCED = 'announced',
  IN_CINEMAS = 'inCinemas',
  RELEASED = 'released',
}

/**
 * Radarr image information
 */
export interface RadarrImage extends ImageInfo {
  coverType: RadarrImageType
  url?: string
  remoteUrl?: string
}

/**
 * Radarr image type enum
 */
export enum RadarrImageType {
  POSTER = 'poster',
  FANART = 'fanart',
  BANNER = 'banner',
  CLEARLOGO = 'clearlogo',
  DISC = 'disc',
  LANDSCAPE = 'landscape',
}

/**
 * Radarr ratings information
 */
export interface RadarrRatings {
  imdb?: {
    votes: number
    value: number
    type: string
  }
  tmdb?: {
    votes: number
    value: number
    type: string
  }
  metacritic?: {
    votes: number
    value: number
    type: string
  }
  rottenTomatoes?: {
    votes: number
    value: number
    type: string
  }
}

/**
 * Radarr movie file information
 */
export interface RadarrMovieFile {
  id: number
  movieId: number
  relativePath: string
  path: string
  size: number
  dateAdded: string
  sceneName?: string
  indexerFlags: number
  quality: RadarrQuality
  customFormats?: RadarrCustomFormat[]
  mediaInfo?: RadarrMediaInfo
  originalFilePath?: string
  qualityCutoffNotMet: boolean
}

/**
 * Radarr quality information
 */
export interface RadarrQuality {
  quality: {
    id: number
    name: string
    source: string
    resolution: number
    modifier: string
  }
  revision: {
    version: number
    real: number
    isRepack: boolean
  }
}

/**
 * Radarr custom format information
 */
export interface RadarrCustomFormat {
  id: number
  name: string
}

/**
 * Radarr media info
 */
export interface RadarrMediaInfo {
  audioChannels?: number
  audioCodec?: string
  audioLanguages?: string
  height?: number
  width?: number
  resolution?: string
  runTime?: string
  scanType?: string
  subtitles?: string
  videoCodec?: string
  videoDynamicRange?: string
  videoDynamicRangeType?: string
}

/**
 * Radarr movie collection
 */
export interface RadarrCollection {
  id: number
  title: string
  overview?: string
  monitored: boolean
  rootFolderPath: string
  qualityProfileId: number
  searchOnAdd: boolean
  minimumAvailability: RadarrMinimumAvailability
  images: RadarrImage[]
  added: string
  tmdbId: number
  tags: number[]
}

/**
 * Radarr movie lookup response (for search)
 */
export interface RadarrMovieResource
  extends Omit<
    RadarrMovie,
    | 'id'
    | 'path'
    | 'pathState'
    | 'monitored'
    | 'qualityProfileId'
    | 'added'
    | 'tags'
  > {
  id?: number
  path?: string
  pathState?: RadarrPathState
  monitored?: boolean
  qualityProfileId?: number
  added?: string
  folder?: string
  rootFolderPath?: string
  tags?: number[]
}

/**
 * Movie search result - simplified interface for the main search function
 */
export interface MovieSearchResult {
  tmdbId: number
  imdbId?: string
  title: string
  originalTitle?: string
  year?: number
  overview?: string
  runtime?: number
  genres: string[]
  rating?: number
  posterPath?: string
  backdropPath?: string
  inCinemas?: string
  physicalRelease?: string
  digitalRelease?: string
  status: RadarrMovieStatus
  certification?: string
  studio?: string
  website?: string
  youTubeTrailerId?: string
  popularity?: number
}

/**
 * Radarr API error response
 */
export interface RadarrErrorResponse {
  message: string
  description?: string
  details?: string
}

/**
 * Radarr quality profile
 */
export interface RadarrQualityProfile {
  id: number
  name: string
  upgradeAllowed: boolean
  cutoff: number
  items: RadarrQualityProfileItem[]
  minFormatScore: number
  cutoffFormatScore: number
  formatItems: RadarrFormatItem[]
  language: RadarrLanguage
}

/**
 * Radarr quality profile item
 */
export interface RadarrQualityProfileItem {
  id: number
  name: string
  quality?: {
    id: number
    name: string
    source: string
    resolution: number
    modifier: string
  }
  items?: RadarrQualityProfileItem[]
  allowed: boolean
}

/**
 * Radarr format item
 */
export interface RadarrFormatItem {
  format: {
    id: number
    name: string
  }
  score: number
}

/**
 * Radarr language
 */
export interface RadarrLanguage {
  id: number
  name: string
}

/**
 * Radarr root folder
 */
export interface RadarrRootFolder {
  id: number
  path: string
  accessible: boolean
  freeSpace: number
  totalSpace: number
  unmappedFolders: RadarrUnmappedFolder[]
}

/**
 * Radarr unmapped folder
 */
export interface RadarrUnmappedFolder {
  name: string
  path: string
}

/**
 * Add movie request payload
 */
export interface AddMovieRequest {
  tmdbId: number
  title: string
  titleSlug: string
  year: number
  qualityProfileId: number
  rootFolderPath: string
  monitored: boolean
  minimumAvailability: RadarrMinimumAvailability
  searchOnAdd: boolean
  images?: RadarrImage[]
  genres?: string[]
  runtime?: number
  overview?: string
  inCinemas?: string
  physicalRelease?: string
  digitalRelease?: string
  certification?: string
  studio?: string
  website?: string
  youTubeTrailerId?: string
  tags?: number[]
}

/**
 * Add movie response - same as RadarrMovie
 */
export type AddMovieResponse = RadarrMovie

/**
 * Command request for triggering actions
 */
export interface RadarrCommandRequest {
  name: string
  movieIds?: number[]
  movieId?: number
}

/**
 * Command response
 */
export interface RadarrCommandResponse {
  id: number
  name: string
  commandName: string
  message?: string
  body: {
    movieIds?: number[]
    movieId?: number
    sendUpdatesToClient: boolean
    updateScheduledTask: boolean
    completionMessage: string
    requiresDiskAccess: boolean
    isExclusive: boolean
    isTypeExclusive: boolean
    isLongRunning: boolean
    name: string
    trigger: string
  }
  priority: string
  status: string
  queued: string
  started?: string
  ended?: string
  duration?: string
  exception?: string
  trigger: string
  clientUserAgent?: string
  stateChangeTime?: string
  sendUpdatesToClient: boolean
  updateScheduledTask: boolean
  lastExecutionTime?: string
}

/**
 * Monitor movie options
 */
export interface MonitorMovieOptions {
  qualityProfileId?: number
  rootFolderPath?: string
  minimumAvailability?: RadarrMinimumAvailability
  searchOnAdd?: boolean
  monitored?: boolean
}

/**
 * Monitor and download result
 */
export interface MonitorAndDownloadResult {
  success: boolean
  movieAdded: boolean
  searchTriggered: boolean
  movie?: RadarrMovie
  commandId?: number
  error?: string
  warnings?: string[]
}

/**
 * Delete movie options
 */
export interface DeleteMovieOptions {
  deleteFiles?: boolean
}

/**
 * Unmonitor and delete result
 */
export interface UnmonitorAndDeleteResult {
  success: boolean
  movieDeleted: boolean
  filesDeleted: boolean
  downloadsFound?: number
  downloadsCancelled?: number
  movie?: RadarrMovie
  error?: string
  warnings?: string[]
}

/**
 * Radarr system status
 */
export interface RadarrSystemStatus {
  appName: string
  version: string
  buildTime: string
  isDebug: boolean
  isProduction: boolean
  isAdmin: boolean
  isUserInteractive: boolean
  startupPath: string
  appData: string
  osName: string
  osVersion: string
  isMonoRuntime: boolean
  isMono: boolean
  isLinux: boolean
  isOsx: boolean
  isWindows: boolean
  branch: string
  authentication: string
  sqliteVersion: string
  migrationVersion: number
  urlBase?: string
  runtimeVersion: string
  runtimeName: string
  startTime: string
  packageVersion?: string
  packageAuthor?: string
  packageUpdateMechanism?: string
}

/**
 * Download protocol enum
 */
export enum DownloadProtocol {
  UNKNOWN = 'unknown',
  USENET = 'usenet',
  TORRENT = 'torrent',
}

/**
 * Radarr queue status enum
 */
export enum RadarrQueueStatus {
  UNKNOWN = 'unknown',
  QUEUED = 'queued',
  PAUSED = 'paused',
  DOWNLOADING = 'downloading',
  COMPLETED = 'completed',
  FAILED = 'failed',
  WARNING = 'warning',
  DELAY = 'delay',
  DOWNLOAD_CLIENT_UNAVAILABLE = 'downloadClientUnavailable',
  FALLBACK = 'fallback',
}

/**
 * Tracked download status enum
 */
export enum TrackedDownloadStatus {
  OK = 'ok',
  WARNING = 'warning',
  ERROR = 'error',
}

/**
 * Tracked download state enum
 */
export enum TrackedDownloadState {
  DOWNLOADING = 'downloading',
  IMPORT_PENDING = 'importPending',
  IMPORTING = 'importing',
  IMPORTED = 'imported',
  FAILED_PENDING = 'failedPending',
  FAILED = 'failed',
  IGNORED = 'ignored',
}

/**
 * Tracked download status message
 */
export interface TrackedDownloadStatusMessage {
  title: string
  messages: string[]
}

/**
 * Radarr queue item from API
 */
export interface RadarrQueueItem {
  id: number
  movieId?: number
  movie?: RadarrMovie
  title?: string
  size: number
  status: RadarrQueueStatus
  trackedDownloadStatus?: TrackedDownloadStatus
  trackedDownloadState?: TrackedDownloadState
  statusMessages?: TrackedDownloadStatusMessage[]
  errorMessage?: string
  downloadId?: string
  protocol: DownloadProtocol
  downloadClient?: string
  indexer?: string
  outputPath?: string
  estimatedCompletionTime?: string
  added?: string
}

/**
 * Radarr paginated response wrapper for queue endpoint
 */
export interface RadarrQueuePaginatedResponse {
  page: number
  pageSize: number
  sortKey: string
  sortDirection: 'ascending' | 'descending'
  totalRecords: number
  records: RadarrQueueItem[]
}

/**
 * Simplified downloading movie information for status queries
 */
export interface DownloadingMovie {
  id: number
  movieId?: number
  movieTitle?: string
  movieYear?: number
  size: number
  status: RadarrQueueStatus
  trackedDownloadStatus?: TrackedDownloadStatus
  trackedDownloadState?: TrackedDownloadState
  statusMessages?: TrackedDownloadStatusMessage[]
  errorMessage?: string
  downloadId?: string
  protocol: DownloadProtocol
  downloadClient?: string
  indexer?: string
  outputPath?: string
  estimatedCompletionTime?: string
  added?: string
  progress?: number
}
