import { z } from 'zod'

// Query params on `GET /theater/playback/:id` (ORCHESTRATE.md § "Backend
// endpoints"). Express hands query values to us as strings (or omits the key
// entirely when the frontend doesn't send it), so every field coerces a
// numeric string to a number and stays optional — all four params are
// optional per the contract.
export const PlaybackQuerySchema = z.object({
  maxBitrate: z.coerce.number().int().positive().optional(),
  audioIndex: z.coerce.number().int().nonnegative().optional(),
  subtitleIndex: z.coerce.number().int().nonnegative().optional(),
  startTicks: z.coerce.number().int().nonnegative().optional(),
})

export type PlaybackQuery = z.infer<typeof PlaybackQuerySchema>

// Query params on `GET /theater/items/:id/episodes` — `seasonId` is required
// since the iPad always drills season-first (pick a season, then see that
// season's episodes), never "all episodes across every season" in one call.
export const EpisodesQuerySchema = z.object({
  seasonId: z.string().min(1),
})

export type EpisodesQuery = z.infer<typeof EpisodesQuerySchema>

// Query params on `GET /theater/items/:id/image`. Both are optional; omitting
// them reproduces the tablet poster grid's original request exactly (Primary at
// the service's default width), so that call site needed no change.
//
// `type` is an ENUM rather than a free string on purpose: the service
// interpolates it straight into the Emby path (`/Items/{id}/Images/{type}`), so
// an unconstrained value would let a caller walk out of that path segment. The
// list is the set of image kinds this app actually renders — a hero backdrop,
// posters, and the two Emby also commonly has for episodes/series.
//
// `maxWidth` is capped rather than merely positive so a caller can't ask the
// Emby server to resample an image at an arbitrary size.
export const ItemImageQuerySchema = z.object({
  type: z.enum(['Primary', 'Backdrop', 'Thumb', 'Logo']).optional(),
  maxWidth: z.coerce.number().int().positive().max(3840).optional(),
})

export type ItemImageQuery = z.infer<typeof ItemImageQuerySchema>
