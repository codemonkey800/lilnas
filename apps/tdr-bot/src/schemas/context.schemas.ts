import { z } from 'zod'

/**
 * Zod schemas for context operation results
 *
 * These schemas validate the results of media operations (download, delete)
 * to ensure type safety when accessing context data in the prompt generation service.
 */

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
export type MovieDeleteResult = z.infer<typeof MovieDeleteResultSchema>
export type TVDeleteResult = z.infer<typeof TVDeleteResultSchema>
