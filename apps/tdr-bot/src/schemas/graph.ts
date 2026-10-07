import { z } from 'zod'

/** Type of media the user is requesting (movies, TV shows, or both). */
export enum MediaRequestType {
  Movies = 'movies',
  Shows = 'shows',
  Both = 'both',
}

/** Whether the user wants to search their existing library, external databases, or both. */
export enum SearchIntent {
  Library = 'library',
  External = 'external',
  Both = 'both',
  Delete = 'delete',
}

export const ImageResponseSchema = z.object({
  title: z.string(),
  url: z.string(),
  parentId: z.string().optional(),
})

export type ImageResponse = z.infer<typeof ImageResponseSchema>

/** A video quality the user named in their message ("in 4k", "1080p"). */
export const MediaRequestQualitySchema = z.enum(['4k', '1080p', '720p'])

export type MediaRequestQuality = z.infer<typeof MediaRequestQualitySchema>

export const MediaRequestSchema = z.object({
  mediaType: z.enum(MediaRequestType),
  searchIntent: z.enum(SearchIntent),
  searchTerms: z.string(),
  /**
   * `null` when the message names no quality. Nullable rather than optional:
   * OpenAI strict structured output requires every property. Case and stray
   * whitespace are forgiven ("4K"); any other value the model invents becomes
   * `null` rather than failing the whole parse, so a garbled quality never
   * costs the user their request.
   */
  quality: z
    .preprocess(
      value => (typeof value === 'string' ? value.trim().toLowerCase() : value),
      MediaRequestQualitySchema.nullable(),
    )
    .catch(null),
})

export type MediaRequest = z.infer<typeof MediaRequestSchema>
