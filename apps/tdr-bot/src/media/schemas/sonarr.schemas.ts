import { z } from 'zod'

import {
  OptionalSearchQuerySchema,
  QualityProfileSchema,
  RootFolderSchema,
  SearchQuerySchema,
  SystemStatusSchema,
} from 'src/media/schemas/media.schemas'
import {
  SonarrImageType,
  SonarrMonitorType,
  SonarrSeriesStatus,
  SonarrSeriesType,
} from 'src/media/types/sonarr.types'

/**
 * Sonarr image schema
 */
export const SonarrImageSchema = z.object({
  coverType: z.nativeEnum(SonarrImageType),
  url: z.string().optional(),
  remoteUrl: z.string().optional(),
  path: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

/**
 * Sonarr ratings schema
 */
export const SonarrRatingsSchema = z.object({
  imdb: z
    .object({
      votes: z.number().int().nonnegative(),
      value: z.number().min(0).max(10),
      type: z.string(),
    })
    .optional(),
  theMovieDb: z
    .object({
      votes: z.number().int().nonnegative(),
      value: z.number().min(0).max(10),
      type: z.string(),
    })
    .optional(),
  rottenTomatoes: z
    .object({
      votes: z.number().int().nonnegative(),
      value: z.number().min(0).max(100),
      type: z.string(),
    })
    .optional(),
  tvdb: z
    .object({
      votes: z.number().int().nonnegative(),
      value: z.number().min(0).max(10),
      type: z.string(),
    })
    .optional(),
})

/**
 * Sonarr season statistics schema
 */
export const SonarrSeasonStatisticsSchema = z.object({
  episodeFileCount: z.number().int().nonnegative(),
  episodeCount: z.number().int().nonnegative(),
  totalEpisodeCount: z.number().int().nonnegative(),
  sizeOnDisk: z.number().int().nonnegative(),
  percentOfEpisodes: z.number().min(0).max(100),
})

/**
 * Sonarr season schema
 */
export const SonarrSeasonSchema = z.object({
  seasonNumber: z.number().int().nonnegative(),
  monitored: z.boolean(),
  statistics: SonarrSeasonStatisticsSchema.optional(),
})

/**
 * Sonarr series statistics schema
 */
export const SonarrSeriesStatisticsSchema = z.object({
  seasonCount: z.number().int().nonnegative(),
  episodeFileCount: z.number().int().nonnegative(),
  episodeCount: z.number().int().nonnegative(),
  totalEpisodeCount: z.number().int().nonnegative(),
  sizeOnDisk: z.number().int().nonnegative(),
  percentOfEpisodes: z.number().min(0).max(100),
})

/**
 * Sonarr alternate title schema
 */
export const SonarrAlternateTitleSchema = z.object({
  title: z.string(),
  seasonNumber: z.number().int().nonnegative().optional(),
  sceneSeasonNumber: z.number().int().nonnegative().optional(),
  sceneOrigin: z.string().optional(),
  comment: z.string().optional(),
})

/**
 * Sonarr series resource schema (API response)
 */
export const SonarrSeriesResourceSchema = z.object({
  id: z.number().int().optional(),
  title: z.string(),
  alternateTitles: z.array(SonarrAlternateTitleSchema).optional(),
  sortTitle: z.string().optional(),
  status: z.nativeEnum(SonarrSeriesStatus),
  ended: z.boolean(),
  profileName: z.string().optional(),
  overview: z.string().optional(),
  nextAiring: z.string().optional(),
  previousAiring: z.string().optional(),
  network: z.string().optional(),
  airTime: z.string().optional(),
  images: z.array(SonarrImageSchema),
  originalLanguage: z
    .object({
      id: z.number().int(),
      name: z.string(),
    })
    .optional(),
  remotePoster: z.string().optional(),
  seasons: z.array(SonarrSeasonSchema),
  year: z.number().int().min(1900).max(2100).optional(),
  path: z.string().optional(),
  qualityProfileId: z.number().int().optional(),
  languageProfileId: z.number().int().optional(),
  seasonFolder: z.boolean().optional(),
  monitored: z.boolean().optional(),
  useSceneNumbering: z.boolean().optional(),
  runtime: z.number().int().nonnegative().optional(),
  tvdbId: z.number().int(),
  tvRageId: z.number().int().optional(),
  tvMazeId: z.number().int().optional(),
  tmdbId: z.number().int().optional(),
  firstAired: z.string().optional(),
  lastAired: z.string().optional(),
  seriesType: z.nativeEnum(SonarrSeriesType).optional(),
  cleanTitle: z.string().optional(),
  imdbId: z.string().optional(),
  titleSlug: z.string().optional(),
  rootFolderPath: z.string().optional(),
  folder: z.string().optional(),
  certification: z.string().optional(),
  genres: z.array(z.string()),
  tags: z.array(z.number().int()).optional(),
  added: z.string().datetime().optional(),
  ratings: SonarrRatingsSchema.optional(),
  statistics: SonarrSeriesStatisticsSchema.optional(),
})

/**
 * Array of Sonarr series resources (for search results)
 */
export const SonarrSeriesResourceArraySchema = z.array(
  SonarrSeriesResourceSchema,
)

/**
 * Sonarr series schema (full series object from library)
 */
export const SonarrSeriesSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  alternateTitles: z.array(SonarrAlternateTitleSchema).optional(),
  sortTitle: z.string().optional(),
  status: z.nativeEnum(SonarrSeriesStatus),
  ended: z.boolean(),
  profileName: z.string().optional(),
  overview: z.string().optional(),
  nextAiring: z.string().optional(),
  previousAiring: z.string().optional(),
  network: z.string().optional(),
  airTime: z.string().optional(),
  images: z.array(SonarrImageSchema),
  originalLanguage: z
    .object({
      id: z.number().int(),
      name: z.string(),
    })
    .optional(),
  remotePoster: z.string().optional(),
  seasons: z.array(SonarrSeasonSchema),
  year: z.number().int().min(1900).max(2100),
  path: z.string(),
  qualityProfileId: z.number().int(),
  languageProfileId: z.number().int().optional(),
  seasonFolder: z.boolean(),
  monitored: z.boolean(),
  useSceneNumbering: z.boolean(),
  runtime: z.number().int().nonnegative(),
  tvdbId: z.number().int(),
  tvRageId: z.number().int().optional(),
  tvMazeId: z.number().int().optional(),
  tmdbId: z.number().int().optional(),
  firstAired: z.string().optional(),
  lastAired: z.string().optional(),
  seriesType: z.nativeEnum(SonarrSeriesType),
  cleanTitle: z.string(),
  imdbId: z.string().optional(),
  titleSlug: z.string(),
  rootFolderPath: z.string().optional(),
  folder: z.string().optional(),
  certification: z.string().optional(),
  genres: z.array(z.string()),
  tags: z.array(z.number().int()),
  added: z.string().datetime(),
  ratings: SonarrRatingsSchema,
  statistics: SonarrSeriesStatisticsSchema.optional(),
})

