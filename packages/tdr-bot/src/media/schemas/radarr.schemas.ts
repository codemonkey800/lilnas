import { z } from 'zod'

import {
  DownloadProtocol,
  RadarrImageType,
  RadarrMinimumAvailability,
  RadarrMovieStatus,
  RadarrPathState,
  RadarrQueueStatus,
  TrackedDownloadState,
  TrackedDownloadStatus,
} from 'src/media/types/radarr.types'

/**
 * Search query input validation schema
 */
export const SearchQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(2, 'Search query must be at least 2 characters')
    .max(200, 'Search query must be less than 200 characters'),
})

/**
 * Radarr image schema
 */
export const RadarrImageSchema = z.object({
  coverType: z.nativeEnum(RadarrImageType),
  url: z.string().optional(),
  remoteUrl: z.string().optional(),
  path: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

/**
 * Radarr ratings schema
 */
export const RadarrRatingsSchema = z.object({
  imdb: z
    .object({
      votes: z.number().int().nonnegative(),
      value: z.number().min(0).max(10),
      type: z.string(),
    })
    .optional(),
  tmdb: z
    .object({
      votes: z.number().int().nonnegative(),
      value: z.number().min(0).max(10),
      type: z.string(),
    })
    .optional(),
  metacritic: z
    .object({
      votes: z.number().int().nonnegative(),
      value: z.number().min(0).max(100),
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
})

/**
 * Radarr quality schema
 */
export const RadarrQualitySchema = z.object({
  quality: z.object({
    id: z.number().int(),
    name: z.string(),
    source: z.string(),
    resolution: z.number().int().nonnegative(),
    modifier: z.string(),
  }),
  revision: z.object({
    version: z.number().int().nonnegative(),
    real: z.number().int().nonnegative(),
    isRepack: z.boolean(),
  }),
})

/**
 * Radarr custom format schema
 */
export const RadarrCustomFormatSchema = z.object({
  id: z.number().int(),
  name: z.string(),
})

/**
 * Radarr media info schema
 */
export const RadarrMediaInfoSchema = z.object({
  audioChannels: z.number().positive().optional(), // Allow float values
  audioCodec: z.string().optional(),
  audioLanguages: z.string().optional(),
  height: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  resolution: z.string().optional(),
  runTime: z.string().optional(),
  scanType: z.string().optional(),
  subtitles: z.string().optional(),
  videoCodec: z.string().optional(),
  videoDynamicRange: z.string().optional(),
  videoDynamicRangeType: z.string().optional(),
})

/**
 * Radarr movie file schema
 */
export const RadarrMovieFileSchema = z.object({
  id: z.number().int(),
  movieId: z.number().int(),
  relativePath: z.string(),
  path: z.string(),
  size: z.number().int().nonnegative(),
  dateAdded: z.string().datetime(),
  sceneName: z.string().optional(),
  indexerFlags: z.number().int().nonnegative(),
  quality: RadarrQualitySchema,
  customFormats: z.array(RadarrCustomFormatSchema).optional(),
  mediaInfo: RadarrMediaInfoSchema.optional(),
  originalFilePath: z.string().optional(),
  qualityCutoffNotMet: z.boolean(),
})

/**
 * Radarr collection schema
 */
export const RadarrCollectionSchema = z.object({
  id: z.number().int().optional(),
  title: z.string().optional(),
  overview: z.string().optional(),
  monitored: z.boolean().optional(),
  rootFolderPath: z.string().optional(),
  qualityProfileId: z.number().int().optional(),
  searchOnAdd: z.boolean().optional(),
  minimumAvailability: z.nativeEnum(RadarrMinimumAvailability).optional(),
  images: z.array(RadarrImageSchema).optional(),
  added: z.string().datetime().optional(),
  tmdbId: z.number().int().optional(),
  tags: z.array(z.number().int()).optional(),
})

/**
 * Radarr movie resource schema (API response)
 */
export const RadarrMovieResourceSchema = z.object({
  id: z.number().int().optional(),
  title: z.string(),
  originalTitle: z.string().optional(),
  originalLanguage: z
    .object({
      id: z.number().int(),
      name: z.string(),
    })
    .optional(),
  secondaryYear: z.number().int().optional(),
  secondaryYearSourceId: z.number().int().optional(),
  sortTitle: z.string().optional(),
  sizeOnDisk: z.number().int().nonnegative().optional(),
  status: z.nativeEnum(RadarrMovieStatus),
  overview: z.string().optional(),
  inCinemas: z.string().optional(),
  physicalRelease: z.string().optional(),
  digitalRelease: z.string().optional(),
  images: z.array(RadarrImageSchema),
  website: z.string().url().or(z.literal('')).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  hasFile: z.boolean().optional(),
  youTubeTrailerId: z.string().optional(),
  studio: z.string().optional(),
  path: z.string().optional(),
  pathState: z.nativeEnum(RadarrPathState).optional(),
  monitored: z.boolean().optional(),
  minimumAvailability: z.nativeEnum(RadarrMinimumAvailability).optional(),
  isAvailable: z.boolean().optional(),
  folderName: z.string().optional(),
  runtime: z.number().int().nonnegative().optional(),
  cleanTitle: z.string().optional(),
  imdbId: z.string().optional(),
  tmdbId: z.number().int(),
  titleSlug: z.string().optional(),
  certification: z.string().optional(),
  genres: z.array(z.string()),
  tags: z.array(z.number().int()).optional(),
  added: z.string().datetime().optional(),
  ratings: RadarrRatingsSchema.optional(),
  qualityProfileId: z.number().int().optional(),
  movieFile: RadarrMovieFileSchema.optional(),
  collection: RadarrCollectionSchema.optional(),
  popularity: z.number().nonnegative().optional(),
  folder: z.string().optional(),
  rootFolderPath: z.string().optional(),
})

/**
 * Array of Radarr movie resources (for search results)
 */
export const RadarrMovieResourceArraySchema = z.array(RadarrMovieResourceSchema)

/**
 * Radarr movie schema (full movie object from library)
 */
export const RadarrMovieSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  originalTitle: z.string().optional(),
  originalLanguage: z
    .object({
      id: z.number().int(),
      name: z.string(),
    })
    .optional(),
  secondaryYear: z.number().int().optional(),
  secondaryYearSourceId: z.number().int().optional(),
  sortTitle: z.string().optional(),
  sizeOnDisk: z.number().int().nonnegative().optional(),
  status: z.nativeEnum(RadarrMovieStatus),
  overview: z.string().optional(),
  inCinemas: z.string().optional(),
  physicalRelease: z.string().optional(),
  digitalRelease: z.string().optional(),
  images: z.array(RadarrImageSchema),
  website: z.string().url().or(z.literal('')).optional(),
  year: z.number().int().min(1900).max(2100),
  hasFile: z.boolean(),
  youTubeTrailerId: z.string().optional(),
  studio: z.string().optional(),
  path: z.string(),
  pathState: z.nativeEnum(RadarrPathState).optional(),
  monitored: z.boolean(),
  minimumAvailability: z.nativeEnum(RadarrMinimumAvailability),
  isAvailable: z.boolean(),
  folderName: z.string().optional(),
  runtime: z.number().int().nonnegative(),
  cleanTitle: z.string(),
  imdbId: z.string().optional(),
  tmdbId: z.number().int(),
  titleSlug: z.string(),
  certification: z.string().optional(),
  genres: z.array(z.string()),
  tags: z.array(z.number().int()),
  added: z.string().datetime(),
  ratings: RadarrRatingsSchema,
  qualityProfileId: z.number().int(),
  movieFile: RadarrMovieFileSchema.optional(),
  collection: RadarrCollectionSchema.optional(),
  popularity: z.number().nonnegative().optional(),
})

/**
 * Array of Radarr movies (for library listing)
 */
export const RadarrMovieArraySchema = z.array(RadarrMovieSchema)

/**
 * Movie search result schema (simplified for public API)
 */
export const MovieSearchResultSchema = z.object({
  tmdbId: z.number().int(),
  imdbId: z.string().optional(),
  title: z.string(),
  originalTitle: z.string().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  overview: z.string().optional(),
  runtime: z.number().int().nonnegative().optional(),
  genres: z.array(z.string()),
  rating: z.number().min(0).max(10).optional(),
  posterPath: z.string().optional(),
  backdropPath: z.string().optional(),
  inCinemas: z.string().optional(),
  physicalRelease: z.string().optional(),
  digitalRelease: z.string().optional(),
  status: z.nativeEnum(RadarrMovieStatus),
  certification: z.string().optional(),
  studio: z.string().optional(),
  website: z.string().url().or(z.literal('')).optional(),
  youTubeTrailerId: z.string().optional(),
  popularity: z.number().nonnegative().optional(),
})

/**
 * Array of movie search results
 */
export const MovieSearchResultArraySchema = z.array(MovieSearchResultSchema)

/**
 * Radarr system status schema
 */
export const RadarrSystemStatusSchema = z.object({
  appName: z.string(),
  version: z.string(),
  buildTime: z.string().datetime(),
  isDebug: z.boolean(),
  isProduction: z.boolean(),
  isAdmin: z.boolean(),
  isUserInteractive: z.boolean(),
  startupPath: z.string(),
  appData: z.string(),
  osName: z.string(),
  osVersion: z.string(),
  isMonoRuntime: z.boolean(),
  isMono: z.boolean(),
  isLinux: z.boolean(),
  isOsx: z.boolean(),
  isWindows: z.boolean(),
  branch: z.string(),
  authentication: z.string(),
  sqliteVersion: z.string(),
  migrationVersion: z.number().int().nonnegative(),
  urlBase: z.string().optional(),
  runtimeVersion: z.string(),
  runtimeName: z.string(),
  startTime: z.string().datetime(),
  packageVersion: z.string().optional(),
  packageAuthor: z.string().optional(),
  packageUpdateMechanism: z.string().optional(),
})

/**
 * Radarr quality profile schema
 */
export const RadarrQualityProfileSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  upgradeAllowed: z.boolean(),
  cutoff: z.number().int(),
  items: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string(),
        quality: z
          .object({
            id: z.number().int(),
            name: z.string(),
            source: z.string(),
            resolution: z.number().int(),
            modifier: z.string(),
          })
          .optional(),
        items: z.array(z.unknown()).optional(),
        allowed: z.boolean(),
      }),
    )
    .optional(),
  minFormatScore: z.number().int(),
  cutoffFormatScore: z.number().int(),
  formatItems: z
    .array(
      z.object({
        format: z.object({
          id: z.number().int(),
          name: z.string(),
        }),
        score: z.number().int(),
      }),
    )
    .optional(),
  language: z.object({
    id: z.number().int(),
    name: z.string(),
  }),
})

