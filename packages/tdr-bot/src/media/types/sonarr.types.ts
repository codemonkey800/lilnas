import { BaseMediaItem, ImageInfo } from './media.types'

/**
 * Sonarr series status enum
 */
export enum SonarrSeriesStatus {
  CONTINUING = 'continuing',
  ENDED = 'ended',
  UPCOMING = 'upcoming',
  DELETED = 'deleted',
}

/**
 * Sonarr series type enum
 */
export enum SonarrSeriesType {
  STANDARD = 'standard',
  DAILY = 'daily',
  ANIME = 'anime',
}

/**
 * Sonarr monitor types enum
 */
export enum SonarrMonitorType {
  ALL = 'all',
  FUTURE = 'future',
  MISSING = 'missing',
  EXISTING = 'existing',
  FIRST_SEASON = 'firstSeason',
  LATEST_SEASON = 'latestSeason',
  NONE = 'none',
}

/**
 * Sonarr image information
 */
export interface SonarrImage extends ImageInfo {
  coverType: SonarrImageType
  url?: string
  remoteUrl?: string
}

/**
 * Sonarr image type enum
 */
export enum SonarrImageType {
  POSTER = 'poster',
  BANNER = 'banner',
  FANART = 'fanart',
  SCREENSHOT = 'screenshot',
  HEADSHOT = 'headshot',
  CLEARLOGO = 'clearlogo',
}

/**
 * Sonarr ratings information
 */
export interface SonarrRatings {
  imdb?: {
    votes: number
    value: number
    type: string
  }
  theMovieDb?: {
    votes: number
    value: number
    type: string
  }
  rottenTomatoes?: {
    votes: number
    value: number
    type: string
  }
  tvdb?: {
    votes: number
    value: number
    type: string
  }
}

/**
 * Sonarr season information
 */
export interface SonarrSeason {
  seasonNumber: number
  monitored: boolean
  statistics?: SonarrSeasonStatistics
}

/**
 * Sonarr season statistics
 */
export interface SonarrSeasonStatistics {
  episodeFileCount: number
  episodeCount: number
  totalEpisodeCount: number
  sizeOnDisk: number
  percentOfEpisodes: number
}

/**
 * Sonarr series statistics
 */
export interface SonarrSeriesStatistics {
  seasonCount: number
  episodeFileCount: number
  episodeCount: number
  totalEpisodeCount: number
  sizeOnDisk: number
  percentOfEpisodes: number
}

/**
 * Sonarr alternate title
 */
export interface SonarrAlternateTitle {
  title: string
  seasonNumber?: number
  sceneSeasonNumber?: number
  sceneOrigin?: string
  comment?: string
}

/**
 * Sonarr series resource from API
 */
export interface SonarrSeries extends BaseMediaItem {
  id: number
  title: string
  alternateTitles?: SonarrAlternateTitle[]
  sortTitle?: string
  status: SonarrSeriesStatus
  ended: boolean
  profileName?: string
  overview?: string
  nextAiring?: string
  previousAiring?: string
  network?: string
  airTime?: string
  images: SonarrImage[]
  originalLanguage?: {
    id: number
    name: string
  }
  remotePoster?: string
  seasons: SonarrSeason[]
  year: number
  path: string
  qualityProfileId: number
  languageProfileId?: number
  seasonFolder: boolean
  monitored: boolean
  useSceneNumbering: boolean
  runtime: number
  tvdbId: number
  tvRageId?: number
  tvMazeId?: number
  tmdbId?: number
  firstAired?: string
  lastAired?: string
  seriesType: SonarrSeriesType
  cleanTitle: string
  imdbId?: string
  titleSlug: string
  rootFolderPath?: string
  folder?: string
  certification?: string
  genres: string[]
  tags: number[]
  added: string
  ratings: SonarrRatings
  statistics?: SonarrSeriesStatistics
}

/**
 * Sonarr series lookup response (for search)
 */