/**
 * Array of Sonarr series (for library listing)
 */
export const SonarrSeriesArraySchema = z.array(SonarrSeriesSchema)

/**
 * Series search result schema (simplified for public API)
 */
export const SeriesSearchResultSchema = z.object({
  tvdbId: z.number().int(),
  tmdbId: z.number().int().optional(),
  imdbId: z.string().optional(),
  title: z.string(),
  titleSlug: z.string(),
  sortTitle: z.string().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  firstAired: z.string().optional(),
  lastAired: z.string().optional(),
  overview: z.string().optional(),
  runtime: z.number().int().nonnegative().optional(),
  network: z.string().optional(),
  status: z.nativeEnum(SonarrSeriesStatus),
  seriesType: z.nativeEnum(SonarrSeriesType),
  seasons: z.array(SonarrSeasonSchema),
  genres: z.array(z.string()),
  rating: z.number().min(0).max(10).optional(),
  posterPath: z.string().optional(),
  backdropPath: z.string().optional(),
  certification: z.string().optional(),
  ended: z.boolean(),
})

/**
 * Array of series search results
 */
export const SeriesSearchResultArraySchema = z.array(SeriesSearchResultSchema)

/**
 * Library search result schema (extends SeriesSearchResult with library fields)
 */
export const LibrarySearchResultSchema = SeriesSearchResultSchema.extend({
  id: z.number().int(),
  monitored: z.boolean(),
  path: z.string(),
  statistics: SonarrSeriesStatisticsSchema.optional(),
  added: z.string().datetime(),
})

