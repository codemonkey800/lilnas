import { z } from 'zod'

export const TIME_REGEX = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/

export const CreateDownloadJobInputSchema = z.object({
  // Deliberately `.optional()` with NO `.default(false)`: this schema is
  // consumed via `z.infer<>` (the *output* type) for
  // `CreateDownloadJobInput`, and a `.default(false)` would make the field
  // required on that inferred type — breaking tdr-bot's existing
  // `createVideoJob({ url, timeRange })` call at compile time. Default to
  // `false` at the job-construction site instead
  // (`DownloadService.createVideoDownloadJob`).
  hiddenAttribution: z.boolean().optional(),

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