export interface SonarrSeriesResource
  extends Omit<
    SonarrSeries,
    | 'id'
    | 'path'
    | 'qualityProfileId'
    | 'languageProfileId'
    | 'monitored'
    | 'added'
    | 'tags'
    | 'statistics'
  > {
  id?: number
  path?: string
  qualityProfileId?: number
  languageProfileId?: number
  monitored?: boolean
  added?: string
  tags?: number[]
  statistics?: SonarrSeriesStatistics
  rootFolderPath?: string
}

/**
 * Series search result - simplified interface for the main search function
 */
export interface SeriesSearchResult {
  tvdbId: number
  tmdbId?: number
  imdbId?: string
  title: string
  titleSlug: string
  sortTitle?: string
  year?: number
  firstAired?: string
  lastAired?: string
  overview?: string
  runtime?: number
  network?: string
  status: SonarrSeriesStatus
  seriesType: SonarrSeriesType
  seasons: SonarrSeason[]
  genres: string[]
  rating?: number
  posterPath?: string
  backdropPath?: string
  certification?: string
  ended: boolean
}

/**
 * Library search result - extends SeriesSearchResult with library-specific fields
 */
export interface LibrarySearchResult extends SeriesSearchResult {
  id: number
  monitored: boolean
  path: string
  statistics?: SonarrSeriesStatistics
  added: string
}

/**
 * Sonarr API error response
 */
export interface SonarrErrorResponse {
  message: string
  description?: string
  details?: string
}

/**
 * Sonarr quality profile
 */
export interface SonarrQualityProfile {
  id: number
  name: string
  upgradeAllowed: boolean
  cutoff: number
  items: SonarrQualityProfileItem[]
  minFormatScore: number
  cutoffFormatScore: number
  formatItems: SonarrFormatItem[]
  language: SonarrLanguage
}

/**
 * Sonarr quality profile item
 */
export interface SonarrQualityProfileItem {
  id: number
  name: string
  quality?: {
    id: number
    name: string
    source: string
    resolution: number
    modifier: string
  }
  items?: SonarrQualityProfileItem[]
  allowed: boolean
}

/**
 * Sonarr format item
 */
export interface SonarrFormatItem {
  format: {
    id: number
    name: string
  }
  score: number
}

/**
 * Sonarr language
 */
export interface SonarrLanguage {
  id: number
  name: string
}

/**
 * Sonarr root folder
 */
export interface SonarrRootFolder {
  id: number
  path: string
  accessible: boolean
  freeSpace: number
  totalSpace: number
  unmappedFolders: SonarrUnmappedFolder[]
}

/**
 * Sonarr unmapped folder
 */
export interface SonarrUnmappedFolder {
  name: string
  path: string
}

/**
 * Sonarr system status
 */