/**
 * Array of library search results
 */
export const LibrarySearchResultArraySchema = z.array(LibrarySearchResultSchema)

/**
 * Sonarr system status schema (alias of shared SystemStatusSchema)
 */
export const SonarrSystemStatusSchema = SystemStatusSchema

/**
 * Sonarr quality profile schema (alias of shared QualityProfileSchema)
 */
export const SonarrQualityProfileSchema = QualityProfileSchema

/**
 * Sonarr root folder schema (alias of shared RootFolderSchema)
 */
export const SonarrRootFolderSchema = RootFolderSchema

/**
 * Add series request schema
 */
export const AddSeriesRequestSchema = z.object({
  tvdbId: z.number().int(),
  title: z.string(),
  titleSlug: z.string(),
  qualityProfileId: z.number().int(),
  languageProfileId: z.number().int().optional(),
  rootFolderPath: z.string(),
  monitored: z.boolean(),
  monitor: z.nativeEnum(SonarrMonitorType),
  seasonFolder: z.boolean(),
  useSceneNumbering: z.boolean(),
  seriesType: z.nativeEnum(SonarrSeriesType),
  searchForMissingEpisodes: z.boolean(),
  searchForCutoffUnmetEpisodes: z.boolean(),
  images: z.array(SonarrImageSchema).optional(),
  seasons: z.array(SonarrSeasonSchema).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  firstAired: z.string().optional(),
  overview: z.string().optional(),
  network: z.string().optional(),
  airTime: z.string().optional(),
  certification: z.string().optional(),
  genres: z.array(z.string()).optional(),
  tags: z.array(z.number().int()).optional(),
})

/**
 * Command request schema
 */
export const SonarrCommandRequestSchema = z.object({
  name: z.string(),
  seriesIds: z.array(z.number().int()).optional(),
  seriesId: z.number().int().optional(),
})

/**
 * Command response schema
 */
export const SonarrCommandResponseSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  commandName: z.string(),
  message: z.string().optional(),
  body: z.object({
    seriesIds: z.array(z.number().int()).optional(),
    seriesId: z.number().int().optional(),
    sendUpdatesToClient: z.boolean(),
    updateScheduledTask: z.boolean(),
    completionMessage: z.string(),
    requiresDiskAccess: z.boolean(),
    isExclusive: z.boolean(),
    isTypeExclusive: z.boolean(),
    isLongRunning: z.boolean(),
    name: z.string(),
    trigger: z.string(),
  }),
  priority: z.string(),
  status: z.string(),
  queued: z.string(),
  started: z.string().optional(),
  ended: z.string().optional(),
  duration: z.string().optional(),
  exception: z.string().optional(),
  trigger: z.string(),
  clientUserAgent: z.string().optional(),
  stateChangeTime: z.string().optional(),
  sendUpdatesToClient: z.boolean(),
  updateScheduledTask: z.boolean(),
  lastExecutionTime: z.string().optional(),
})

/**
 * Sonarr error response schema
 */
export const SonarrErrorResponseSchema = z.object({
  message: z.string(),
  description: z.string().optional(),
  details: z.string().optional(),
})

/**
 * Episode resource schema
 */
export const EpisodeResourceSchema = z.object({
  id: z.number().int(),
  seriesId: z.number().int(),
  seasonNumber: z.number().int().nonnegative(),
  episodeNumber: z.number().int().positive(),
  title: z.string(),
  monitored: z.boolean(),
  hasFile: z.boolean(),
  airDate: z.string().optional(),
  overview: z.string().optional(),
  runtime: z.number().int().nonnegative().optional(),
  episodeFileId: z.number().int().optional(),
  absoluteEpisodeNumber: z.number().int().optional(),
})

/**
 * Season/Episode selection schema
 */
