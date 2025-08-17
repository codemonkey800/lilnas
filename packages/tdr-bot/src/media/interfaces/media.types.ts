import {
  MediaStatusType,
  MediaType,
  QueueStatusType,
  TrackedDownloadStateType,
  TrackedDownloadStatusType,
} from './enums'

export interface MediaItem {
  readonly id: number | string
  readonly title: string
  readonly overview?: string
  readonly year?: number
  readonly posterPath?: string
  readonly backdropPath?: string
  readonly imdbId?: string
  readonly tmdbId?: number
  readonly tvdbId?: number
  readonly status: MediaStatusType
  monitored: boolean
  readonly added: Date
  readonly sortTitle: string
  qualityProfileId: number
  readonly path?: string
  readonly sizeOnDisk?: number
  tags: number[]
}

export interface MovieItem extends MediaItem {
  type: MediaType.MOVIE
  runtime?: number
  certification?: string
  genres: string[]
  studio?: string
  website?: string
  youTubeTrailerId?: string
  physicalRelease?: Date
  digitalRelease?: Date
  inCinemas?: Date
  minimumAvailability: 'announced' | 'inCinemas' | 'released' | 'preDB'
  hasFile: boolean
  movieFile?: MovieFile
}

export interface SeriesItem extends MediaItem {
  type: MediaType.SERIES
  network?: string
  airTime?: string
  seriesType: 'standard' | 'daily' | 'anime'
  seasonCount: number
  totalEpisodeCount: number
  episodeCount: number
  episodeFileCount: number
  ended: boolean
  firstAired?: Date
  nextAiring?: Date
  previousAiring?: Date
  seasons: Season[]
  languageProfileId: number
  useSeasonFolders: boolean
}

export interface Season {
  seasonNumber: number
  monitored: boolean
  statistics?: SeasonStatistics
}

export interface SeasonStatistics {
  episodeFileCount: number
  episodeCount: number
  totalEpisodeCount: number
  sizeOnDisk: number
  releaseGroups: string[]
  percentOfEpisodes: number
}

export interface MovieFile {
  id: number
  movieId: number
  relativePath: string
  path: string
  size: number
  dateAdded: Date
  sceneName?: string
  releaseGroup?: string
  quality: QualityInfo
  mediaInfo: MediaInfo
  originalFilePath?: string
}

export interface EpisodeFile {
  id: number
  seriesId: number
  seasonNumber: number
  relativePath: string
  path: string
  size: number
  dateAdded: Date
  sceneName?: string
  releaseGroup?: string
  quality: QualityInfo
  mediaInfo: MediaInfo
  qualityCutoffNotMet: boolean
}

export interface MediaInfo {
  audioChannels: number
  audioCodec?: string
  audioLanguages?: string[]
  height: number
  width: number
  resolution: string
  runTime: string
  scanType?: string
  subtitles?: string[]
  videoCodec?: string
  videoDynamicRange?: string
  videoDynamicRangeType?: string
}

export interface QualityInfo {
  quality: Quality
  revision: QualityRevision
}

export interface Quality {
  id: number
  name: string
  source: string
  resolution: number
}

export interface QualityRevision {
  version: number
  real: number
  isRepack: boolean
}

export interface QualityProfile {
  id: number
  name: string
  upgradeAllowed: boolean
  cutoff: number
  items: QualityProfileItem[]
  minFormatScore: number
  cutoffFormatScore: number
  formatItems: FormatItem[]
  language?: LanguageProfile
}

export interface QualityProfileItem {
  id?: number
  name?: string
  quality?: Quality
  items?: QualityProfileItem[]
  allowed: boolean
}

export interface FormatItem {
  format: number
  name: string
  score: number
}

export interface LanguageProfile {
  id: number
  name: string
}

export interface MediaRequest {
  type: MediaType
  searchTerm: string
  tmdbId?: number
  imdbId?: string
  tvdbId?: number
  qualityProfileId: number
  rootFolderPath: string
  monitored: boolean
  seasonFolder?: boolean
  tags?: number[]
  addOptions?: AddOptions
  episodeSpecification?: EpisodeSpecification
  correlationId: string
  userId: string
  guildId: string
  channelId: string
  requestedAt: Date
}

export interface AddOptions {
  ignoreEpisodesWithFiles?: boolean
  ignoreEpisodesWithoutFiles?: boolean
  monitor?:
    | 'all'
    | 'future'
    | 'missing'
    | 'existing'
    | 'pilot'
    | 'firstSeason'
    | 'lastSeason'
    | 'monitorSpecials'
    | 'unmonitor'
    | 'skip'
  searchForMovie?: boolean
  searchForCutoffUnmetEpisodes?: boolean
}