/**
 * Radarr root folder schema
 */
export const RadarrRootFolderSchema = z.object({
  id: z.number().int(),
  path: z.string(),
  accessible: z.boolean(),
  freeSpace: z.number().int(),
  totalSpace: z.number().int(),
  unmappedFolders: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
    }),
  ),
})

/**
 * Add movie request schema
 */
export const AddMovieRequestSchema = z.object({
  tmdbId: z.number().int(),
  title: z.string(),
  titleSlug: z.string(),
  year: z.number().int().min(1900).max(2100),
  qualityProfileId: z.number().int(),
  rootFolderPath: z.string(),
  monitored: z.boolean(),
  minimumAvailability: z.nativeEnum(RadarrMinimumAvailability),
  searchOnAdd: z.boolean(),
  images: z.array(RadarrImageSchema).optional(),
  genres: z.array(z.string()).optional(),
  runtime: z.number().int().nonnegative().optional(),
  overview: z.string().optional(),
  inCinemas: z.string().optional(),
  physicalRelease: z.string().optional(),
  digitalRelease: z.string().optional(),
  certification: z.string().optional(),
  studio: z.string().optional(),
  website: z.string().url().or(z.literal('')).optional(),
  youTubeTrailerId: z.string().optional(),
  tags: z.array(z.number().int()).optional(),
})