export const SeasonEpisodeSelectionSchema = z.object({
  season: z.number().int().nonnegative(),
  episodes: z.array(z.number().int().positive()).optional(),
})

/**
 * Monitor series options schema
 */
export const MonitorSeriesOptionsSchema = z.object({
  selection: z.array(SeasonEpisodeSelectionSchema).optional(),
})

/**
 * Unmonitor series options schema
 */
export const UnmonitorSeriesOptionsSchema = z.object({
  selection: z.array(SeasonEpisodeSelectionSchema).optional(),
  deleteFiles: z.boolean().optional(),
})

/**
 * Monitoring change schema
 */
export const MonitoringChangeSchema = z.object({
  season: z.number().int().nonnegative(),
  episodes: z.array(z.number().int().positive()).optional(),
  action: z.enum(['monitored', 'unmonitored']),
})

/**
 * Unmonitoring change schema
 */
export const UnmonitoringChangeSchema = z.object({
  season: z.number().int().nonnegative(),
  episodes: z.array(z.number().int().positive()).optional(),
  action: z.enum([
    'unmonitored',
    'deleted_series',
    'deleted_episodes',
    'deleted_files',
    'unmonitored_season',
  ]),
})

/**
 * Monitor and download series result schema
 */
export const MonitorAndDownloadSeriesResultSchema = z.object({
  success: z.boolean(),
  seriesAdded: z.boolean(),
  seriesUpdated: z.boolean(),
  searchTriggered: z.boolean(),
  changes: z.array(MonitoringChangeSchema),
  series: SonarrSeriesSchema.optional(),
  commandId: z.number().int().optional(),
  warnings: z.array(z.string()).optional(),
  error: z.string().optional(),
})

/**
 * Unmonitor and delete series result schema
 */
export const UnmonitorAndDeleteSeriesResultSchema = z.object({
  success: z.boolean(),
  seriesDeleted: z.boolean(),
  episodesUnmonitored: z.boolean(),
  downloadsCancel: z.boolean(),
  canceledDownloads: z.number().int().nonnegative(),
  changes: z.array(UnmonitoringChangeSchema),
  series: SonarrSeriesSchema.optional(),
  commandIds: z.array(z.number().int()).optional(),
  warnings: z.array(z.string()).optional(),
  error: z.string().optional(),
})

/**
 * Update episode request schema
 */
export const UpdateEpisodeRequestSchema = z.object({
  monitored: z.boolean(),
})

/**
 * Bulk episode update request schema
 */
export const BulkEpisodeUpdateRequestSchema = z.object({
  episodeIds: z.array(z.number().int()),
  monitored: z.boolean(),
})

/**
 * Bulk episode monitor request schema (for /episode/monitor endpoint)
 */
export const BulkEpisodeMonitorRequestSchema = z.object({
  episodeIds: z.array(z.number().int().positive()),
  monitored: z.boolean(),
})

/**
 * Sonarr queue item schema
 */
export const SonarrQueueItemSchema = z.object({
  id: z.number().int(),
  seriesId: z.number().int(),
  episodeId: z.number().int().optional(),
  title: z.string(),
  series: z.object({
    id: z.number().int(),
    title: z.string(),
    tvdbId: z.number().int(),
  }),
  episode: z
    .object({
      id: z.number().int(),
      episodeNumber: z.number().int().positive(),
      seasonNumber: z.number().int().nonnegative(),
      title: z.string(),
    })
    .optional(),
  status: z.string(),
  trackedDownloadStatus: z.string(),
  protocol: z.string(),
  downloadClient: z.string(),
  estimatedCompletionTime: z.string().optional(),
  timeleft: z.string().optional(),
  size: z.number().int().nonnegative(),
  sizeleft: z.number().int().nonnegative(),
})

/**
 * Delete series request schema
 */
export const DeleteSeriesRequestSchema = z.object({
  deleteFiles: z.boolean().optional(),
  addImportListExclusion: z.boolean().optional(),
})

/**
 * Downloading series schema (simplified for status queries)
 */
