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
 * Sonarr image information
 */
export interface SonarrImage extends ImageInfo {
  /** Usually a SonarrImageType value; Sonarr may send others (e.g. 'unknown') */
  coverType: string
  url?: string
  remoteUrl?: string
}

/**
 * Sonarr image type enum
 */
export enum SonarrImageType {
  UNKNOWN = 'unknown',
  POSTER = 'poster',
  BANNER = 'banner',
  FANART = 'fanart',
  SCREENSHOT = 'screenshot',
  HEADSHOT = 'headshot',
  CLEARLOGO = 'clearlogo',
}

/**
 * Sonarr ratings information (Sonarr v4 `Ratings`: a single aggregate rating)
 */
export interface SonarrRatings {
  votes: number
  value: number
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
 * The fields the bot changes when it updates a series. Of `seasons`, only each
 * season's `monitored` flag is applied (matched by `seasonNumber`); everything
 * else on the series goes back to Sonarr exactly as it was read.
 */
export type SonarrSeriesUpdate = Partial<
  Pick<SonarrSeries, 'monitored' | 'seasons'>
>

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
 * Options for unmonitoring and deleting series
 */
export interface UnmonitorSeriesOptions {
  selection?: Array<{ season: number; episodes?: number[] }> // If omitted, unmonitor entire series (delete)
  deleteFiles?: boolean // Whether to delete files (default: false for granular, true for full series)
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
  keptPacks?: KeptPackDownload[] // pack downloads left running (see below)
  warnings?: string[]
  error?: string
}

/**
 * A multi-episode download (season pack) that was deliberately NOT canceled.
 *
 * Sonarr's queue has one row per episode, and removing any row removes the
 * whole tracked download from the client. A pack is only canceled when every
 * episode it covers is being removed; otherwise it keeps downloading and is
 * reported here so the reply can say so.
 */
export interface KeptPackDownload {
  downloadId: string
  title?: string // release title
  coveredEpisodes: string // every episode in the pack, e.g. "S01E01–E10"
  unmonitoredEpisodes: string // the requested subset, e.g. "S01E03"
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
 * Simplified downloading series information for status queries
 */
export interface DownloadingSeries {
  id: number // queue id of the first row of the download
  downloadId?: string // shared by every row of a pack; absent while pending
  seriesId?: number
  episodeId?: number // only for single-episode downloads
  seriesTitle?: string
  episodeTitle?: string // only for single-episode downloads
  seasonNumber?: number // set when every covered episode is in one season
  episodeNumber?: number // only for single-episode downloads
  episodeCount: number // episodes covered by this download (1 unless a pack)
  episodeLabel: string // e.g. "S01E03" or "S01E01–E10"
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