/**
 * Command request schema
 */
export const RadarrCommandRequestSchema = z.object({
  name: z.string(),
  movieIds: z.array(z.number().int()).optional(),
  movieId: z.number().int().optional(),
})

/**
 * Command response schema
 */
export const RadarrCommandResponseSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  commandName: z.string(),
  message: z.string().optional(),
  body: z.object({
    movieIds: z.array(z.number().int()).optional(),
    movieId: z.number().int().optional(),
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
 * Monitor movie options schema
 */
export const MonitorMovieOptionsSchema = z.object({
  qualityProfileId: z.number().int().optional(),
  rootFolderPath: z.string().optional(),
  minimumAvailability: z.nativeEnum(RadarrMinimumAvailability).optional(),
  searchOnAdd: z.boolean().optional(),
  monitored: z.boolean().optional(),
})

/**
 * Monitor and download result schema
 */
export const MonitorAndDownloadResultSchema = z.object({
  success: z.boolean(),
  movieAdded: z.boolean(),
  searchTriggered: z.boolean(),
  movie: RadarrMovieResourceSchema.optional(),
  commandId: z.number().int().optional(),
  error: z.string().optional(),
  warnings: z.array(z.string()).optional(),
})

/**
 * Delete movie options schema
 */
export const DeleteMovieOptionsSchema = z.object({
  deleteFiles: z.boolean().optional(),
})

/**
 * Unmonitor and delete result schema
 */
export const UnmonitorAndDeleteResultSchema = z.object({
  success: z.boolean(),
  movieDeleted: z.boolean(),
  filesDeleted: z.boolean(),
  movie: RadarrMovieResourceSchema.optional(),
  error: z.string().optional(),
  warnings: z.array(z.string()).optional(),
})

/**
 * Tracked download status message schema
 */
export const TrackedDownloadStatusMessageSchema = z.object({
  title: z.string(),
  messages: z.array(z.string()),
})

/**
 * Radarr queue item schema
 */
export const RadarrQueueItemSchema = z.object({
  id: z.number().int().positive(),
  movieId: z.number().int().positive().optional(),
  movie: RadarrMovieResourceSchema.optional(),
  title: z.string().optional(),
  size: z.number().int().nonnegative(),
  status: z.nativeEnum(RadarrQueueStatus),
  trackedDownloadStatus: z.nativeEnum(TrackedDownloadStatus).optional(),
  trackedDownloadState: z.nativeEnum(TrackedDownloadState).optional(),
  statusMessages: z.array(TrackedDownloadStatusMessageSchema).optional(),
  errorMessage: z.string().optional(),
  downloadId: z.string().optional(),
  protocol: z.nativeEnum(DownloadProtocol),
  downloadClient: z.string().optional(),
  indexer: z.string().optional(),
  outputPath: z.string().optional(),
  estimatedCompletionTime: z.string().optional(),
  added: z.string().optional(),
})

/**
 * Radarr queue paginated response schema
 */
export const RadarrQueuePaginatedResponseSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  sortKey: z.string(),
  sortDirection: z.enum(['ascending', 'descending']),
  totalRecords: z.number().int().nonnegative(),
  records: z.array(RadarrQueueItemSchema),
})

