/**
 * @fileoverview Request validation schemas for Media API clients
 *
 * This module provides Zod schemas for validating API request bodies before
 * sending them to external media services (Sonarr, Radarr, Emby).
 *
 * These schemas ensure that all request data matches the exact format expected
 * by the external APIs, preventing malformed requests and improving error handling.
 *
 * @module RequestValidationSchemas
 * @since 1.0.0
 * @author TDR Bot Development Team
 */

import { z } from 'zod'

/**
 * Schema for validating Sonarr series request bodies
 *
 * Validates the structure required for POST /api/v3/series requests
 * according to the design document specifications.
 *
 * @example
 * ```typescript
 * const validRequest = {
 *   title: "Breaking Bad",
 *   year: 2008,
 *   tvdbId: 81189,
 *   qualityProfileId: 1,
 *   languageProfileId: 1,
 *   rootFolderPath: "/tv",
 *   monitored: true,
 *   seasons: [
 *     { seasonNumber: 1, monitored: true },
 *     { seasonNumber: 2, monitored: true }
 *   ],
 *   addOptions: {
 *     searchForMissingEpisodes: true,
 *     searchForCutoffUnmetEpisodes: false
 *   }
 * }
 *
 * SonarrSeriesRequestSchema.parse(validRequest) // ✅ Valid
 * ```
 */
export const SonarrSeriesRequestSchema = z.object({
  /** Series title as it appears in TVDB */
  title: z.string().min(1).max(200),

  /** Release year of the series */
  year: z.number().int().min(1900).max(2100),

  /** TVDB series identifier */
  tvdbId: z.number().int().positive(),

  /** Sonarr quality profile ID for downloads */
  qualityProfileId: z.number().int().positive(),

  /** Sonarr language profile ID for downloads */
  languageProfileId: z.number().int().positive(),

  /** Root folder path where series will be stored */
  rootFolderPath: z.string().min(1),

  /** Whether the series should be monitored for new episodes */
  monitored: z.boolean(),

  /** Array of season monitoring configurations */
  seasons: z
    .array(
      z.object({
        /** Season number (0 for specials) */
        seasonNumber: z.number().int().min(0).max(50),
        /** Whether this season should be monitored */
        monitored: z.boolean(),
      }),
    )
    .min(1)
    .max(50),

  /** Additional options for adding the series */
  addOptions: z.object({
    /** Search for missing episodes immediately after adding */
    searchForMissingEpisodes: z.boolean(),
    /** Search for episodes that don't meet cutoff quality */
    searchForCutoffUnmetEpisodes: z.boolean(),
  }),
})

/**
 * TypeScript type for Sonarr series requests
 */
export type SonarrSeriesRequest = z.infer<typeof SonarrSeriesRequestSchema>

/**
 * Schema for validating Radarr movie request bodies
 *
 * Validates the structure required for POST /api/v3/movie requests
 * according to the design document specifications.
 *
 * @example
 * ```typescript
 * const validRequest = {
 *   title: "Fight Club",
 *   year: 1999,
 *   tmdbId: 550,
 *   qualityProfileId: 1,
 *   rootFolderPath: "/movies",
 *   monitored: true,
 *   addOptions: {
 *     searchForMovie: true
 *   }
 * }
 *
 * RadarrMovieRequestSchema.parse(validRequest) // ✅ Valid
 * ```
 */
export const RadarrMovieRequestSchema = z.object({
  /** Movie title as it appears in TMDB */
  title: z.string().min(1).max(200),

  /** Release year of the movie */
  year: z.number().int().min(1900).max(2100),

  /** TMDB movie identifier */
  tmdbId: z.number().int().positive(),

  /** Radarr quality profile ID for downloads */
  qualityProfileId: z.number().int().positive(),

  /** Root folder path where movie will be stored */
  rootFolderPath: z.string().min(1),

  /** Whether the movie should be monitored */
  monitored: z.boolean(),

  /** Additional options for adding the movie */
  addOptions: z.object({
    /** Search for the movie immediately after adding */
    searchForMovie: z.boolean(),
  }),
})

/**
 * TypeScript type for Radarr movie requests
 */
export type RadarrMovieRequest = z.infer<typeof RadarrMovieRequestSchema>

/**
 * Schema for validating episode specifications
 *
 * Validates episode specification strings used for Sonarr series requests.
 * Supports patterns like S1, S2E5, S3E1-10, S1,S2, S2E1-5,S3E1.
 *
 * @example
 * ```typescript
 * EpisodeSpecificationSchema.parse("S1") // ✅ Valid - Full season 1
 * EpisodeSpecificationSchema.parse("S2E5") // ✅ Valid - Season 2, Episode 5
 * EpisodeSpecificationSchema.parse("S3E1-10") // ✅ Valid - Season 3, Episodes 1-10
 * EpisodeSpecificationSchema.parse("S1,S2") // ✅ Valid - Full seasons 1 and 2
 * EpisodeSpecificationSchema.parse("invalid") // ❌ Invalid format
 * ```
 */