export const DownloadingSeriesSchema = z.object({
  id: z.number().int(),
  seriesId: z.number().int().optional(),
  episodeId: z.number().int().optional(),
  seriesTitle: z.string().optional(),
  episodeTitle: z.string().optional(),
  seasonNumber: z.number().int().nonnegative().optional(),
  episodeNumber: z.number().int().positive().optional(),
  size: z.number().int().nonnegative(),
  sizeleft: z.number().int().nonnegative(),
  status: z.string(),
  trackedDownloadStatus: z.string().optional(),
  trackedDownloadState: z.string().optional(),
  protocol: z.string(),
  downloadClient: z.string().optional(),
  indexer: z.string().optional(),
  estimatedCompletionTime: z.string().optional(),
  timeleft: z.string().optional(),
  added: z.string().optional(),
  // Calculated fields
  progressPercent: z.number().min(0).max(100),
  downloadedBytes: z.number().int().nonnegative(),
  isActive: z.boolean(),
})

/**
 * Enhanced series details schema
 */
export const SeriesDetailsSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  titleSlug: z.string(),
  sortTitle: z.string().optional(),
  overview: z.string().optional(),
  status: z.nativeEnum(SonarrSeriesStatus),
  ended: z.boolean(),
  network: z.string().optional(),
  airTime: z.string().optional(),
  certification: z.string().optional(),
  genres: z.array(z.string()),
  year: z.number().int().min(1900).max(2100),
  firstAired: z.string().optional(),
  lastAired: z.string().optional(),
  runtime: z.number().int().nonnegative(),
  tvdbId: z.number().int(),
  tmdbId: z.number().int().optional(),
  imdbId: z.string().optional(),
  seriesType: z.nativeEnum(SonarrSeriesType),
  path: z.string(),
  monitored: z.boolean(),
  qualityProfileId: z.number().int(),
  seasonFolder: z.boolean(),
  added: z.string().datetime(),
  images: z.array(SonarrImageSchema),
  ratings: SonarrRatingsSchema,
  // Enhanced statistics
  totalSeasons: z.number().int().nonnegative(),
  monitoredSeasons: z.number().int().nonnegative(),
  totalEpisodes: z.number().int().nonnegative(),
  availableEpisodes: z.number().int().nonnegative(),
  monitoredEpisodes: z.number().int().nonnegative(),
  downloadedEpisodes: z.number().int().nonnegative(),
  missingEpisodes: z.number().int().nonnegative(),
  totalSizeOnDisk: z.number().int().nonnegative(),
  completionPercentage: z.number().min(0).max(100),
  seasons: z.array(SonarrSeasonSchema),
  // Additional metadata
  isCompleted: z.boolean(),
  hasAllEpisodes: z.boolean(),
})

/**
 * Enhanced season details schema
 */
export const SeasonDetailsSchema = z.object({
  seriesId: z.number().int(),
  seriesTitle: z.string(),
  seasonNumber: z.number().int().nonnegative(),
  monitored: z.boolean(),
  // Season statistics
  totalEpisodes: z.number().int().nonnegative(),
  availableEpisodes: z.number().int().nonnegative(),
  downloadedEpisodes: z.number().int().nonnegative(),
  missingEpisodes: z.number().int().nonnegative(),
  monitoredEpisodes: z.number().int().nonnegative(),
  sizeOnDisk: z.number().int().nonnegative(),
  completionPercentage: z.number().min(0).max(100),
  // Episode breakdown
  episodes: z.array(
    z.object({
      id: z.number().int(),
      episodeNumber: z.number().int().positive(),
      title: z.string(),
      monitored: z.boolean(),
      hasFile: z.boolean(),
      airDate: z.string().optional(),
      overview: z.string().optional(),
      runtime: z.number().int().nonnegative().optional(),
      episodeFileId: z.number().int().optional(),
      fileSize: z.number().int().nonnegative().optional(),
      quality: z.string().optional(),
    }),
  ),
  // Season metadata
  isCompleted: z.boolean(),
  hasAllEpisodes: z.boolean(),
})

/**
 * Enhanced episode details schema
 */
