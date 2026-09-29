import { z } from 'zod'

/**
 * Shared search query input validation schema used by both Radarr and Sonarr services.
 */
export const SearchQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(2, 'Search query must be at least 2 characters')
    .max(200, 'Search query must be less than 200 characters'),
})

/**
 * Shared optional search query schema for library filtering.
 */
export const OptionalSearchQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(2, 'Search query must be at least 2 characters')
    .max(200, 'Search query must be less than 200 characters')
    .optional(),
})

export type SearchQueryInput = z.infer<typeof SearchQuerySchema>
export type OptionalSearchQueryInput = z.infer<typeof OptionalSearchQuerySchema>