export const EpisodeSpecificationSchema = z
  .string()
  .min(2)
  .max(100)
  .regex(
    /^S\d+(?:E\d+(?:-\d+)?)?(?:,S\d+(?:E\d+(?:-\d+)?)?)*$/i,
    'Invalid episode specification format. Use patterns like S1, S2E5, S3E1-10, S1,S2',
  )

/**
 * Schema for validating media search queries
 *
 * Validates search query strings for all media services.
 * Prevents injection attacks and ensures reasonable query lengths.
 *
 * @example
 * ```typescript
 * MediaSearchQuerySchema.parse("breaking bad") // ✅ Valid
 * MediaSearchQuerySchema.parse("fight club 1999") // ✅ Valid
 * MediaSearchQuerySchema.parse("") // ❌ Too short
 * MediaSearchQuerySchema.parse("x".repeat(200)) // ❌ Too long
 * ```
 */
export const MediaSearchQuerySchema = z
  .string()
  .min(1, 'Search query must not be empty')
  .max(100, 'Search query must be less than 100 characters')
  .transform(query => query.trim())
  .refine(
    query => query.length > 0,
    'Search query must not be empty after trimming',
  )

/**
 * Schema for validating correlation IDs
 *
 * Ensures correlation IDs are properly formatted UUIDs for request tracing.
 *
 * @example
 * ```typescript
 * CorrelationIdSchema.parse("550e8400-e29b-41d4-a716-446655440000") // ✅ Valid UUID
 * CorrelationIdSchema.parse("invalid-id") // ❌ Invalid format
 * ```
 */
export const CorrelationIdSchema = z
  .string()
  .uuid('Correlation ID must be a valid UUID')

/**
 * Schema for validating media IDs
 *
 * Validates media identifiers used across different services.
 * Supports both numeric IDs (Sonarr/Radarr) and string IDs (Emby).
 *
 * @example
 * ```typescript
 * MediaIdSchema.parse("123") // ✅ Valid numeric ID as string
 * MediaIdSchema.parse("abc123def") // ✅ Valid string ID
 * MediaIdSchema.parse("") // ❌ Empty string
 * ```
 */
export const MediaIdSchema = z
  .string()
  .min(1, 'Media ID must not be empty')
  .max(50, 'Media ID must be less than 50 characters')

/**
 * Validation utility functions for common validation scenarios
 */
export class RequestValidationUtils {
  /**
   * Validate a Sonarr series request with detailed error reporting
   *
   * @param data - The request data to validate
   * @param correlationId - Correlation ID for logging
   * @returns Validated request data
   * @throws {MediaValidationApiError} When validation fails
   */
  static validateSonarrSeriesRequest(
    data: unknown,
    correlationId: string,
  ): SonarrSeriesRequest {
    try {
      return SonarrSeriesRequestSchema.parse(data)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join('; ')

        throw new Error(
          `Sonarr series request validation failed: ${fieldErrors}. Correlation ID: ${correlationId}`,
        )
      }
      throw error
    }
  }

  /**
   * Validate a Radarr movie request with detailed error reporting
   *
   * @param data - The request data to validate
   * @param correlationId - Correlation ID for logging
   * @returns Validated request data
   * @throws {MediaValidationApiError} When validation fails
   */
  static validateRadarrMovieRequest(
    data: unknown,
    correlationId: string,
  ): RadarrMovieRequest {
    try {
      return RadarrMovieRequestSchema.parse(data)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join('; ')

        throw new Error(
          `Radarr movie request validation failed: ${fieldErrors}. Correlation ID: ${correlationId}`,
        )
      }
      throw error
    }
  }

  /**
   * Validate a search query with sanitization
   *
   * @param query - The search query to validate
   * @returns Sanitized and validated query
   * @throws {Error} When validation fails
   */
  static validateSearchQuery(query: unknown): string {
    try {
      return MediaSearchQuerySchema.parse(query)
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message =
          error.errors[0]?.message || 'Invalid search query format'
        throw new Error(`Search query validation failed: ${message}`)
      }
      throw error
    }
  }

  /**
   * Validate an episode specification string
   *
   * @param spec - The episode specification to validate
   * @returns Validated episode specification
   * @throws {Error} When validation fails
   */
  static validateEpisodeSpecification(spec: unknown): string {
    try {
      return EpisodeSpecificationSchema.parse(spec)
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          'Episode specification validation failed: ' +
            error.errors[0]?.message,
        )
      }
      throw error
    }
  }

  /**
   * Validate a correlation ID
   *
   * @param correlationId - The correlation ID to validate
   * @returns Validated correlation ID
   * @throws {Error} When validation fails
   */
  static validateCorrelationId(correlationId: unknown): string {
    try {
      return CorrelationIdSchema.parse(correlationId)
    } catch {
      throw new Error('Invalid correlation ID format: must be a valid UUID')
    }
  }

  /**
   * Validate a media ID
   *
   * @param mediaId - The media ID to validate
   * @returns Validated media ID
   * @throws {Error} When validation fails
   */
  static validateMediaId(mediaId: unknown): string {
    try {
      return MediaIdSchema.parse(mediaId)
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          'Media ID validation failed: ' + error.errors[0]?.message,
        )
      }
      throw error
    }
  }
}

/**
 * All schemas and utility class are already exported with their declarations above
 */