export const EpisodeDetailsSchema = z.object({
  id: z.number().int(),
  seriesId: z.number().int(),
  seasonNumber: z.number().int().nonnegative(),
  episodeNumber: z.number().int().positive(),
  title: z.string(),
  monitored: z.boolean(),
  hasFile: z.boolean(),
  airDate: z.string().optional(),
  overview: z.string().optional(),
  runtime: z.number().int().nonnegative().optional(),
  absoluteEpisodeNumber: z.number().int().optional(),
  // Series information
  seriesTitle: z.string(),
  seriesYear: z.number().int().min(1900).max(2100),
  seriesStatus: z.nativeEnum(SonarrSeriesStatus),
  // File information
  episodeFile: z
    .object({
      id: z.number().int(),
      relativePath: z.string(),
      path: z.string(),
      size: z.number().int().nonnegative(),
      sizeFormatted: z.string(),
      dateAdded: z.string().datetime(),
      releaseGroup: z.string().optional(),
      quality: z.object({
        name: z.string(),
        source: z.string(),
        resolution: z.number().int(),
      }),
      mediaInfo: z
        .object({
          audioChannels: z.number().int().nonnegative(),
          audioCodec: z.string().optional(),
          height: z.number().int().positive().optional(),
          width: z.number().int().positive().optional(),
          videoCodec: z.string().optional(),
          subtitles: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  // Episode status
  isAvailable: z.boolean(),
  isMonitored: z.boolean(),
  isDownloaded: z.boolean(),
  isMissing: z.boolean(),
})

/**
 * Input validation schemas for public methods
 */
export const SonarrInputSchemas = {
  searchQuery: SearchQuerySchema,
  optionalSearchQuery: OptionalSearchQuerySchema,
  addSeriesRequest: AddSeriesRequestSchema,
  commandRequest: SonarrCommandRequestSchema,
  monitorSeriesOptions: MonitorSeriesOptionsSchema,
  unmonitorSeriesOptions: UnmonitorSeriesOptionsSchema,
  updateEpisodeRequest: UpdateEpisodeRequestSchema,
  bulkEpisodeUpdateRequest: BulkEpisodeUpdateRequestSchema,
  bulkEpisodeMonitorRequest: BulkEpisodeMonitorRequestSchema,
  deleteSeriesRequest: DeleteSeriesRequestSchema,
} as const

/**
 * Output validation schemas for API responses
 */
export const SonarrOutputSchemas = {
  series: SonarrSeriesSchema,
  seriesArray: SonarrSeriesArraySchema,
  seriesResource: SonarrSeriesResourceSchema,
  seriesResourceArray: SonarrSeriesResourceArraySchema,
  seriesSearchResult: SeriesSearchResultSchema,
  seriesSearchResultArray: SeriesSearchResultArraySchema,
  librarySearchResult: LibrarySearchResultSchema,
  librarySearchResultArray: LibrarySearchResultArraySchema,
  qualityProfile: SonarrQualityProfileSchema,
  qualityProfileArray: z.array(SonarrQualityProfileSchema),
  rootFolder: SonarrRootFolderSchema,
  rootFolderArray: z.array(SonarrRootFolderSchema),
  addSeriesResponse: SonarrSeriesResourceSchema,
  commandResponse: SonarrCommandResponseSchema,
  errorResponse: SonarrErrorResponseSchema,
  episodeResource: EpisodeResourceSchema,
  episodeResourceArray: z.array(EpisodeResourceSchema),
  queueItem: SonarrQueueItemSchema,
  queueItemArray: z.array(SonarrQueueItemSchema),
  downloadingSeries: DownloadingSeriesSchema,
  downloadingSeriesArray: z.array(DownloadingSeriesSchema),
  monitorAndDownloadSeriesResult: MonitorAndDownloadSeriesResultSchema,
  unmonitorAndDeleteSeriesResult: UnmonitorAndDeleteSeriesResultSchema,
} as const

/**
 * Type inference helpers (only exported types with active consumers)
 */
export type { SearchQueryInput } from 'src/media/schemas/media.schemas'
export type MonitorSeriesOptionsInput = z.infer<
  typeof MonitorSeriesOptionsSchema
>
export type UnmonitorSeriesOptionsInput = z.infer<
  typeof UnmonitorSeriesOptionsSchema
>