export interface EpisodeSpecification {
  seasons?: number[]
  episodes?: EpisodeRange[]
  specificationString: string
}

export interface EpisodeRange {
  seasonNumber: number
  episodeStart: number
  episodeEnd: number
}

export interface SearchResult<T = MovieSearchResult | SeriesSearchResult> {
  title: string
  overview?: string
  year?: number
  tmdbId?: number
  imdbId?: string
  tvdbId?: number
  posterPath?: string
  monitored?: boolean
  hasFile?: boolean
  inLibrary?: boolean
  folder?: string
  data: T
}

export interface MovieSearchResult {
  title: string
  originalTitle: string
  originalLanguage: string
  overview: string
  status: 'released' | 'inProduction' | 'postProduction' | 'announced'
  inCinemas?: Date
  physicalRelease?: Date
  digitalRelease?: Date
  runtime: number
  website?: string
  youTubeTrailerId?: string
  studio?: string
  qualityProfileId: number
  tmdbId: number
  imdbId?: string
  year: number
  certification?: string
  genres: string[]
  tags: number[]
  images: MediaImage[]
  remotePoster?: string
  folder?: string
}

export interface SeriesSearchResult {
  title: string
  sortTitle: string
  status: 'continuing' | 'ended' | 'upcoming' | 'deleted'
  ended: boolean
  overview: string
  network?: string
  airTime?: string
  images: MediaImage[]
  remotePoster?: string
  seasons: SearchSeason[]
  year: number
  qualityProfileId: number
  languageProfileId: number
  seasonFolder: boolean
  monitored: boolean
  useSeasonFolders: boolean
  runtime: number
  tvdbId?: number
  tvRageId?: number
  tvMazeId?: number
  tmdbId?: number
  firstAired?: Date
  lastInfoSync?: Date
  seriesType: 'standard' | 'daily' | 'anime'
  cleanTitle: string
  imdbId?: string
  titleSlug: string
  certification?: string
  genres: string[]
  tags: number[]
  added: Date
  ratings: Rating
  folder?: string
}

export interface SearchSeason {
  seasonNumber: number
  monitored: boolean
}

export interface MediaImage {
  coverType:
    | 'poster'
    | 'banner'
    | 'fanart'
    | 'screenshot'
    | 'headshot'
    | 'clearlogo'
  url: string
  remoteUrl: string
}

export interface Rating {
  votes: number
  value: number
}

export interface RootFolder {
  id: number
  path: string
  accessible: boolean
  freeSpace: number
  unmappedFolders: UnmappedFolder[]
}

export interface UnmappedFolder {
  name: string
  path: string
}

export interface DiskSpace {
  path: string
  label: string
  freeSpace: number
  totalSpace: number
}

export interface QueueItem {
  id: number
  downloadId?: string
  title: string
  size: number
  sizeleft: number
  timeleft: string
  estimatedCompletionTime?: Date
  added?: Date
  status:
    | 'queued'
    | 'paused'
    | 'downloading'
    | 'downloadClientUnavailable'
    | 'completed'
    | 'failed'
  trackedDownloadStatus: 'ok' | 'warning' | 'error'
  trackedDownloadState:
    | 'importing'
    | 'importPending'
    | 'downloading'
    | 'downloadFailed'
    | 'downloadFailedPending'
    | 'importFailed'
    | 'importFailedPending'
    | 'ignored'
  statusMessages: StatusMessage[]
  downloadClient?: string
  downloadClientHasPostImportCategory?: boolean
  errorMessage?: string
  indexer?: string
  outputPath?: string
  episodeHasFile?: boolean
  movieHasFile?: boolean
}

export interface StatusMessage {
  title: string
  messages: string[]
}

export interface SystemStatus {
  appName: string
  instanceName: string
  version: string
  buildTime: Date
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
  mode: string
  branch: string
  authentication: string
  sqliteVersion: string
  migrationVersion: number
  urlBase?: string
  runtimeVersion: string
  runtimeName: string
  startTime: Date
  packageVersion: string
  packageAuthor: string
  packageUpdateMechanism: string
}

export interface Tag {
  id: number
  label: string
}

export interface MediaStatus {
  readonly id: number
  readonly downloadId?: string
  readonly title: string
  readonly status: QueueStatusType
  readonly trackedDownloadStatus: TrackedDownloadStatusType
  readonly trackedDownloadState: TrackedDownloadStateType
  readonly size: number
  readonly sizeleft: number
  readonly percentage: number
  readonly timeleft: string
  readonly eta?: Date
  readonly added?: Date
  readonly estimatedCompletionTime?: Date
  readonly statusMessages: StatusMessage[]
  readonly downloadClient?: string
  readonly errorMessage?: string
  readonly indexer?: string
  readonly outputPath?: string
}