/**
 * Downloading movie schema - simplified information for status queries
 */
export const DownloadingMovieSchema = z.object({
  id: z.number().int().positive(),
  movieId: z.number().int().positive().optional(),
  movieTitle: z.string().optional(),
  movieYear: z.number().int().min(1900).max(2100).optional(),
  size: z.number().int().nonnegative(),
  status: z.nativeEnum(RadarrQueueStatus),
  trackedDownloadStatus: z.nativeEnum(TrackedDownloadStatus).optional(),
  trackedDownloadState: z.nativeEnum(TrackedDownloadState).optional(),
  statusMessages: z.array(TrackedDownloadStatusMessageSchema).optional(),
  errorMessage: z.string().optional(),
  downloadId: z.string().optional(),
  protocol: z.nativeEnum(DownloadProtocol),
  downloadClient: z.string().optional(),
  indexer: z.string().optional(),
  outputPath: z.string().optional(),
  estimatedCompletionTime: z.string().optional(),
  added: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
})

/**
 * Radarr error response schema
 */
export const RadarrErrorResponseSchema = z.object({
  message: z.string(),
  description: z.string().optional(),
  details: z.string().optional(),
})

/**
 * Input validation schemas for public methods
 */
export const RadarrInputSchemas = {
  searchQuery: SearchQuerySchema,
  addMovieRequest: AddMovieRequestSchema,
  commandRequest: RadarrCommandRequestSchema,
  monitorMovieOptions: MonitorMovieOptionsSchema,
  deleteMovieOptions: DeleteMovieOptionsSchema,
} as const

