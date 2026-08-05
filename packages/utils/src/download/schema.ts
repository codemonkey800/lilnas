import { z } from 'zod'

export const TIME_REGEX = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/

export const CreateDownloadJobInputSchema = z.object({
  timeRange: z
    .object({
      start: z.string().regex(TIME_REGEX),
      end: z.string().regex(TIME_REGEX),
    })
    .optional(),

  url: z.string().url(),
})

export const VideoInfoSchema = z.object({
  description: z.string().nullish().optional(),
  playlist: z.string().nullish().optional(),
  title: z.string().nullish().optional(),
})

export const MediaSearchQuerySchema = z.object({
  query: z.string().min(1),
})

export const RequestMovieInputSchema = z.object({
  tmdbId: z.number().int().positive(),
})

export const RequestShowInputSchema = z.object({
  tvdbId: z.number().int().positive(),
})
