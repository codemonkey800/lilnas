import { z } from 'zod'

import {
  SonarrSeriesStatus,
  SonarrSeriesType,
} from 'src/media/types/sonarr.types'

import { SearchSelectionSchema } from './search-selection'

/**
 * Sonarr Season schema for validation
 */
export const SonarrSeasonSchema = z.object({
  seasonNumber: z.number(),
  monitored: z.boolean(),
  statistics: z
    .object({
      episodeFileCount: z.number(),
      episodeCount: z.number(),
      totalEpisodeCount: z.number(),
      sizeOnDisk: z.number(),
      percentOfEpisodes: z.number(),
    })
    .optional(),
})

/**
 * Series Search Result schema - matches the existing SeriesSearchResult interface exactly
 */
export const SeriesSearchResultSchema = z.object({
  tvdbId: z.number(),
  tmdbId: z.number().optional(),
  imdbId: z.string().optional(),
  title: z.string(),
  titleSlug: z.string(),
  sortTitle: z.string().optional(),
  year: z.number().optional(),
  firstAired: z.string().optional(),
  lastAired: z.string().optional(),
  overview: z.string().optional(),
  runtime: z.number().optional(),
  network: z.string().optional(),
  status: z.nativeEnum(SonarrSeriesStatus),
  seriesType: z.nativeEnum(SonarrSeriesType),
  seasons: z.array(SonarrSeasonSchema),
  genres: z.array(z.string()),
  rating: z.number().optional(),
  posterPath: z.string().optional(),
  backdropPath: z.string().optional(),
  certification: z.string().optional(),
  ended: z.boolean(),
})

export type SeriesSearchResult = z.infer<typeof SeriesSearchResultSchema>

/**
 * TV Show selection context stored in user state - fully typed
 */
export const TvShowSelectionContextSchema = z.object({
  searchResults: z.array(SeriesSearchResultSchema),
  query: z.string(),
  timestamp: z.number(),
  isActive: z.boolean(),
  // Store the original selections from the user's request to preserve intent
  originalSearchSelection: SearchSelectionSchema.optional(), // How to pick which show (year, ordinal, etc.)
  originalTvSelection: z.lazy(() => TvShowSelectionSchema).optional(), // Which parts to download (seasons, episodes)
})

export type TvShowSelectionContext = z.infer<
  typeof TvShowSelectionContextSchema
>

/**
 * Library Search Result schema - extends SeriesSearchResult with library-specific fields
 */
export const LibrarySearchResultSchema = SeriesSearchResultSchema.extend({
  id: z.number(), // Sonarr series ID
  monitored: z.boolean(),
  path: z.string(),
  added: z.string(),
  statistics: z
    .object({
      seasonCount: z.number(),
      episodeFileCount: z.number(),
      episodeCount: z.number(),
      totalEpisodeCount: z.number(),
      sizeOnDisk: z.number(),
      releaseGroups: z.array(z.string()).optional(),
      percentOfEpisodes: z.number(),
    })
    .optional(),
})

export type LibrarySearchResult = z.infer<typeof LibrarySearchResultSchema>

/**
 * TV Show delete context stored in user state - for managing TV show deletion flow
 */
export const TvShowDeleteContextSchema = z.object({
  searchResults: z.array(LibrarySearchResultSchema),
  query: z.string(),
  timestamp: z.number(),
  isActive: z.boolean(),
  // Store the original selections from the user's request to preserve intent
  originalSearchSelection: SearchSelectionSchema.optional(), // How to pick which show (year, ordinal, etc.)
  originalTvSelection: z.lazy(() => TvShowSelectionSchema).optional(), // Which parts to delete (seasons, episodes)
})

export type TvShowDeleteContext = z.infer<typeof TvShowDeleteContextSchema>

/**
 * TV Show selection structure - matches exactly what SonarrService.monitorAndDownloadSeries expects
 */
export const TvShowSelectionSchema = z.object({
  selection: z
    .array(
      z.object({
        season: z.number(),
        episodes: z.array(z.number()).optional(),
      }),
    )
    .optional(),
})

export type TvShowSelection = z.infer<typeof TvShowSelectionSchema>

/**
 * TV Show download result schema
 */
export const TvShowDownloadResultSchema = z.object({
  success: z.boolean(),
  series: z
    .object({
      tvdbId: z.number(),
      title: z.string(),
      year: z.number().optional(),
    })
    .optional(),
  message: z.string(),
  error: z.string().optional(),
})

export type TvShowDownloadResult = z.infer<typeof TvShowDownloadResultSchema>