export interface SonarrSystemStatus {
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
 * Add series request payload
 */
export interface AddSeriesRequest {
  tvdbId: number
  title: string
  titleSlug: string
  qualityProfileId: number
  languageProfileId?: number
  rootFolderPath: string
  monitored: boolean
  monitor: SonarrMonitorType
  seasonFolder: boolean
  useSceneNumbering: boolean
  seriesType: SonarrSeriesType
  searchForMissingEpisodes: boolean
  searchForCutoffUnmetEpisodes: boolean
  images?: SonarrImage[]
  seasons?: SonarrSeason[]
  year?: number
  firstAired?: string
  overview?: string
  network?: string
  airTime?: string
  certification?: string
  genres?: string[]
  tags?: number[]
}

/**
 * Add series response - same as SonarrSeries
 */
export type AddSeriesResponse = SonarrSeries

/**
 * Command request for triggering actions
 */
export interface SonarrCommandRequest {
  name: string
  seriesIds?: number[]
  seriesId?: number
}

/**
 * Command response
 */
export interface SonarrCommandResponse {
  id: number
  name: string
  commandName: string
  message?: string
  body: {
    seriesIds?: number[]
    seriesId?: number
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
 * Episode resource from Sonarr API
 */
export interface EpisodeResource {
  id: number
  seriesId: number
  seasonNumber: number
  episodeNumber: number
  title: string
  monitored: boolean
  hasFile: boolean
  airDate?: string
  overview?: string
  runtime?: number
  episodeFileId?: number
  absoluteEpisodeNumber?: number
}

/**
 * Season/Episode selection for monitoring
 */
export interface SeasonEpisodeSelection {
  season: number
  episodes?: number[] // If omitted, monitor entire season
}

/**
 * Options for monitoring and downloading series
 */
export interface MonitorSeriesOptions {
  selection?: SeasonEpisodeSelection[] // If omitted, monitor entire series
}

/**
 * Options for unmonitoring and deleting series
 */
export interface UnmonitorSeriesOptions {
  selection?: SeasonEpisodeSelection[] // If omitted, unmonitor entire series (delete)
}

/**
 * Monitoring change information
 */
export interface MonitoringChange {
  season: number
  episodes?: number[] // undefined means entire season
  action: 'monitored' | 'unmonitored'
}

/**
 * Unmonitoring change information - extends monitoring change with deletion actions
 */
export interface UnmonitoringChange {
  season: number
  episodes?: number[] // undefined means entire season
  action:
    | 'unmonitored'
    | 'deleted_series'
    | 'deleted_episodes'
    | 'deleted_files'
    | 'unmonitored_season'
}

/**
 * Result of monitoring and downloading series operation
 */
export interface MonitorAndDownloadSeriesResult {
  success: boolean
  seriesAdded: boolean
  seriesUpdated: boolean
  searchTriggered: boolean
  changes: MonitoringChange[]
  series?: SonarrSeries
  commandId?: number
  warnings?: string[]
  error?: string
}

/**
 * Result of unmonitoring and deleting series operation
 */
export interface UnmonitorAndDeleteSeriesResult {
  success: boolean
  seriesDeleted: boolean // true if entire series was deleted
  episodesUnmonitored: boolean // true if episodes were unmonitored
  downloadsCancel: boolean // true if downloads were canceled
  canceledDownloads: number // number of canceled downloads
  changes: UnmonitoringChange[]
  series?: SonarrSeries // series state after operation (null if deleted)
  commandIds?: number[] // command IDs for cancel operations
  warnings?: string[]
  error?: string
}

/**
 * Update episode request
 */
export interface UpdateEpisodeRequest {
  monitored: boolean
}

/**
 * Bulk episode update request
 */
export interface BulkEpisodeUpdateRequest {
  episodeIds: number[]
  monitored: boolean
}

/**
 * Sonarr queue item for tracking downloads
 */
export interface SonarrQueueItem {
  id: number
  seriesId: number
  episodeId?: number
  title: string
  series: {
    id: number
    title: string
    tvdbId: number
  }
  episode?: {
    id: number
    episodeNumber: number
    seasonNumber: number
    title: string
  }
  status: string
  trackedDownloadStatus: string
  protocol: string
  downloadClient: string
  estimatedCompletionTime?: string
  timeleft?: string
  size: number
  sizeleft: number
}

/**
 * Delete series request
 */
export interface DeleteSeriesRequest {
  deleteFiles?: boolean // Whether to delete files from disk
  addImportListExclusion?: boolean // Whether to add to import list exclusion
}

/**
 * Episode file resource from Sonarr API
 */
export interface EpisodeFileResource {
  id: number
  seriesId: number
  seasonNumber: number
  relativePath: string
  path: string
  size: number
  dateAdded: string
  releaseGroup?: string
  quality: {
    quality: {
      id: number
      name: string
      source: string
      resolution: number
    }
    revision: {
      version: number
      real: number
      isRepack: boolean
    }
  }
  mediaInfo?: {
    audioChannels: number
    audioCodec?: string
    audioLanguages?: string[]
    height: number
    width: number
    subtitles?: string[]
    videoCodec?: string
    videoDynamicRange?: string
    videoDynamicRangeType?: string
  }
  originalFilePath?: string
  sceneName?: string
  indexerFlags?: number
  languages: SonarrLanguage[]
}

/**
 * Get episode files request parameters
 */
export interface GetEpisodeFilesRequest {
  seriesId?: number
  seasonNumber?: number
  episodeFileIds?: number[]
}

/**
 * Delete episode file request parameters
 */
export interface DeleteEpisodeFileRequest {
  id: number
}

/**
 * Simplified downloading series information for status queries
 */
export interface DownloadingSeries {
  id: number
  seriesId?: number
  episodeId?: number
  seriesTitle?: string
  episodeTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  size: number
  sizeleft: number
  status: string
  trackedDownloadStatus?: string
  trackedDownloadState?: string
  protocol: string
  downloadClient?: string
  indexer?: string
  estimatedCompletionTime?: string
  timeleft?: string
  added?: string
  // Calculated fields
  progressPercent: number
  downloadedBytes: number
  isActive: boolean
}

/**
 * Enhanced series details for informational display
 */
export interface SeriesDetails {
  id: number
  title: string
  titleSlug: string
  sortTitle?: string
  overview?: string
  status: SonarrSeriesStatus
  ended: boolean
  network?: string
  airTime?: string
  certification?: string
  genres: string[]
  year: number
  firstAired?: string
  lastAired?: string
  runtime: number
  tvdbId: number
  tmdbId?: number
  imdbId?: string
  seriesType: SonarrSeriesType
  path: string
  monitored: boolean
  qualityProfileId: number
  seasonFolder: boolean
  added: string
  images: SonarrImage[]
  ratings: SonarrRatings
  // Enhanced statistics
  totalSeasons: number
  monitoredSeasons: number
  totalEpisodes: number
  availableEpisodes: number
  monitoredEpisodes: number
  downloadedEpisodes: number
  missingEpisodes: number
  totalSizeOnDisk: number
  completionPercentage: number
  seasons: SonarrSeason[]
  // Additional metadata
  isCompleted: boolean
  hasAllEpisodes: boolean
}

/**
 * Enhanced season details with episode information
 */
export interface SeasonDetails {
  seriesId: number
  seriesTitle: string
  seasonNumber: number
  monitored: boolean
  // Season statistics
  totalEpisodes: number
  availableEpisodes: number
  downloadedEpisodes: number
  missingEpisodes: number
  monitoredEpisodes: number
  sizeOnDisk: number
  completionPercentage: number
  // Episode breakdown
  episodes: {
    id: number
    episodeNumber: number
    title: string
    monitored: boolean
    hasFile: boolean
    airDate?: string
    overview?: string
    runtime?: number
    episodeFileId?: number
    fileSize?: number
    quality?: string
  }[]
  // Season metadata
  isCompleted: boolean
  hasAllEpisodes: boolean
}

/**
 * Enhanced episode details with file information
 */
export interface EpisodeDetails {
  id: number
  seriesId: number
  seasonNumber: number
  episodeNumber: number
  title: string
  monitored: boolean
  hasFile: boolean
  airDate?: string
  overview?: string
  runtime?: number
  absoluteEpisodeNumber?: number
  // Series information
  seriesTitle: string
  seriesYear: number
  seriesStatus: SonarrSeriesStatus
  // File information (if episode has file)
  episodeFile?: {
    id: number
    relativePath: string
    path: string
    size: number
    sizeFormatted: string
    dateAdded: string
    releaseGroup?: string
    quality: {
      name: string
      source: string
      resolution: number
    }
    mediaInfo?: {
      audioChannels: number
      audioCodec?: string
      height: number
      width: number
      videoCodec?: string
      subtitles?: string[]
    }
  }
  // Episode status
  isAvailable: boolean
  isMonitored: boolean
  isDownloaded: boolean
  isMissing: boolean
}
