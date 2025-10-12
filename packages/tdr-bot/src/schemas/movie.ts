import { z } from 'zod'

/**
 * Schema for movie selection context stored in user state
 */
export const MovieSelectionContextSchema = z.object({
  searchResults: z.array(z.any()), // Use any to match MovieSearchResult type flexibility
  query: z.string(),
  timestamp: z.number(),
  isActive: z.boolean(),
})

export type MovieSelectionContext = z.infer<typeof MovieSelectionContextSchema>

/**
 * Schema for movie delete context stored in user state
 */
export const MovieDeleteContextSchema = z.object({
  searchResults: z.array(z.any()), // Use any to match MovieLibrarySearchResult type flexibility
  query: z.string(),
  timestamp: z.number(),
  isActive: z.boolean(),
})

export type MovieDeleteContext = z.infer<typeof MovieDeleteContextSchema>

/**
 * Schema for movie download request result
 */
export const MovieDownloadResultSchema = z.object({
  success: z.boolean(),
  movie: z
    .object({
      tmdbId: z.number(),
      title: z.string(),
      year: z.number().optional(),
    })
    .optional(),
  message: z.string(),
  error: z.string().optional(),
})

export type MovieDownloadResult = z.infer<typeof MovieDownloadResultSchema>