export interface StorageMetrics {
  readonly path: string
  readonly label: string
  readonly freeSpace: number
  readonly totalSpace: number
  readonly usedSpace: number
  readonly percentUsed: number
  readonly accessible: boolean
}

export interface MediaFileInfo {
  readonly id: number
  readonly relativePath: string
  readonly path: string
  readonly size: number
  readonly dateAdded: Date
  readonly sceneName?: string
  readonly releaseGroup?: string
  readonly quality: QualityInfo
  readonly mediaInfo: MediaInfo
}

export interface EmbyItem {
  Id: string
  Name: string
  ServerId: string
  Etag: string
  DateCreated: Date
  CanDelete: boolean
  CanDownload: boolean
  PresentationUniqueKey: string
  SortName: string
  ForcedSortName: string
  RunTimeTicks?: number
  ProductionYear?: number
  IsFolder: boolean
  Type: string
  UserData?: EmbyUserData
  PrimaryImageAspectRatio?: number
  VideoType?: string
  LocationType: string
  MediaType?: string
  Width?: number
  Height?: number
  CameraMake?: string
  CameraModel?: string
  Software?: string
  Overview?: string
  Taglines?: string[]
  Genres?: string[]
  CommunityRating?: number
  VoteCount?: number
  PlayAccess: string
  RemoteTrailers?: EmbyTrailer[]
  ProviderIds?: { [key: string]: string }
  IsHD?: boolean
  IsShortcut?: boolean
  ShortcutPath?: string
  ParentLogoItemId?: string
  ParentBackdropItemId?: string
  ParentBackdropImageTags?: string[]
  LocalTrailerCount?: number
  SeriesName?: string
  SeriesId?: string
  SeasonId?: string
  SpecialFeatureCount?: number
  DisplayPreferencesId?: string
  Tags?: string[]
  SeriesPrimaryImageAspectRatio?: number
  SeasonName?: string
  MediaStreams?: EmbyMediaStream[]
  ImageTags?: { [key: string]: string }
  BackdropImageTags?: string[]
  ScreenshotImageTags?: string[]
  ParentLogoImageTag?: string
  ParentArtItemId?: string
  ParentArtImageTag?: string
  SeriesThumbImageTag?: string
  ImageBlurHashes?: { [key: string]: { [key: string]: string } }
  SeriesStudio?: string
  ParentThumbItemId?: string
  ParentThumbImageTag?: string
  ParentPrimaryImageItemId?: string
  ParentPrimaryImageTag?: string
  Chapters?: EmbyChapter[]
}

export interface EmbyUserData {
  PlaybackPositionTicks: number
  PlayCount: number
  IsFavorite: boolean
  LastPlayedDate?: Date
  Played: boolean
  Key?: string
}

export interface EmbyTrailer {
  Url: string
  Name: string
}

export interface EmbyMediaStream {
  Codec: string
  TimeBase: string
  CodecTimeBase: string
  VideoRange: string
  DisplayTitle: string
  IsInterlaced: boolean
  BitRate?: number
  BitDepth?: number
  RefFrames?: number
  IsDefault: boolean
  IsForced: boolean
  Height?: number
  Width?: number
  AverageFrameRate?: number
  RealFrameRate?: number
  Profile: string
  Type: string
  AspectRatio: string
  Index: number
  IsExternal: boolean
  IsTextSubtitleStream: boolean
  SupportsExternalStream: boolean
  Protocol: string
  PixelFormat: string
  Level: number
  IsAnamorphic?: boolean
  Language?: string
  Title?: string
  Disposition?: { [key: string]: number }
}

export interface EmbyChapter {
  StartPositionTicks: number
  Name: string
  ImagePath: string
  ImageDateModified: Date
}

export interface EmbySearchResult {
  SearchHints: EmbySearchHint[]
  TotalRecordCount: number
}

export interface EmbySearchHint {
  ItemId: string
  Id: string
  Name: string
  MatchedTerm: string
  IndexNumber?: number
  ProductionYear?: number
  ParentIndexNumber?: number
  PrimaryImageTag?: string
  ThumbImageTag?: string
  ThumbImageItemId?: string
  BackdropImageTag?: string
  BackdropImageItemId?: string
  Type: string
  IsFolder?: boolean
  RunTimeTicks?: number
  MediaType: string
  StartDate?: Date
  EndDate?: Date
  Series?: string
  Status?: string
  Album?: string
  AlbumId?: string
  AlbumArtist?: string
  Artists?: string[]
  SongCount?: number
  EpisodeCount?: number
  ChannelId?: string
  ChannelName?: string
  PrimaryImageAspectRatio?: number
  SeriesThumbImageTag?: string
  SeriesThumbImageItemId?: string
  ImageTags?: { [key: string]: string }
}
