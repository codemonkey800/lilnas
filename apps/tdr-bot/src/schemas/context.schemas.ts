import { z } from 'zod'

/**
 * Zod schemas for context operation results
 *
 * These schemas validate the results of media operations (download, delete)
 * to ensure type safety when accessing context data in the prompt generation service.
 */

/**
 * Schema for movie download operation results
 *
 * Validates the result structure returned when adding a movie to the download queue.
 */
export const MovieDownloadResultSchema = z.object({
  movieAdded: z.boolean(),
  searchTriggered: z.boolean(),
})

/**
 * Schema for movie delete operation results
 *
 * Validates the result structure returned when deleting a movie from the library.
 */
export const MovieDeleteResultSchema = z.object({
  movieDeleted: z.boolean(),
  filesDeleted: z.boolean(),
  downloadsFound: z.number().optional(),
  downloadsCancelled: z.number().optional(),
})

/**
 * Schema for TV show download operation results
 *
 * Validates the result structure returned when adding a TV show to the download queue.
 */
export const TVDownloadResultSchema = z.object({
  seriesAdded: z.boolean(),
  seriesUpdated: z.boolean(),
  searchTriggered: z.boolean(),
})

/**
 * Schema for TV show delete operation results
 *
 * Validates the result structure returned when deleting a TV show from the library.
 */
export const TVDeleteResultSchema = z.object({
  seriesDeleted: z.boolean(),
  filesDeleted: z.boolean(),
})

/**
 * Type inference helpers
 */
export type MovieDownloadResult = z.infer<typeof MovieDownloadResultSchema>
export type MovieDeleteResult = z.infer<typeof MovieDeleteResultSchema>
export type TVDownloadResult = z.infer<typeof TVDownloadResultSchema>
export type TVDeleteResult = z.infer<typeof TVDeleteResultSchema>