/**
 * Output validation schemas for API responses
 */
export const RadarrOutputSchemas = {
  movie: RadarrMovieSchema,
  movieArray: RadarrMovieArraySchema,
  movieResource: RadarrMovieResourceSchema,
  movieResourceArray: RadarrMovieResourceArraySchema,
  movieSearchResult: MovieSearchResultSchema,
  movieSearchResultArray: MovieSearchResultArraySchema,
  systemStatus: RadarrSystemStatusSchema,
  qualityProfile: RadarrQualityProfileSchema,
  qualityProfileArray: z.array(RadarrQualityProfileSchema),
  rootFolder: RadarrRootFolderSchema,
  rootFolderArray: z.array(RadarrRootFolderSchema),
  addMovieResponse: RadarrMovieResourceSchema,
  commandResponse: RadarrCommandResponseSchema,
  monitorAndDownloadResult: MonitorAndDownloadResultSchema,
  unmonitorAndDeleteResult: UnmonitorAndDeleteResultSchema,
  queueItem: RadarrQueueItemSchema,
  queueItemArray: z.array(RadarrQueueItemSchema),
  queuePaginatedResponse: RadarrQueuePaginatedResponseSchema,
  downloadingMovie: DownloadingMovieSchema,
  downloadingMovieArray: z.array(DownloadingMovieSchema),
  errorResponse: RadarrErrorResponseSchema,
} as const

/**
 * Type inference helpers
 */
export type SearchQueryInput = z.infer<typeof SearchQuerySchema>
export type AddMovieRequestInput = z.infer<typeof AddMovieRequestSchema>
export type RadarrCommandRequestInput = z.infer<
  typeof RadarrCommandRequestSchema
>
export type MonitorMovieOptionsInput = z.infer<typeof MonitorMovieOptionsSchema>
export type DeleteMovieOptionsInput = z.infer<typeof DeleteMovieOptionsSchema>
export type RadarrMovieOutput = z.infer<typeof RadarrMovieSchema>
export type RadarrMovieArrayOutput = z.infer<typeof RadarrMovieArraySchema>
export type RadarrMovieResourceOutput = z.infer<
  typeof RadarrMovieResourceSchema
>
export type MovieSearchResultOutput = z.infer<typeof MovieSearchResultSchema>
export type RadarrSystemStatusOutput = z.infer<typeof RadarrSystemStatusSchema>
export type RadarrQualityProfileOutput = z.infer<
  typeof RadarrQualityProfileSchema
>
export type RadarrRootFolderOutput = z.infer<typeof RadarrRootFolderSchema>
export type RadarrCommandResponseOutput = z.infer<
  typeof RadarrCommandResponseSchema
>
export type MonitorAndDownloadResultOutput = z.infer<
  typeof MonitorAndDownloadResultSchema
>
export type UnmonitorAndDeleteResultOutput = z.infer<
  typeof UnmonitorAndDeleteResultSchema
>
export type RadarrQueueItemOutput = z.infer<typeof RadarrQueueItemSchema>
export type RadarrQueuePaginatedResponseOutput = z.infer<
  typeof RadarrQueuePaginatedResponseSchema
>
export type DownloadingMovieOutput = z.infer<typeof DownloadingMovieSchema>
export type DownloadingMovieArrayOutput = z.infer<
  typeof RadarrOutputSchemas.downloadingMovieArray
>
export type RadarrErrorResponseOutput = z.infer<
  typeof RadarrErrorResponseSchema
>
